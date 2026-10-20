// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {Test} from "forge-std/Test.sol";
import {MockERC20} from "../src/MockERC20.sol";
import {MockOracle} from "../src/MockOracle.sol";
import {MockSwap} from "../src/MockSwap.sol";

/// @notice A-03 tests: 30 bps fee both directions, exact-min boundary, slippage revert, broken switch.
contract MockSwapTest is Test {
    MockERC20 private usdc;
    MockERC20 private weth;
    MockOracle private oracle;
    MockSwap private swapContract;

    address private alice = makeAddr("alice");

    function setUp() public {
        usdc = new MockERC20("Mock USD Coin", "mUSDC", 6);
        weth = new MockERC20("Mock Wrapped Ether", "mWETH", 18);
        oracle = new MockOracle();
        swapContract = new MockSwap(address(oracle));

        oracle.setPrice(address(usdc), 1e8);
        oracle.setPrice(address(weth), 2000e8);

        weth.mint(address(swapContract), 10e18);
        usdc.mint(address(swapContract), 100_000e6);
        usdc.mint(alice, 1_000e6);

        vm.prank(alice);
        usdc.approve(address(swapContract), type(uint256).max);
    }

    function test_Swap_ChargesThirtyBps_UsdcToWeth() public {
        uint256 expected = 49_850_000_000_000_000;
        assertEq(swapContract.feeBps(), 30);

        vm.prank(alice);
        uint256 out = swapContract.swap(address(usdc), address(weth), 100e6, expected);

        assertEq(out, expected);
        assertEq(weth.balanceOf(alice), expected);
        assertEq(usdc.balanceOf(alice), 900e6);
    }

    function test_Swap_ChargesThirtyBps_WethToUsdc() public {
        weth.mint(alice, 0.05e18);

        vm.startPrank(alice);
        weth.approve(address(swapContract), 0.05e18);
        uint256 out = swapContract.swap(address(weth), address(usdc), 0.05e18, 99_700_000);
        vm.stopPrank();

        assertEq(out, 99_700_000);
        assertEq(usdc.balanceOf(alice), 1_099_700_000);
    }

    function test_Swap_RevertsOneUnitAboveSlippage() public {
        vm.prank(alice);
        vm.expectRevert(MockSwap.SlippageExceeded.selector);
        swapContract.swap(address(usdc), address(weth), 100e6, 49_850_000_000_000_001);

        assertEq(usdc.balanceOf(alice), 1_000e6);
    }

    function test_SetBroken_TogglesSwapRevert() public {
        swapContract.setBroken(true);
        vm.prank(alice);
        vm.expectRevert(MockSwap.SwapBroken.selector);
        swapContract.swap(address(usdc), address(weth), 100e6, 0);

        swapContract.setBroken(false);
        vm.prank(alice);
        uint256 out = swapContract.swap(address(usdc), address(weth), 100e6, 0);
        assertEq(out, 49_850_000_000_000_000);
    }

    function test_SetBroken_AdminOnly() public {
        vm.prank(alice);
        vm.expectRevert(MockSwap.NotAdmin.selector);
        swapContract.setBroken(true);
    }
}
