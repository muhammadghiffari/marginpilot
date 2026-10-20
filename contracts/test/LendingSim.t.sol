// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {Test} from "forge-std/Test.sol";
import {MockERC20} from "../src/MockERC20.sol";
import {MockOracle} from "../src/MockOracle.sol";
import {LendingSim} from "../src/LendingSim.sol";

/// @notice A-02 tests: worked-example health factors, borrow boundary, repay cap, pause, liquidation math.
contract LendingSimTest is Test {
    MockERC20 private usdc;
    MockERC20 private weth;
    MockERC20 private wsteth;
    MockOracle private oracle;
    LendingSim private sim;

    address private alice = makeAddr("alice");
    address private bob = makeAddr("bob");
    address private liquidator = makeAddr("liquidator");

    function setUp() public {
        usdc = new MockERC20("Mock USD Coin", "mUSDC", 6);
        weth = new MockERC20("Mock Wrapped Ether", "mWETH", 18);
        wsteth = new MockERC20("Mock Wrapped stETH", "mWSTETH", 18);
        oracle = new MockOracle();
        sim = new LendingSim(address(oracle));

        sim.setPool(0, address(weth), address(usdc), 8250, 500, 5000);
        sim.setPool(1, address(wsteth), address(usdc), 8000, 700, 5000);

        oracle.setPrice(address(usdc), 1e8);
        oracle.setPrice(address(weth), 2000e8);
        oracle.setPrice(address(wsteth), 2300e8);

        usdc.mint(address(sim), 10_000e6);
        _openPositions();
    }

    function _openPositions() private {
        weth.mint(alice, 1e18);
        wsteth.mint(alice, 2e18);
        vm.startPrank(alice);
        weth.approve(address(sim), 1e18);
        sim.supply(0, 1e18);
        sim.borrow(0, 1400e6);
        wsteth.approve(address(sim), 2e18);
        sim.supply(1, 2e18);
        sim.borrow(1, 2800e6);
        vm.stopPrank();
    }

    function _shock() private {
        oracle.setPrice(address(weth), 1600e8);
        oracle.setPrice(address(wsteth), 1840e8);
    }

    function test_PoolConfig() public view {
        (
            address collateralToken,
            address debtToken,
            uint32 ltBps,
            uint32 liqBonusBps,
            uint32 closeFactorBps,
            bool paused
        ) = sim.pools(0);
        assertEq(collateralToken, address(weth));
        assertEq(debtToken, address(usdc));
        assertEq(ltBps, 8250);
        assertEq(liqBonusBps, 500);
        assertEq(closeFactorBps, 5000);
        assertFalse(paused);
    }

    function test_HealthFactor_ShockState() public {
        _shock();
        assertApproxEqAbs(sim.healthFactor(0, alice), 0.942857e18, 1e12);
        assertApproxEqAbs(sim.healthFactor(1, alice), 1.051429e18, 1e12);
    }

    function test_HealthFactor_ZeroDebtIsMax() public view {
        assertEq(sim.healthFactor(0, bob), type(uint256).max);
    }

    function test_Borrow_AtExactlyOneAllowedThenReverts() public {
        vm.startPrank(alice);
        sim.borrow(0, 250e6);
        assertEq(sim.healthFactor(0, alice), 1e18);

        vm.expectRevert(LendingSim.BorrowTooMuch.selector);
        sim.borrow(0, 1);
        vm.stopPrank();
    }

    function test_Repay_CapsAtDebt() public {
        uint256 balanceBefore = usdc.balanceOf(alice);
        vm.startPrank(alice);
        usdc.approve(address(sim), 2000e6);
        sim.repay(0, 2000e6);
        vm.stopPrank();

        (, uint256 debt) = sim.positionOf(0, alice);
        assertEq(debt, 0);
        assertEq(usdc.balanceOf(alice), balanceBefore - 1400e6);
        assertEq(sim.healthFactor(0, alice), type(uint256).max);
    }

    function test_PausedPool_BlocksSupplyBorrowRepay() public {
        sim.setPoolPaused(1, true);
        vm.startPrank(alice);
        vm.expectRevert(abi.encodeWithSelector(LendingSim.PoolPaused.selector, 1));
        sim.supply(1, 1);
        vm.expectRevert(abi.encodeWithSelector(LendingSim.PoolPaused.selector, 1));
        sim.borrow(1, 1);
        vm.expectRevert(abi.encodeWithSelector(LendingSim.PoolPaused.selector, 1));
        sim.repay(1, 1);
        vm.stopPrank();
    }

    function test_Liquidate_EventAndBalances() public {
        _shock();
        usdc.mint(liquidator, 700e6);
        vm.startPrank(liquidator);
        usdc.approve(address(sim), 700e6);
        vm.expectEmit(true, true, true, true, address(sim));
        emit LendingSim.Liquidated(0, alice, liquidator, 700e6, 459_375_000_000_000_000, 35e8);
        uint256 seized = sim.liquidate(0, alice, 700e6);
        vm.stopPrank();

        assertEq(seized, 459_375_000_000_000_000);
        assertEq(weth.balanceOf(liquidator), seized);
        (uint256 collateral, uint256 debt) = sim.positionOf(0, alice);
        assertEq(collateral, 1e18 - seized);
        assertEq(debt, 700e6);
    }

    function test_Liquidate_RevertsIfHealthy() public {
        vm.prank(liquidator);
        vm.expectRevert(LendingSim.NotLiquidatable.selector);
        sim.liquidate(0, alice, 1);
    }

    function test_Liquidate_RevertsAboveCloseFactor() public {
        _shock();
        vm.prank(liquidator);
        vm.expectRevert(LendingSim.CloseFactorExceeded.selector);
        sim.liquidate(0, alice, 700e6 + 1);
    }

    function test_Liquidate_WorksWhilePoolPaused() public {
        _shock();
        sim.setPoolPaused(0, true);
        usdc.mint(liquidator, 700e6);
        vm.startPrank(liquidator);
        usdc.approve(address(sim), 700e6);
        uint256 seized = sim.liquidate(0, alice, 700e6);
        vm.stopPrank();

        assertEq(seized, 459_375_000_000_000_000);
    }

    function test_SetPoolPaused_AdminOnly() public {
        vm.prank(alice);
        vm.expectRevert(LendingSim.NotAdmin.selector);
        sim.setPoolPaused(0, true);
    }
}
