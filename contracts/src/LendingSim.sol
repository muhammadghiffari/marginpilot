// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {MockERC20} from "./MockERC20.sol";
import {MockOracle} from "./MockOracle.sol";

/// @notice Two-pool lending simulator with oracle prices and no interest accrual (D-002).
contract LendingSim {
    error NotAdmin();
    error InvalidPool(uint8 pool);
    error PoolPaused(uint8 pool);
    error BorrowTooMuch();
    error NotLiquidatable();
    error CloseFactorExceeded();

    struct Pool {
        address collateralToken;
        address debtToken;
        uint32 ltBps;
        uint32 liqBonusBps;
        uint32 closeFactorBps;
        bool paused;
    }

    struct Position {
        uint256 collateral;
        uint256 debt;
    }

    address public immutable admin;
    MockOracle public immutable oracle;
    mapping(uint8 => Pool) public pools;
    mapping(uint8 => mapping(address => Position)) private _positions;

    event Liquidated(
        uint8 indexed pool,
        address indexed user,
        address indexed liquidator,
        uint256 repayAmount,
        uint256 collateralSeized,
        uint256 bonusUsd8
    );

    constructor(address oracle_) {
        admin = msg.sender;
        oracle = MockOracle(oracle_);
    }

    /// @notice Configures a pool's tokens and risk parameters. Admin only.
    function setPool(
        uint8 poolId,
        address collateralToken,
        address debtToken,
        uint32 ltBps,
        uint32 liqBonusBps,
        uint32 closeFactorBps
    ) external {
        if (msg.sender != admin) revert NotAdmin();
        pools[poolId] = Pool(collateralToken, debtToken, ltBps, liqBonusBps, closeFactorBps, false);
    }

    /// @notice Supplies `amount` of the pool's collateral for the caller.
    function supply(uint8 poolId, uint256 amount) external {
        Pool storage p = _pool(poolId);
        if (p.paused) revert PoolPaused(poolId);
        _positions[poolId][msg.sender].collateral += amount;
        MockERC20(p.collateralToken).transferFrom(msg.sender, address(this), amount);
    }

    /// @notice Borrows `amount` of the pool's debt token; reverts if HF after < 1.
    function borrow(uint8 poolId, uint256 amount) external {
        Pool storage p = _pool(poolId);
        if (p.paused) revert PoolPaused(poolId);
        _positions[poolId][msg.sender].debt += amount;
        if (healthFactor(poolId, msg.sender) < 1e18) revert BorrowTooMuch();
        MockERC20(p.debtToken).transfer(msg.sender, amount);
    }

    /// @notice Repays `min(amount, debt)` of the caller's debt.
    function repay(uint8 poolId, uint256 amount) external {
        Pool storage p = _pool(poolId);
        if (p.paused) revert PoolPaused(poolId);
        Position storage pos = _positions[poolId][msg.sender];
        uint256 paid = amount < pos.debt ? amount : pos.debt;
        pos.debt -= paid;
        if (paid > 0) MockERC20(p.debtToken).transferFrom(msg.sender, address(this), paid);
    }

    /// @notice Returns `user`'s health factor in wad; type(uint256).max when debt is 0.
    function healthFactor(uint8 poolId, address user) public view returns (uint256) {
        Pool storage p = _pool(poolId);
        Position storage pos = _positions[poolId][user];
        if (pos.debt == 0) return type(uint256).max;
        uint256 collateralUsd8 = _usd8(pos.collateral, p.collateralToken);
        uint256 debtUsd8 = _usd8(pos.debt, p.debtToken);
        return collateralUsd8 * p.ltBps * 1e18 / (10_000 * debtUsd8);
    }

    /// @notice Returns the user's raw collateral and debt for a pool.
    function positionOf(uint8 poolId, address user) external view returns (uint256 collateral, uint256 debt) {
        Position storage pos = _positions[poolId][user];
        return (pos.collateral, pos.debt);
    }

    /// @notice Deploy/test-only seeding of a position. Admin only; writes accounting, moves no tokens.
    function seedPosition(uint8 poolId, address user, uint256 collateral, uint256 debt) external {
        if (msg.sender != admin) revert NotAdmin();
        _pool(poolId);
        _positions[poolId][user] = Position(collateral, debt);
    }

    /// @notice Liquidates an unhealthy user; pays debt in and takes collateral plus bonus out.
    function liquidate(uint8 poolId, address user, uint256 repayAmount) external returns (uint256 collateralSeized) {
        Pool storage p = _pool(poolId);
        Position storage pos = _positions[poolId][user];
        if (healthFactor(poolId, user) >= 1e18) revert NotLiquidatable();
        if (repayAmount > pos.debt * p.closeFactorBps / 10_000) revert CloseFactorExceeded();

        uint256 repayUsd8 = _usd8(repayAmount, p.debtToken);
        uint256 seizeUsd8 = repayUsd8 * (10_000 + p.liqBonusBps) / 10_000;
        collateralSeized = _fromUsd8(seizeUsd8, p.collateralToken);
        if (collateralSeized > pos.collateral) collateralSeized = pos.collateral;

        pos.debt -= repayAmount;
        pos.collateral -= collateralSeized;

        MockERC20(p.debtToken).transferFrom(msg.sender, address(this), repayAmount);
        MockERC20(p.collateralToken).transfer(msg.sender, collateralSeized);

        emit Liquidated(poolId, user, msg.sender, repayAmount, collateralSeized, repayUsd8 * p.liqBonusBps / 10_000);
    }

    /// @notice Pauses or unpauses user actions on a pool. Admin only; liquidations stay enabled.
    function setPoolPaused(uint8 poolId, bool paused) external {
        if (msg.sender != admin) revert NotAdmin();
        _pool(poolId).paused = paused;
    }

    function _pool(uint8 poolId) private view returns (Pool storage p) {
        p = pools[poolId];
        if (p.collateralToken == address(0)) revert InvalidPool(poolId);
    }

    function _usd8(uint256 amount, address token) private view returns (uint256) {
        (uint256 priceUsd8,) = oracle.getPrice(token);
        return amount * priceUsd8 / 10 ** uint256(MockERC20(token).decimals());
    }

    function _fromUsd8(uint256 usd8, address token) private view returns (uint256) {
        (uint256 priceUsd8,) = oracle.getPrice(token);
        return usd8 * 10 ** uint256(MockERC20(token).decimals()) / priceUsd8;
    }
}
