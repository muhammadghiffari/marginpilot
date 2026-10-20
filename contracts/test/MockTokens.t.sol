// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {Test} from "forge-std/Test.sol";
import {MockERC20} from "../src/MockERC20.sol";
import {MockOracle} from "../src/MockOracle.sol";

/// @notice A-01 tests: token decimals, admin-only mint, allowance, oracle timestamps and unknown tokens.
contract MockTokensTest is Test {
    MockERC20 private usdc;
    MockERC20 private weth;
    MockERC20 private wsteth;
    MockOracle private oracle;

    address private alice = makeAddr("alice");
    address private bob = makeAddr("bob");

    function setUp() public {
        usdc = new MockERC20("Mock USD Coin", "mUSDC", 6);
        weth = new MockERC20("Mock Wrapped Ether", "mWETH", 18);
        wsteth = new MockERC20("Mock Wrapped stETH", "mWSTETH", 18);
        oracle = new MockOracle();
    }

    function test_MockERC20_Decimals() public view {
        assertEq(usdc.decimals(), 6);
        assertEq(weth.decimals(), 18);
        assertEq(wsteth.decimals(), 18);
    }

    function test_MockERC20_MintAdminOnly() public {
        usdc.mint(alice, 100e6);
        assertEq(usdc.balanceOf(alice), 100e6);
        assertEq(usdc.totalSupply(), 100e6);

        vm.prank(alice);
        vm.expectRevert(MockERC20.NotAdmin.selector);
        usdc.mint(alice, 1);
    }

    function test_MockERC20_TransferFromSpendsAllowance() public {
        usdc.mint(alice, 10e6);
        vm.prank(alice);
        usdc.approve(bob, 4e6);

        vm.prank(bob);
        usdc.transferFrom(alice, bob, 4e6);
        assertEq(usdc.balanceOf(bob), 4e6);
        assertEq(usdc.balanceOf(alice), 6e6);
        assertEq(usdc.allowance(alice, bob), 0);

        vm.prank(bob);
        vm.expectRevert(MockERC20.InsufficientAllowance.selector);
        usdc.transferFrom(alice, bob, 1);
    }

    function test_MockOracle_SetPriceUsesNow() public {
        vm.warp(1_700_000_000);
        oracle.setPrice(address(weth), 2000e8);

        (uint256 price, uint256 updatedAt) = oracle.getPrice(address(weth));
        assertEq(price, 2000e8);
        assertEq(updatedAt, 1_700_000_000);
    }

    function test_MockOracle_SetPriceAtKeepsTimestamp() public {
        oracle.setPriceAt(address(weth), 2300e8, 1_600_000_000);

        (uint256 price, uint256 updatedAt) = oracle.getPrice(address(weth));
        assertEq(price, 2300e8);
        assertEq(updatedAt, 1_600_000_000);
    }

    function test_MockOracle_UnknownToken() public {
        vm.expectRevert(abi.encodeWithSelector(MockOracle.UnknownToken.selector, address(wsteth)));
        oracle.getPrice(address(wsteth));
    }

    function test_MockOracle_AdminOnly() public {
        vm.prank(alice);
        vm.expectRevert(MockOracle.NotAdmin.selector);
        oracle.setPrice(address(weth), 1e8);
    }
}
