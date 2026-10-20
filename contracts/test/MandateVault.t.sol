// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {Test} from "forge-std/Test.sol";
import {MockERC20} from "../src/MockERC20.sol";
import {MockOracle} from "../src/MockOracle.sol";
import {MandateVault} from "../src/MandateVault.sol";

/// @notice A-04 tests: auth, pause, owner withdrawal, then owner-signed mandates.
contract MandateVaultTest is Test {
    MockERC20 private usdc;
    MockOracle private oracle;
    MandateVault private vault;

    address private owner;
    address private executor = makeAddr("executor");
    address private alice = makeAddr("alice");

    uint256 private constant OWNER_PK = 0xA11CE;

    function setUp() public {
        owner = vm.addr(OWNER_PK);
        usdc = new MockERC20("Mock USD Coin", "mUSDC", 6);
        oracle = new MockOracle();
        vault = new MandateVault(owner, executor, address(oracle), address(usdc));
        usdc.mint(address(vault), 1_000e6);
    }

    function test_Constructor_SetsRoles() public view {
        assertEq(vault.owner(), owner);
        assertEq(vault.executor(), executor);
        assertEq(address(vault.oracle()), address(oracle));
        assertEq(address(vault.reserveToken()), address(usdc));
        assertFalse(vault.paused());
    }

    function test_Pause_Owner() public {
        vm.prank(owner);
        vault.pause();
        assertTrue(vault.paused());
    }

    function test_Pause_Executor() public {
        vm.prank(executor);
        vault.pause();
        assertTrue(vault.paused());
    }

    function test_Pause_OutsiderReverts() public {
        vm.prank(alice);
        vm.expectRevert(MandateVault.NotExecutor.selector);
        vault.pause();
    }

    function test_Pause_EmitsEvent() public {
        vm.expectEmit(true, false, false, true, address(vault));
        emit MandateVault.VaultPaused(owner);
        vm.prank(owner);
        vault.pause();
    }

    function test_Unpause_OwnerOnly() public {
        vm.prank(executor);
        vault.pause();

        vm.prank(executor);
        vm.expectRevert(MandateVault.NotOwner.selector);
        vault.unpause();

        vm.expectEmit(true, false, false, true, address(vault));
        emit MandateVault.VaultUnpaused(owner);
        vm.prank(owner);
        vault.unpause();
        assertFalse(vault.paused());
    }

    function test_OwnerWithdraw_WorksWhilePausedAndNoMandate() public {
        vm.prank(executor);
        vault.pause();

        vm.prank(owner);
        vault.ownerWithdraw(address(usdc), 400e6, alice);

        assertEq(usdc.balanceOf(alice), 400e6);
        assertEq(usdc.balanceOf(address(vault)), 600e6);
    }

    function test_OwnerWithdraw_OnlyOwner() public {
        vm.prank(alice);
        vm.expectRevert(MandateVault.NotOwner.selector);
        vault.ownerWithdraw(address(usdc), 1, alice);
    }

    function test_SetExecutor_OwnerOnlyAndEffective() public {
        address newExecutor = makeAddr("newExecutor");

        vm.prank(alice);
        vm.expectRevert(MandateVault.NotOwner.selector);
        vault.setExecutor(newExecutor);

        vm.expectEmit(true, false, false, true, address(vault));
        emit MandateVault.ExecutorChanged(newExecutor);
        vm.prank(owner);
        vault.setExecutor(newExecutor);
        assertEq(vault.executor(), newExecutor);

        vm.prank(executor);
        vm.expectRevert(MandateVault.NotExecutor.selector);
        vault.pause();

        vm.prank(newExecutor);
        vault.pause();
        assertTrue(vault.paused());
    }
}
