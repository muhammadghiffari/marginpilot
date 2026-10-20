// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {MockERC20} from "./MockERC20.sol";
import {MockOracle} from "./MockOracle.sol";

/// @notice Owner-mandated vault; the agent only holds the executor hot key (CONTRACTS §2.5).
contract MandateVault {
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

    address public owner;
    address public executor;
    MockOracle public immutable oracle;
    MockERC20 public immutable reserveToken;
    bool public paused;

    event VaultPaused(address indexed by);
    event VaultUnpaused(address indexed by);
    event ExecutorChanged(address indexed executor);

    constructor(address owner_, address executor_, address oracle_, address reserveToken_) {
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
}
