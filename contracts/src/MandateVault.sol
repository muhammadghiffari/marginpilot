// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {ECDSA} from "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";
import {EIP712} from "@openzeppelin/contracts/utils/cryptography/EIP712.sol";
import {MockERC20} from "./MockERC20.sol";
import {MockOracle} from "./MockOracle.sol";

/// @notice Owner-mandated vault; the agent only holds the executor hot key (CONTRACTS §2.5).
contract MandateVault is EIP712 {
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

    bytes32 public constant MANDATE_TYPEHASH = keccak256(
        "Mandate(uint64 id,uint64 validFrom,uint64 validUntil,uint128 maxTotalSpendUsd,uint128 maxPerActionUsd,uint128 minLiquidReserveUsd,uint32 maxSlippageBps,uint32 maxPriceAgeSec,uint32 maxPriceDeviationBps,uint8 allowedActions,bool allowBorrow,address[] allowedTargets,address[] lockedTokens)"
    );
    bytes32 public constant SET_MANDATE_TYPEHASH = keccak256("SetMandate(Mandate mandate,uint256 deadline)");

    address public owner;
    address public executor;
    MockOracle public immutable oracle;
    MockERC20 public immutable reserveToken;
    bool public paused;

    uint64 public nextMandateId = 1;
    uint64 public activeMandateId;
    mapping(uint64 => uint128) public spentUsd;

    Mandate private _mandate;

    event VaultPaused(address indexed by);
    event VaultUnpaused(address indexed by);
    event ExecutorChanged(address indexed executor);
    event MandateSet(uint64 id, bytes32 mandateHash);

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

    function _activateMandate(Mandate calldata m) private {
        if (m.id != nextMandateId) revert BadNonce();
        _mandate = m;
        activeMandateId = m.id;
        nextMandateId = m.id + 1;
        spentUsd[m.id] = 0;
        emit MandateSet(m.id, _mandateStructHash(m));
    }

    function _mandateStructHash(Mandate calldata m) private pure returns (bytes32) {
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
}
