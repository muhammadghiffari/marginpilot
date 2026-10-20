// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {ECDSA} from "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";
import {EIP712} from "@openzeppelin/contracts/utils/cryptography/EIP712.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {MockERC20} from "./MockERC20.sol";
import {MockOracle} from "./MockOracle.sol";
import {LendingSim} from "./LendingSim.sol";

/// @notice Owner-mandated vault; the agent only holds the executor hot key (CONTRACTS §2.5).
contract MandateVault is EIP712, ReentrancyGuard {
    using SafeERC20 for IERC20;

    error NotOwner();
    error NotExecutor();
    error Paused();
    error MandateInactive();
    error MandateExpired();
    error StaleAction();
    error DeadlineExpired();
    error ZeroAmount();
    error ActionNotAllowed();
    error BorrowForbidden();
    error TargetNotAllowed();
    error AssetLocked();
    error StalePrice();
    error PriceDeviation();
    error PerActionCapExceeded();
    error BudgetExceeded();
    error SlippageExceeded();
    error PostConditionFailed();
    error BadSignature();
    error BadNonce();
    error SignatureExpired();

    struct Mandate {
        uint64 id;
        uint64 validFrom;
        uint64 validUntil;
        uint128 maxTotalSpendUsd;
        uint128 maxPerActionUsd;
        uint128 minLiquidReserveUsd;
        uint32 maxSlippageBps;
        uint32 maxPriceAgeSec;
        uint32 maxPriceDeviationBps;
        uint8 allowedActions;
        bool allowBorrow;
        address[] allowedTargets;
        address[] lockedTokens;
    }

    enum ActionType {
        REPAY,
        SUPPLY_COLLATERAL,
        SWAP,
        BORROW
    }

    struct Action {
        uint64 mandateId;
        uint64 nonce;
        ActionType actionType;
        address target;
        uint8 poolId;
        address tokenIn;
        address tokenOut;
        uint256 amount;
        uint256 minAmountOut;
        uint256 quotedPriceUsd8;
        uint64 deadline;
    }

    bytes32 public constant MANDATE_TYPEHASH = keccak256(
        "Mandate(uint64 id,uint64 validFrom,uint64 validUntil,uint128 maxTotalSpendUsd,uint128 maxPerActionUsd,uint128 minLiquidReserveUsd,uint32 maxSlippageBps,uint32 maxPriceAgeSec,uint32 maxPriceDeviationBps,uint8 allowedActions,bool allowBorrow,address[] allowedTargets,address[] lockedTokens)"
    );
    bytes32 public constant SET_MANDATE_TYPEHASH = keccak256(
        "SetMandate(Mandate mandate,uint256 deadline)Mandate(uint64 id,uint64 validFrom,uint64 validUntil,uint128 maxTotalSpendUsd,uint128 maxPerActionUsd,uint128 minLiquidReserveUsd,uint32 maxSlippageBps,uint32 maxPriceAgeSec,uint32 maxPriceDeviationBps,uint8 allowedActions,bool allowBorrow,address[] allowedTargets,address[] lockedTokens)"
    );

    address public owner;
    address public executor;
    MockOracle public immutable oracle;
    MockERC20 public immutable reserveToken;
    bool public paused;

    uint64 public nextMandateId = 1;
    uint64 public activeMandateId;
    uint64 public actionNonce;
    mapping(uint64 => uint128) public spentUsd;

    Mandate private _mandate;

    event VaultPaused(address indexed by);
    event VaultUnpaused(address indexed by);
    event ExecutorChanged(address indexed executor);
    event MandateSet(uint64 id, bytes32 mandateHash);
    event MandateRevoked(uint64 id);

    constructor(address owner_, address executor_, address oracle_, address reserveToken_)
        EIP712("MarginPilotVault", "1")
    {
        owner = owner_;
        executor = executor_;
        oracle = MockOracle(oracle_);
        reserveToken = MockERC20(reserveToken_);
    }

    modifier onlyOwner() {
        if (msg.sender != owner) revert NotOwner();
        _;
    }

    modifier onlyExecutor() {
        if (msg.sender != executor) revert NotExecutor();
        _;
    }

    /// @notice Sets a new executor hot key. Owner only.
    function setExecutor(address executor_) external onlyOwner {
        executor = executor_;
        emit ExecutorChanged(executor_);
    }

    /// @notice Stops all executions. Callable by owner or executor (stopping is the safe direction).
    function pause() external {
        if (msg.sender != owner && msg.sender != executor) revert NotExecutor();
        paused = true;
        emit VaultPaused(msg.sender);
    }

    /// @notice Resumes executions. Owner only.
    function unpause() external onlyOwner {
        paused = false;
        emit VaultUnpaused(msg.sender);
    }

    /// @notice Withdraws any token. Always available to the owner, even while paused.
    function ownerWithdraw(address token, uint256 amount, address to) external onlyOwner {
        IERC20(token).safeTransfer(to, amount);
    }

    /// @notice Returns the active mandate (zero-valued if none).
    function mandate() external view returns (Mandate memory) {
        return _mandate;
    }

    /// @notice Installs a mandate signed directly by the owner. Owner only.
    function setMandate(Mandate calldata m) external onlyOwner {
        _activateMandate(m);
    }

    /// @notice Installs an owner-signed mandate; any relayer may submit it.
    function setMandateWithSig(Mandate calldata m, uint256 deadline, bytes calldata sig) external {
        if (block.timestamp > deadline) revert SignatureExpired();
        if (m.id != nextMandateId) revert BadNonce();

        bytes32 digest = _hashTypedDataV4(keccak256(abi.encode(SET_MANDATE_TYPEHASH, _mandateStructHash(m), deadline)));
        if (ECDSA.recover(digest, sig) != owner) revert BadSignature();

        _activateMandate(m);
    }

    /// @notice Revokes the active mandate. Owner only.
    function revokeMandate() external onlyOwner {
        uint64 id = activeMandateId;
        if (id == 0) revert MandateInactive();
        delete _mandate;
        activeMandateId = 0;
        emit MandateRevoked(id);
    }

    /// @notice Runs checks #1-#15 from CONTRACTS §2.5. Effects land in A-04.4.
    function execute(Action calldata a) external onlyExecutor nonReentrant returns (uint256 valueUsd8) {
        // 2
        if (paused) revert Paused();

        // 3
        Mandate storage m = _mandate;
        if (activeMandateId == 0) revert MandateInactive();

        // 4
        if (a.mandateId != activeMandateId || a.nonce != actionNonce) revert StaleAction();

        // 5
        if (block.timestamp > a.deadline) revert DeadlineExpired();

        // 6
        if (block.timestamp < m.validFrom || block.timestamp > m.validUntil) revert MandateExpired();

        // 7
        if (a.amount == 0) revert ZeroAmount();

        // 8
        if (a.actionType == ActionType.BORROW) {
            if (!m.allowBorrow) revert BorrowForbidden();
        } else if ((uint256(m.allowedActions) & (uint256(1) << uint8(a.actionType))) == 0) {
            revert ActionNotAllowed();
        }

        // 9
        if (!_isAllowedTarget(m, a.target)) revert TargetNotAllowed();

        // 10
        if ((a.actionType == ActionType.REPAY || a.actionType == ActionType.SWAP) && _isLocked(m, a.tokenIn)) {
            revert AssetLocked();
        }

        // 11 (D-023 price set)
        (uint256 priceIn,) = oracle.getPrice(a.tokenIn);
        address[] memory priceSet = _priceSet(a);
        for (uint256 i; i < priceSet.length; ++i) {
            (, uint256 updatedAt) = oracle.getPrice(priceSet[i]);
            if (updatedAt + m.maxPriceAgeSec < block.timestamp) revert StalePrice();
        }

        // 12
        uint256 deviation = priceIn > a.quotedPriceUsd8 ? priceIn - a.quotedPriceUsd8 : a.quotedPriceUsd8 - priceIn;
        if (deviation * 10_000 > uint256(m.maxPriceDeviationBps) * a.quotedPriceUsd8) revert PriceDeviation();

        // 13 (BORROW counts 0)
        valueUsd8 = a.actionType == ActionType.BORROW ? 0 : _usd8Up(a.amount, a.tokenIn, priceIn);
        if (valueUsd8 > m.maxPerActionUsd) revert PerActionCapExceeded();

        // 14
        if (uint256(spentUsd[a.mandateId]) + valueUsd8 > m.maxTotalSpendUsd) revert BudgetExceeded();

        // 15
        if (a.actionType == ActionType.SWAP) {
            uint256 fairOut = _fairOut(a.amount, a.tokenIn, a.tokenOut, priceIn);
            if (a.minAmountOut < fairOut * (10_000 - m.maxSlippageBps) / 10_000) revert SlippageExceeded();
        }
    }

    function _activateMandate(Mandate calldata m) private {
        if (m.id != nextMandateId) revert BadNonce();
        _mandate = m;
        activeMandateId = m.id;
        nextMandateId = m.id + 1;
        spentUsd[m.id] = 0;
        emit MandateSet(m.id, _mandateStructHash(m));
    }

    function _mandateStructHash(Mandate calldata m) internal pure returns (bytes32) {
        return keccak256(
            abi.encode(
                MANDATE_TYPEHASH,
                m.id,
                m.validFrom,
                m.validUntil,
                m.maxTotalSpendUsd,
                m.maxPerActionUsd,
                m.minLiquidReserveUsd,
                m.maxSlippageBps,
                m.maxPriceAgeSec,
                m.maxPriceDeviationBps,
                m.allowedActions,
                m.allowBorrow,
                _hashAddressArray(m.allowedTargets),
                _hashAddressArray(m.lockedTokens)
            )
        );
    }

    /// @dev EIP-712 array hash: keccak256 of the 32-byte-padded elements (viem-compatible).
    function _hashAddressArray(address[] calldata arr) private pure returns (bytes32) {
        bytes32[] memory words = new bytes32[](arr.length);
        for (uint256 i; i < arr.length; ++i) {
            words[i] = bytes32(uint256(uint160(arr[i])));
        }
        return keccak256(abi.encodePacked(words));
    }

    function _isAllowedTarget(Mandate storage m, address target) private view returns (bool) {
        uint256 len = m.allowedTargets.length;
        for (uint256 i; i < len; ++i) {
            if (m.allowedTargets[i] == target) return true;
        }
        return false;
    }

    function _isLocked(Mandate storage m, address token) private view returns (bool) {
        uint256 len = m.lockedTokens.length;
        for (uint256 i; i < len; ++i) {
            if (m.lockedTokens[i] == token) return true;
        }
        return false;
    }

    /// @dev D-023: tokenIn, plus tokenOut for SWAP, plus the pool's collateral/debt for lending actions.
    function _priceSet(Action calldata a) private view returns (address[] memory tokens) {
        if (a.actionType == ActionType.SWAP) {
            tokens = new address[](2);
            tokens[0] = a.tokenIn;
            tokens[1] = a.tokenOut;
        } else {
            (address collateralToken, address debtToken) = _poolTokens(a.target, a.poolId);
            tokens = new address[](3);
            tokens[0] = a.tokenIn;
            tokens[1] = collateralToken;
            tokens[2] = debtToken;
        }
    }

    function _poolTokens(address target, uint8 poolId)
        private
        view
        returns (address collateralToken, address debtToken)
    {
        (collateralToken, debtToken,,,,) = LendingSim(target).pools(poolId);
    }

    function _usd8Up(uint256 amount, address token, uint256 priceUsd8) private view returns (uint256) {
        uint256 scale = 10 ** uint256(MockERC20(token).decimals());
        return (amount * priceUsd8 + scale - 1) / scale;
    }

    function _fairOut(uint256 amountIn, address tokenIn, address tokenOut, uint256 priceIn)
        private
        view
        returns (uint256)
    {
        uint256 scaleIn = 10 ** uint256(MockERC20(tokenIn).decimals());
        uint256 scaleOut = 10 ** uint256(MockERC20(tokenOut).decimals());
        return amountIn * priceIn * scaleOut / (scaleIn * _price(tokenOut));
    }

    function _price(address token) private view returns (uint256 priceUsd8) {
        (priceUsd8,) = oracle.getPrice(token);
    }
}
