// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {Test} from "forge-std/Test.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {MockERC20} from "../src/MockERC20.sol";
import {MockOracle} from "../src/MockOracle.sol";
import {MockSwap} from "../src/MockSwap.sol";
import {LendingSim} from "../src/LendingSim.sol";
import {MandateVault} from "../src/MandateVault.sol";

/// @dev Test-only harness exposing the vault's EIP-712 digest and spend slot for cross-checks.
contract MandateVaultHarness is MandateVault {
    constructor(address owner_, address executor_, address oracle_, address reserveToken_)
        MandateVault(owner_, executor_, oracle_, reserveToken_)
    {}

    function hashSetMandateActual(Mandate calldata m, uint256 deadline) external view returns (bytes32) {
        return _hashTypedDataV4(keccak256(abi.encode(SET_MANDATE_TYPEHASH, _mandateStructHash(m), deadline)));
    }

    function hashSetMandateFor(Mandate calldata m, uint256 deadline, uint256 chainId, address verifyingContract)
        external
        pure
        returns (bytes32)
    {
        bytes32 domainSeparator = keccak256(
            abi.encode(
                keccak256("EIP712Domain(string name,string version,uint256 chainId,address verifyingContract)"),
                keccak256("MarginPilotVault"),
                keccak256("1"),
                chainId,
                verifyingContract
            )
        );
        return keccak256(
            abi.encodePacked(
                "\x19\x01",
                domainSeparator,
                keccak256(abi.encode(SET_MANDATE_TYPEHASH, _mandateStructHash(m), deadline))
            )
        );
    }

    function setSpent(uint64 id, uint128 value) external {
        spentUsd[id] = value;
    }
}

/// @dev Executor/target that re-enters execute during the target call.
contract ReentrantExecutor {
    MandateVault private vault;
    MandateVault.Action private inner;

    function run(MandateVault vault_, MandateVault.Action calldata outer, MandateVault.Action calldata inner_)
        external
    {
        vault = vault_;
        inner = inner_;
        vault_.execute(outer);
    }

    function swap(address, address, uint256, uint256) external returns (uint256) {
        vault.execute(inner);
        return 0;
    }
}

/// @dev Target that tries to pull one unit more than the vault approved.
contract GreedySwap {
    function swap(address tokenIn, address, uint256 amountIn, uint256) external returns (uint256) {
        MockERC20(tokenIn).transferFrom(msg.sender, address(this), amountIn + 1);
        return 0;
    }
}

/// @notice A-04 tests: auth, pause, owner withdrawal, then owner-signed mandates.
contract MandateVaultTest is Test {
    MockERC20 private usdc;
    MockERC20 private weth;
    MockERC20 private wsteth;
    MockOracle private oracle;
    LendingSim private sim;
    MockSwap private swap;
    MandateVaultHarness private vault;

    address private owner;
    address private executor = makeAddr("executor");
    address private alice = makeAddr("alice");

    uint256 private constant OWNER_PK = 0xA11CE;
    uint256 private constant OTHER_PK = 0xB0B;

    // Literal EIP-712 type strings copied from CONTRACTS §2.5; independent of the contract constants.
    bytes32 private constant MANDATE_TYPEHASH = keccak256(
        "Mandate(uint64 id,uint64 validFrom,uint64 validUntil,uint128 maxTotalSpendUsd,uint128 maxPerActionUsd,uint128 minLiquidReserveUsd,uint32 maxSlippageBps,uint32 maxPriceAgeSec,uint32 maxPriceDeviationBps,uint8 allowedActions,bool allowBorrow,address[] allowedTargets,address[] lockedTokens)"
    );
    bytes32 private constant SET_MANDATE_TYPEHASH = keccak256(
        "SetMandate(Mandate mandate,uint256 deadline)Mandate(uint64 id,uint64 validFrom,uint64 validUntil,uint128 maxTotalSpendUsd,uint128 maxPerActionUsd,uint128 minLiquidReserveUsd,uint32 maxSlippageBps,uint32 maxPriceAgeSec,uint32 maxPriceDeviationBps,uint8 allowedActions,bool allowBorrow,address[] allowedTargets,address[] lockedTokens)"
    );

    function setUp() public {
        vm.warp(1_700_000_000);
        owner = vm.addr(OWNER_PK);
        usdc = new MockERC20("Mock USD Coin", "mUSDC", 6);
        weth = new MockERC20("Mock Wrapped Ether", "mWETH", 18);
        wsteth = new MockERC20("Mock Wrapped stETH", "mWSTETH", 18);
        oracle = new MockOracle();
        sim = new LendingSim(address(oracle));
        sim.setPool(0, address(weth), address(usdc), 8250, 500, 5000);
        sim.setPool(1, address(wsteth), address(usdc), 8000, 700, 5000);
        swap = new MockSwap(address(oracle));
        vault = new MandateVaultHarness(owner, executor, address(oracle), address(usdc));

        oracle.setPrice(address(usdc), 1e8);
        oracle.setPrice(address(weth), 1600e8);
        oracle.setPrice(address(wsteth), 1840e8);

        usdc.mint(address(vault), 1_000e6);
        weth.mint(address(vault), 1e18);
        wsteth.mint(address(vault), 1e18);

        // Seed MockSwap so SWAP actions can pay tokenOut.
        usdc.mint(address(swap), 10_000e6);
        weth.mint(address(swap), 10e18);
        wsteth.mint(address(swap), 10e18);

        // Seed LendingSim so BORROW actions can pay the debt token.
        usdc.mint(address(sim), 10_000e6);
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

    function test_Typehash_MatchesSpec() public view {
        assertEq(vault.MANDATE_TYPEHASH(), MANDATE_TYPEHASH);
        assertEq(vault.SET_MANDATE_TYPEHASH(), SET_MANDATE_TYPEHASH);
        // Literal from viem keccak256 of the EIP-712 encodeType (full referenced Mandate type appended).
        assertEq(vault.SET_MANDATE_TYPEHASH(), 0x5583d826a258142a6c4bd0b40783c1104bd5b39f2959c103664100ab596cb01c);
    }

    function test_Eip712Digest_MatchesViem_NonEmptyArrays() public {
        MandateVaultHarness h = new MandateVaultHarness(owner, executor, address(oracle), address(usdc));
        MandateVault.Mandate memory m = _viemMandate(true);
        bytes32 expected = 0xdd69f17f30dae164906d98e21691e7b1884a369102fd85480ff28842a68c4eef;

        assertEq(h.hashSetMandateFor(m, 1_700_003_600, 31337, 0x000000000000000000000000000000000000cafE), expected);
        assertEq(
            h.hashSetMandateActual(m, 1_700_003_600), h.hashSetMandateFor(m, 1_700_003_600, block.chainid, address(h))
        );
    }

    function test_Eip712Digest_MatchesViem_EmptyArrays() public {
        MandateVaultHarness h = new MandateVaultHarness(owner, executor, address(oracle), address(usdc));
        MandateVault.Mandate memory m = _viemMandate(false);
        bytes32 expected = 0xc136a547b79c32017f33f867e79c2201f1a6319307af3e626dc8d1712ccce28b;

        assertEq(h.hashSetMandateFor(m, 1_700_003_600, 31337, 0x000000000000000000000000000000000000cafE), expected);
        assertEq(
            h.hashSetMandateActual(m, 1_700_003_600), h.hashSetMandateFor(m, 1_700_003_600, block.chainid, address(h))
        );
    }

    function test_SetMandate_OwnerStoresAndActivates() public {
        MandateVault.Mandate memory m = _mandate(1);
        bytes32 expectedHash = _mandateStructHash(m);

        vm.expectEmit(false, false, false, true, address(vault));
        emit MandateVault.MandateSet(1, expectedHash);
        vm.prank(owner);
        vault.setMandate(m);

        MandateVault.Mandate memory stored = vault.mandate();
        assertEq(stored.id, 1);
        assertEq(stored.maxTotalSpendUsd, 260e8);
        assertEq(stored.allowedActions, 3);
        assertEq(stored.allowedTargets.length, 1);
        assertEq(stored.allowedTargets[0], address(0x1234));
        assertEq(stored.lockedTokens[0], address(0xBEEF));
        assertEq(vault.activeMandateId(), 1);
        assertEq(vault.nextMandateId(), 2);
        assertEq(vault.spentUsd(1), 0);
    }

    function test_SetMandate_OnlyOwner() public {
        vm.prank(alice);
        vm.expectRevert(MandateVault.NotOwner.selector);
        vault.setMandate(_mandate(1));
    }

    function test_SetMandate_IdMustBeNext() public {
        vm.prank(owner);
        vault.setMandate(_mandate(1));

        vm.prank(owner);
        vm.expectRevert(MandateVault.BadNonce.selector);
        vault.setMandate(_mandate(1));

        vm.prank(owner);
        vm.expectRevert(MandateVault.BadNonce.selector);
        vault.setMandate(_mandate(3));

        vm.prank(owner);
        vault.setMandate(_mandate(2));
        assertEq(vault.activeMandateId(), 2);
        assertEq(vault.nextMandateId(), 3);
    }

    function test_SetMandateWithSig_ValidFromRelayer() public {
        MandateVault.Mandate memory m = _mandate(1);
        uint256 deadline = block.timestamp + 1 hours;
        bytes memory sig = _sign(OWNER_PK, m, deadline);

        vm.prank(alice);
        vault.setMandateWithSig(m, deadline, sig);

        MandateVault.Mandate memory stored = vault.mandate();
        assertEq(stored.id, 1);
        assertEq(stored.lockedTokens[0], address(0xBEEF));
        assertEq(vault.activeMandateId(), 1);
        assertEq(vault.nextMandateId(), 2);
    }

    function test_SetMandateWithSig_WrongSigner() public {
        MandateVault.Mandate memory m = _mandate(1);
        uint256 deadline = block.timestamp + 1 hours;
        bytes memory sig = _sign(OTHER_PK, m, deadline);

        vm.prank(alice);
        vm.expectRevert(MandateVault.BadSignature.selector);
        vault.setMandateWithSig(m, deadline, sig);
    }

    function test_SetMandateWithSig_ReplayRevertsBadNonce() public {
        MandateVault.Mandate memory m = _mandate(1);
        uint256 deadline = block.timestamp + 1 hours;
        bytes memory sig = _sign(OWNER_PK, m, deadline);

        vm.prank(alice);
        vault.setMandateWithSig(m, deadline, sig);

        vm.prank(alice);
        vm.expectRevert(MandateVault.BadNonce.selector);
        vault.setMandateWithSig(m, deadline, sig);
    }

    function test_SetMandateWithSig_ExpiredDeadline() public {
        vm.warp(1_700_000_000);
        MandateVault.Mandate memory m = _mandate(1);
        uint256 deadline = block.timestamp - 1;
        bytes memory sig = _sign(OWNER_PK, m, deadline);

        vm.prank(alice);
        vm.expectRevert(MandateVault.SignatureExpired.selector);
        vault.setMandateWithSig(m, deadline, sig);
    }

    function test_SetMandateWithSig_IdMustBeNext() public {
        MandateVault.Mandate memory m = _mandate(2);
        uint256 deadline = block.timestamp + 1 hours;
        bytes memory sig = _sign(OWNER_PK, m, deadline);

        vm.prank(alice);
        vm.expectRevert(MandateVault.BadNonce.selector);
        vault.setMandateWithSig(m, deadline, sig);
    }

    function test_OwnerWithdraw_WorksWithExpiredMandate() public {
        vm.warp(1_700_000_000);
        MandateVault.Mandate memory m = _mandate(1);
        m.validFrom = uint64(block.timestamp - 2 days);
        m.validUntil = uint64(block.timestamp - 1 days);

        vm.prank(owner);
        vault.setMandate(m);

        vm.prank(owner);
        vault.ownerWithdraw(address(usdc), 100e6, alice);
        assertEq(usdc.balanceOf(alice), 100e6);
    }

    // ---------------------------------------------------------------------
    // A-04.3: execute checks #1-#15 (effects intentionally not implemented)
    // ---------------------------------------------------------------------

    function test_Execute_Check01_NotExecutor() public {
        _setExecMandate(false, 7);
        MandateVault.Action memory a = _baseAction();

        vm.prank(alice);
        vm.expectRevert(MandateVault.NotExecutor.selector);
        vault.execute(a);
    }

    function test_Execute_Check01_ExecutorPasses() public {
        _setExecMandate(false, 7);
        MandateVault.Action memory a = _baseAction();

        vm.prank(executor);
        assertEq(vault.execute(a), 100e8);
    }

    function test_Execute_Check02_Paused() public {
        _setExecMandate(false, 7);
        vm.prank(owner);
        vault.pause();
        MandateVault.Action memory a = _baseAction();

        vm.prank(executor);
        vm.expectRevert(MandateVault.Paused.selector);
        vault.execute(a);
    }

    function test_Execute_Check02_UnpausedPasses() public {
        _setExecMandate(false, 7);
        vm.prank(executor);
        vault.pause();
        vm.prank(owner);
        vault.unpause();
        MandateVault.Action memory a = _baseAction();

        vm.prank(executor);
        assertEq(vault.execute(a), 100e8);
    }

    function test_Execute_Check03_NoMandate() public {
        MandateVault.Action memory a = _baseAction();

        vm.prank(executor);
        vm.expectRevert(MandateVault.MandateInactive.selector);
        vault.execute(a);
    }

    function test_Execute_Check03_ActiveMandatePasses() public {
        _setExecMandate(false, 7);
        MandateVault.Action memory a = _baseAction();

        vm.prank(executor);
        assertEq(vault.execute(a), 100e8);
    }

    function test_RevokeMandate_OnlyOwner() public {
        _setExecMandate(false, 7);

        vm.prank(alice);
        vm.expectRevert(MandateVault.NotOwner.selector);
        vault.revokeMandate();
    }

    function test_RevokeMandate_ClearsAndBlocksExecution() public {
        _setExecMandate(false, 7);

        vm.expectEmit(false, false, false, true, address(vault));
        emit MandateVault.MandateRevoked(1);
        vm.prank(owner);
        vault.revokeMandate();

        assertEq(vault.activeMandateId(), 0);
        assertEq(vault.mandate().id, 0);
        MandateVault.Action memory a = _baseAction();

        vm.prank(executor);
        vm.expectRevert(MandateVault.MandateInactive.selector);
        vault.execute(a);
    }

    function test_RevokeMandate_NoActiveReverts() public {
        vm.prank(owner);
        vm.expectRevert(MandateVault.MandateInactive.selector);
        vault.revokeMandate();
    }

    function test_Execute_Check04_WrongMandateId() public {
        _setExecMandate(false, 7);
        MandateVault.Action memory a = _baseAction();
        a.mandateId = 99;

        vm.prank(executor);
        vm.expectRevert(MandateVault.StaleAction.selector);
        vault.execute(a);
    }

    function test_Execute_Check04_WrongNonce() public {
        _setExecMandate(false, 7);
        MandateVault.Action memory a = _baseAction();
        a.nonce = 1;

        vm.prank(executor);
        vm.expectRevert(MandateVault.StaleAction.selector);
        vault.execute(a);
    }

    function test_Execute_Check04_CurrentIdAndNoncePasses() public {
        _setExecMandate(false, 7);
        MandateVault.Action memory a = _baseAction();

        vm.prank(executor);
        assertEq(vault.execute(a), 100e8);
    }

    function test_Execute_Check05_DeadlineExpired() public {
        _setExecMandate(false, 7);
        MandateVault.Action memory a = _baseAction();
        a.deadline = uint64(block.timestamp - 1);

        vm.prank(executor);
        vm.expectRevert(MandateVault.DeadlineExpired.selector);
        vault.execute(a);
    }

    function test_Execute_Check05_DeadlineNowPasses() public {
        _setExecMandate(false, 7);
        MandateVault.Action memory a = _baseAction();
        a.deadline = uint64(block.timestamp);

        vm.prank(executor);
        assertEq(vault.execute(a), 100e8);
    }

    function test_Execute_Check06_MandateExpiredAfter() public {
        _setExecMandate(false, 7);
        MandateVault.Action memory a = _baseAction();
        vm.warp(block.timestamp + 2 days);
        a.deadline = uint64(block.timestamp + 1 hours);

        vm.prank(executor);
        vm.expectRevert(MandateVault.MandateExpired.selector);
        vault.execute(a);
    }

    function test_Execute_Check06_MandateNotYetValid() public {
        _setMandateFull(false, 7, 260e8, 260e8, uint64(block.timestamp + 1 hours), uint64(block.timestamp + 1 days));
        MandateVault.Action memory a = _baseAction();

        vm.prank(executor);
        vm.expectRevert(MandateVault.MandateExpired.selector);
        vault.execute(a);
    }

    function test_Execute_Check06_ValidUntilBoundaryPasses() public {
        _setExecMandate(false, 7);
        uint256 validUntil = vault.mandate().validUntil;
        vm.warp(validUntil);
        oracle.setPrice(address(usdc), 1e8);
        oracle.setPrice(address(weth), 1600e8);
        oracle.setPrice(address(wsteth), 1840e8);

        MandateVault.Action memory a = _baseAction();
        a.deadline = uint64(block.timestamp);
        vm.prank(executor);
        assertEq(vault.execute(a), 100e8);
    }

    function test_Execute_Check07_ZeroAmount() public {
        _setExecMandate(false, 7);
        MandateVault.Action memory a = _baseAction();
        a.amount = 0;

        vm.prank(executor);
        vm.expectRevert(MandateVault.ZeroAmount.selector);
        vault.execute(a);
    }

    function test_Execute_Check07_OneUnitPasses() public {
        _setExecMandate(false, 7);
        MandateVault.Action memory a = _baseAction();
        a.amount = 1;

        vm.prank(executor);
        assertEq(vault.execute(a), 100); // 1 raw mUSDC unit = 100 usd8
    }

    function test_Execute_Check08_BorrowForbidden() public {
        _setExecMandate(false, 7);
        MandateVault.Action memory a = _baseAction();
        a.actionType = MandateVault.ActionType.BORROW;
        a.amount = 1e6;

        vm.prank(executor);
        vm.expectRevert(MandateVault.BorrowForbidden.selector);
        vault.execute(a);
    }

    function test_Execute_Check08_ActionNotAllowed() public {
        _setExecMandate(false, 3); // REPAY | SUPPLY_COLLATERAL, SWAP off
        MandateVault.Action memory a = _swapAction(100e6, 0);

        vm.prank(executor);
        vm.expectRevert(MandateVault.ActionNotAllowed.selector);
        vault.execute(a);
    }

    function test_Execute_Check08_BorrowAllowedReachesPostCondition() public {
        _setExecMandate(true, 7);
        _supplyVaultCollateral(1e18);
        MandateVault.Action memory a = _baseAction();
        a.actionType = MandateVault.ActionType.BORROW;
        a.amount = 1e6;

        // #8 passes; BORROW lowers HF, so #16 must reject it.
        vm.prank(executor);
        vm.expectRevert(MandateVault.PostConditionFailed.selector);
        vault.execute(a);
    }

    function test_Execute_Check08_SwapAllowedPasses() public {
        _setExecMandate(false, 7);
        MandateVault.Action memory a = _swapAction(100e6, 0.061875e18);

        vm.prank(executor);
        assertEq(vault.execute(a), 100e8);
    }

    function test_Execute_Check08_SupplyAllowedPasses() public {
        _setExecMandate(false, 7);
        MandateVault.Action memory a = _baseAction();
        a.actionType = MandateVault.ActionType.SUPPLY_COLLATERAL;
        a.tokenIn = address(weth);
        a.amount = 0.01e18;
        a.quotedPriceUsd8 = 1600e8;

        vm.prank(executor);
        assertEq(vault.execute(a), 16e8);
    }

    function test_Execute_Check09_TargetNotAllowed() public {
        _setExecMandate(false, 7);
        MandateVault.Action memory a = _baseAction();
        a.target = alice;

        vm.prank(executor);
        vm.expectRevert(MandateVault.TargetNotAllowed.selector);
        vault.execute(a);
    }

    function test_Execute_Check09_AllowedTargetPasses() public {
        _setExecMandate(false, 7);
        MandateVault.Action memory a = _baseAction();

        vm.prank(executor);
        assertEq(vault.execute(a), 100e8);
    }

    function test_Execute_Check09_SwapAtLendingSimRevertsTargetNotAllowed() public {
        _setExecMandate(false, 7);
        MandateVault.Action memory a = _swapAction(100e6, 0.061875e18);
        a.target = address(sim); // allowed target, but not the swap target

        vm.prank(executor);
        vm.expectRevert(MandateVault.TargetNotAllowed.selector);
        vault.execute(a);
    }

    function test_Execute_Check10_RepayLockedToken() public {
        _setExecMandate(false, 7);
        MandateVault.Action memory a = _baseAction();
        a.tokenIn = address(weth);
        a.quotedPriceUsd8 = 1600e8;

        vm.prank(executor);
        vm.expectRevert(MandateVault.AssetLocked.selector);
        vault.execute(a);
    }

    function test_Execute_Check10_SwapLockedToken() public {
        _setExecMandate(false, 7);
        MandateVault.Action memory a = _swapAction(0.01e18, 0);
        a.tokenIn = address(weth);
        a.quotedPriceUsd8 = 1600e8;

        vm.prank(executor);
        vm.expectRevert(MandateVault.AssetLocked.selector);
        vault.execute(a);
    }

    function test_Execute_Check10_UnlockedTokenPasses() public {
        _setExecMandate(false, 7);
        MandateVault.Action memory a = _baseAction();

        vm.prank(executor);
        assertEq(vault.execute(a), 100e8);
    }

    function test_Execute_Check10_SupplyLockedTokenPasses() public {
        _setExecMandate(false, 7);
        MandateVault.Action memory a = _baseAction();
        a.actionType = MandateVault.ActionType.SUPPLY_COLLATERAL;
        a.tokenIn = address(weth);
        a.amount = 0.01e18;
        a.quotedPriceUsd8 = 1600e8;

        vm.prank(executor);
        assertEq(vault.execute(a), 16e8);
    }

    function test_Execute_Check11_StaleTokenIn() public {
        oracle.setPriceAt(address(usdc), 1e8, block.timestamp - 601);
        _setExecMandate(false, 7);
        MandateVault.Action memory a = _baseAction();

        vm.prank(executor);
        vm.expectRevert(MandateVault.StalePrice.selector);
        vault.execute(a);
    }

    function test_Execute_Check11_StalePoolCollateral() public {
        oracle.setPriceAt(address(weth), 1600e8, block.timestamp - 601);
        _setExecMandate(false, 7);
        MandateVault.Action memory a = _baseAction();

        vm.prank(executor);
        vm.expectRevert(MandateVault.StalePrice.selector);
        vault.execute(a);
    }

    function test_Execute_Check11_StaleTokenOut() public {
        oracle.setPriceAt(address(weth), 1600e8, block.timestamp - 601);
        _setExecMandate(false, 7);
        MandateVault.Action memory a = _swapAction(100e6, 0);

        vm.prank(executor);
        vm.expectRevert(MandateVault.StalePrice.selector);
        vault.execute(a);
    }

    function test_Execute_Check11_StaleReservePriceBlocksNonReserveSwap() public {
        _setExecMandate(false, 7);
        MandateVault.Action memory a = _swapAction(0.1e18, 0.11385e18);
        a.tokenIn = address(wsteth);
        a.tokenOut = address(weth);
        a.quotedPriceUsd8 = 1840e8;

        // Fresh reserve: the swap executes.
        vm.prank(executor);
        vault.execute(a);

        // Only the reserve token is stale; tokenIn/tokenOut stay fresh.
        oracle.setPriceAt(address(usdc), 1e8, block.timestamp - 601);
        a.nonce = vault.actionNonce();
        vm.prank(executor);
        vm.expectRevert(MandateVault.StalePrice.selector);
        vault.execute(a);
    }

    function test_Execute_Check11_MissingReservePriceRevertsStalePrice() public {
        _setExecMandate(false, 7);
        MandateVault.Action memory a = _swapAction(0.1e18, 0.11385e18);
        a.tokenIn = address(wsteth);
        a.tokenOut = address(weth);
        a.quotedPriceUsd8 = 1840e8;

        vm.mockCallRevert(
            address(oracle),
            abi.encodeWithSelector(MockOracle.getPrice.selector, address(usdc)),
            abi.encodeWithSelector(MockOracle.UnknownToken.selector, address(usdc))
        );

        vm.prank(executor);
        vm.expectRevert(MandateVault.StalePrice.selector);
        vault.execute(a);
    }

    function test_Execute_Check11_MissingTokenInPriceRevertsStalePrice() public {
        _setExecMandate(false, 7);
        MandateVault.Action memory a = _swapAction(0.1e18, 0.11385e18);
        a.tokenIn = address(wsteth);
        a.tokenOut = address(weth);
        a.quotedPriceUsd8 = 1840e8;

        vm.mockCallRevert(
            address(oracle),
            abi.encodeWithSelector(MockOracle.getPrice.selector, address(wsteth)),
            abi.encodeWithSelector(MockOracle.UnknownToken.selector, address(wsteth))
        );

        vm.prank(executor);
        vm.expectRevert(MandateVault.StalePrice.selector);
        vault.execute(a);
    }

    function test_Execute_Check11_OtherPoolCollateralUnaffected() public {
        oracle.setPriceAt(address(weth), 1600e8, block.timestamp - 601);
        _setExecMandate(false, 7);
        MandateVault.Action memory a = _baseAction();
        a.poolId = 1;

        vm.prank(executor);
        assertEq(vault.execute(a), 100e8);
    }

    function test_Execute_Check11_LendingActionAtMockSwapRevertsTargetNotAllowed() public {
        _setExecMandate(false, 7);
        MandateVault.Action memory a = _baseAction();
        a.target = address(swap); // allowed target, but not a LendingSim

        vm.prank(executor);
        vm.expectRevert(MandateVault.TargetNotAllowed.selector);
        vault.execute(a);
    }

    function test_Execute_Check11_LendingActionAtLendingSimPasses() public {
        _setExecMandate(false, 7);
        MandateVault.Action memory a = _baseAction();

        vm.prank(executor);
        assertEq(vault.execute(a), 100e8);
    }

    function test_Execute_Check11_PriceAgeBoundary() public {
        _setExecMandate(false, 7);
        MandateVault.Action memory a = _baseAction();
        oracle.setPriceAt(address(usdc), 1e8, block.timestamp - 600);
        vm.prank(executor);
        assertEq(vault.execute(a), 100e8);

        a.nonce = vault.actionNonce();
        oracle.setPriceAt(address(usdc), 1e8, block.timestamp - 601);
        vm.prank(executor);
        vm.expectRevert(MandateVault.StalePrice.selector);
        vault.execute(a);
    }

    function test_Execute_Check12_DeviationExceeded() public {
        oracle.setPrice(address(usdc), 1.0301e8);
        _setExecMandate(false, 7);
        MandateVault.Action memory a = _baseAction();

        vm.prank(executor);
        vm.expectRevert(MandateVault.PriceDeviation.selector);
        vault.execute(a);
    }

    function test_Execute_Check12_DeviationBoundaryPasses() public {
        oracle.setPrice(address(usdc), 1.03e8);
        _setExecMandate(false, 7);
        MandateVault.Action memory a = _baseAction();

        vm.prank(executor);
        assertEq(vault.execute(a), 103e8);
    }

    function test_Execute_Check13_PerActionCapExceeded() public {
        _setExecMandate(false, 7, 260e8, 1_000e8);
        MandateVault.Action memory a = _baseAction();
        a.amount = 260e6 + 1;

        vm.prank(executor);
        vm.expectRevert(MandateVault.PerActionCapExceeded.selector);
        vault.execute(a);
    }

    function test_Execute_Check13_AtCapPasses() public {
        _setExecMandate(false, 7, 260e8, 1_000e8);
        MandateVault.Action memory a = _baseAction();
        a.amount = 260e6;

        vm.prank(executor);
        assertEq(vault.execute(a), 260e8);
    }

    function test_Execute_Check14_BudgetExceeded() public {
        uint64 id = _setExecMandate(false, 7, 260e8, 260e8);
        vault.setSpent(id, 100e8);
        MandateVault.Action memory a = _baseAction();
        a.amount = 160e6 + 1;

        vm.prank(executor);
        vm.expectRevert(MandateVault.BudgetExceeded.selector);
        vault.execute(a);
    }

    function test_Execute_Check14_AtBudgetPasses() public {
        uint64 id = _setExecMandate(false, 7, 260e8, 260e8);
        vault.setSpent(id, 100e8);
        MandateVault.Action memory a = _baseAction();
        a.amount = 160e6;

        vm.prank(executor);
        assertEq(vault.execute(a), 160e8);
    }

    function test_Execute_Check15_SlippageExceeded() public {
        _setExecMandate(false, 7);
        MandateVault.Action memory a = _swapAction(100e6, 0.061875e18 - 1);

        vm.prank(executor);
        vm.expectRevert(MandateVault.SlippageExceeded.selector);
        vault.execute(a);
    }

    function test_Execute_Check15_AtSlippageBoundaryPasses() public {
        _setExecMandate(false, 7);
        MandateVault.Action memory a = _swapAction(100e6, 0.061875e18);

        vm.prank(executor);
        assertEq(vault.execute(a), 100e8);
    }

    // Order proofs: two violations at once, the earlier check's error must win.

    function test_Execute_Order01_NotExecutorBeforePaused() public {
        vm.prank(owner);
        vault.pause();
        MandateVault.Action memory a = _baseAction();

        vm.prank(alice);
        vm.expectRevert(MandateVault.NotExecutor.selector);
        vault.execute(a);
    }

    function test_Execute_Order02_PausedBeforeMandateInactive() public {
        vm.prank(owner);
        vault.pause();
        MandateVault.Action memory a = _baseAction();

        vm.prank(executor);
        vm.expectRevert(MandateVault.Paused.selector);
        vault.execute(a);
    }

    function test_Execute_Order03_StaleActionBeforeDeadlineExpired() public {
        _setExecMandate(false, 7);
        MandateVault.Action memory a = _baseAction();
        a.nonce = 1;
        a.deadline = uint64(block.timestamp - 1);

        vm.prank(executor);
        vm.expectRevert(MandateVault.StaleAction.selector);
        vault.execute(a);
    }

    function test_Execute_Order04_DeadlineBeforeMandateExpired() public {
        _setExecMandate(false, 7);
        MandateVault.Action memory a = _baseAction();
        vm.warp(block.timestamp + 2 days); // both the action deadline and the mandate have expired

        vm.prank(executor);
        vm.expectRevert(MandateVault.DeadlineExpired.selector);
        vault.execute(a);
    }

    function test_Execute_Order05_ZeroAmountBeforeActionNotAllowed() public {
        _setExecMandate(false, 3);
        MandateVault.Action memory a = _swapAction(0, 0);

        vm.prank(executor);
        vm.expectRevert(MandateVault.ZeroAmount.selector);
        vault.execute(a);
    }

    function test_Execute_Order06_ActionNotAllowedBeforeTarget() public {
        _setExecMandate(false, 3);
        MandateVault.Action memory a = _swapAction(100e6, 0);
        a.target = alice;

        vm.prank(executor);
        vm.expectRevert(MandateVault.ActionNotAllowed.selector);
        vault.execute(a);
    }

    function test_Execute_Order07_TargetBeforeAssetLocked() public {
        _setExecMandate(false, 7);
        MandateVault.Action memory a = _baseAction();
        a.tokenIn = address(weth);
        a.target = alice;

        vm.prank(executor);
        vm.expectRevert(MandateVault.TargetNotAllowed.selector);
        vault.execute(a);
    }

    function test_Execute_Order07_SwapRoleBeforeAssetLocked() public {
        _setExecMandate(false, 7);
        MandateVault.Action memory a = _swapAction(0.1e18, 0);
        a.target = address(sim);
        a.tokenIn = address(weth); // locked, but the role error comes first
        a.tokenOut = address(usdc);
        a.quotedPriceUsd8 = 1600e8;

        vm.prank(executor);
        vm.expectRevert(MandateVault.TargetNotAllowed.selector);
        vault.execute(a);
    }

    function test_Execute_Order08_StalePriceBeforeDeviation() public {
        oracle.setPriceAt(address(weth), 1600e8, block.timestamp - 601);
        _setExecMandate(false, 7);
        MandateVault.Action memory a = _baseAction();
        a.quotedPriceUsd8 = 1;

        vm.prank(executor);
        vm.expectRevert(MandateVault.StalePrice.selector);
        vault.execute(a);
    }

    function test_Execute_Order09_DeviationBeforePerActionCap() public {
        oracle.setPrice(address(usdc), 1.1e8);
        _setExecMandate(false, 7, 1, 1);
        MandateVault.Action memory a = _baseAction();

        vm.prank(executor);
        vm.expectRevert(MandateVault.PriceDeviation.selector);
        vault.execute(a);
    }

    function test_Execute_Order10_PerActionCapBeforeBudget() public {
        _setExecMandate(false, 7, 10e8, 10e8);
        MandateVault.Action memory a = _baseAction();

        vm.prank(executor);
        vm.expectRevert(MandateVault.PerActionCapExceeded.selector);
        vault.execute(a);
    }

    function test_Execute_Order11_BudgetBeforeSlippage() public {
        uint64 id = _setExecMandate(false, 7, 1_000e8, 100e8);
        vault.setSpent(id, 100e8);
        MandateVault.Action memory a = _swapAction(100e6, 0);

        vm.prank(executor);
        vm.expectRevert(MandateVault.BudgetExceeded.selector);
        vault.execute(a);
    }

    function test_Execute_Order12_MandateInactiveBeforeStaleAction() public {
        MandateVault.Action memory a = _baseAction();
        a.mandateId = 99; // also violates #4; no active mandate means #3 must win

        vm.prank(executor);
        vm.expectRevert(MandateVault.MandateInactive.selector);
        vault.execute(a);
    }

    function test_Execute_Order13_MandateExpiredBeforeZeroAmount() public {
        _setMandateFull(false, 7, 260e8, 260e8, uint64(block.timestamp - 2 days), uint64(block.timestamp - 1 days));
        MandateVault.Action memory a = _baseAction();
        a.amount = 0; // also violates #7; the expired mandate (#6) must win

        vm.prank(executor);
        vm.expectRevert(MandateVault.MandateExpired.selector);
        vault.execute(a);
    }

    function test_Execute_Order14_AssetLockedBeforeStalePrice() public {
        oracle.setPriceAt(address(weth), 1600e8, block.timestamp - 601);
        _setExecMandate(false, 7);
        MandateVault.Action memory a = _baseAction();
        a.tokenIn = address(weth); // locked, and its price is stale
        a.amount = 0.01e18;
        a.quotedPriceUsd8 = 1600e8;

        vm.prank(executor);
        vm.expectRevert(MandateVault.AssetLocked.selector);
        vault.execute(a);
    }

    // ---------------------------------------------------------------------
    // A-04.4a: effects (nonce, spend, exact approvals, target calls, event)
    // ---------------------------------------------------------------------

    function test_Effects_NonceSpendEventAndApproval() public {
        _setExecMandate(false, 7);
        MandateVault.Action memory a = _baseAction();

        vm.expectEmit(false, false, false, true, address(vault));
        emit MandateVault.ActionExecuted(1, 0, 0, address(sim), address(usdc), 100e6, 100e8, 100e8);

        vm.prank(executor);
        assertEq(vault.execute(a), 100e8);

        assertEq(vault.actionNonce(), 1);
        assertEq(uint256(vault.spentUsd(1)), 100e8);
        assertEq(usdc.allowance(address(vault), address(sim)), 0);
    }

    function test_Effects_ApprovalReset_Supply() public {
        _setExecMandate(false, 7);
        MandateVault.Action memory a = _baseAction();
        a.actionType = MandateVault.ActionType.SUPPLY_COLLATERAL;
        a.tokenIn = address(weth);
        a.amount = 0.01e18;
        a.quotedPriceUsd8 = 1600e8;

        vm.prank(executor);
        assertEq(vault.execute(a), 16e8);

        assertEq(weth.allowance(address(vault), address(sim)), 0);
        assertEq(uint256(vault.spentUsd(1)), 16e8);
    }

    function test_Effects_ApprovalReset_Swap() public {
        _setExecMandate(false, 7);
        MandateVault.Action memory a = _swapAction(100e6, 0.061875e18);

        vm.prank(executor);
        assertEq(vault.execute(a), 100e8);

        assertEq(usdc.allowance(address(vault), address(swap)), 0);
        assertEq(uint256(vault.spentUsd(1)), 100e8);
    }

    function test_Effects_BorrowNoApproval() public {
        _setExecMandate(true, 7);
        _supplyVaultCollateral(1e18);
        MandateVault.Action memory a = _baseAction();
        a.actionType = MandateVault.ActionType.BORROW;
        a.amount = 1e6;

        // BORROW never approves the debt token; #16 rejects the HF decrease.
        vm.prank(executor);
        vm.expectRevert(MandateVault.PostConditionFailed.selector);
        vault.execute(a);

        assertEq(usdc.allowance(address(vault), address(sim)), 0);
        assertEq(vault.actionNonce(), 0);
        assertEq(uint256(vault.spentUsd(1)), 0);
    }

    function test_Effects_FailedSwapRollsBackNonceAndSpend() public {
        _setExecMandate(false, 7);
        swap.setBroken(true);
        MandateVault.Action memory a = _swapAction(100e6, 0.061875e18);

        vm.prank(executor);
        vm.expectRevert(MockSwap.SwapBroken.selector);
        vault.execute(a);

        assertEq(vault.actionNonce(), 0);
        assertEq(uint256(vault.spentUsd(1)), 0);
        assertEq(usdc.allowance(address(vault), address(swap)), 0);
    }

    function test_Effects_PoolPausedRollsBackNonceAndSpend() public {
        _setExecMandate(false, 7);
        sim.setPoolPaused(0, true);
        MandateVault.Action memory a = _baseAction();
        a.actionType = MandateVault.ActionType.SUPPLY_COLLATERAL;
        a.tokenIn = address(weth);
        a.amount = 0.01e18;
        a.quotedPriceUsd8 = 1600e8;

        vm.prank(executor);
        vm.expectRevert(abi.encodeWithSelector(LendingSim.PoolPaused.selector, 0));
        vault.execute(a);

        assertEq(vault.actionNonce(), 0);
        assertEq(uint256(vault.spentUsd(1)), 0);
        assertEq(weth.allowance(address(vault), address(sim)), 0);
    }

    function test_Effects_CumulativeBudget() public {
        _setExecMandate(false, 7, 2_000e8, 5_000e8);
        weth.mint(address(vault), 3e18);

        for (uint256 i; i < 3; ++i) {
            MandateVault.Action memory a = _baseAction();
            a.actionType = MandateVault.ActionType.SUPPLY_COLLATERAL;
            a.tokenIn = address(weth);
            a.amount = 1e18;
            a.quotedPriceUsd8 = 1600e8;

            vm.prank(executor);
            assertEq(vault.execute(a), 1600e8);
            assertEq(uint256(vault.spentUsd(1)), (i + 1) * 1600e8);
        }

        assertEq(vault.actionNonce(), 3);

        MandateVault.Action memory a = _baseAction();
        a.actionType = MandateVault.ActionType.SUPPLY_COLLATERAL;
        a.tokenIn = address(weth);
        a.amount = 1e18;
        a.quotedPriceUsd8 = 1600e8;

        vm.prank(executor);
        vm.expectRevert(MandateVault.BudgetExceeded.selector);
        vault.execute(a);
        assertEq(vault.actionNonce(), 3);
    }

    function test_Effects_Decimals_100mUSDC_And_0_05mWETH() public {
        oracle.setPrice(address(weth), 2000e8);
        _setExecMandate(false, 7, 260e8, 260e8);

        MandateVault.Action memory a = _swapAction(100e6, 0.0495e18);
        vm.prank(executor);
        assertEq(vault.execute(a), 100e8);

        a = _baseAction();
        a.actionType = MandateVault.ActionType.SUPPLY_COLLATERAL;
        a.tokenIn = address(weth);
        a.amount = 0.05e18;
        a.quotedPriceUsd8 = 2000e8;

        vm.prank(executor);
        assertEq(vault.execute(a), 100e8);

        assertEq(uint256(vault.spentUsd(1)), 200e8);
    }

    function test_Effects_RoundsUpValue() public {
        _setExecMandate(false, 7);
        MandateVault.Action memory a = _baseAction();
        a.actionType = MandateVault.ActionType.SUPPLY_COLLATERAL;
        a.tokenIn = address(weth);
        a.amount = 1; // 1 wei * 1600e8 / 1e18 = 0.00000016 usd8 -> 1
        a.quotedPriceUsd8 = 1600e8;

        vm.prank(executor);
        assertEq(vault.execute(a), 1);
        assertEq(uint256(vault.spentUsd(1)), 1);
    }

    function test_Effects_SwapAtLendingSimRollsBack() public {
        _setExecMandate(false, 7);
        MandateVault.Action memory a = _swapAction(100e6, 0.061875e18);
        a.target = address(sim);

        vm.prank(executor);
        vm.expectRevert();
        vault.execute(a);

        assertEq(vault.actionNonce(), 0);
        assertEq(uint256(vault.spentUsd(1)), 0);
        assertEq(usdc.allowance(address(vault), address(sim)), 0);
    }

    function test_Effects_ExactApproval_GreedyTargetCannotPullMore() public {
        GreedySwap greedy = new GreedySwap();
        _setMandateForTarget(address(greedy));
        MandateVault.Action memory a = _swapAction(100e6, 0.061875e18);
        a.target = address(greedy);

        vm.prank(executor);
        vm.expectRevert();
        vault.execute(a);

        assertEq(vault.actionNonce(), 0);
        assertEq(uint256(vault.spentUsd(1)), 0);
        assertEq(usdc.allowance(address(vault), address(greedy)), 0);
    }

    function test_Effects_ReentrancyReverts() public {
        ReentrantExecutor reentrant = new ReentrantExecutor();
        vm.prank(owner);
        vault.setExecutor(address(reentrant));
        _setMandateForTarget(address(reentrant));

        MandateVault.Action memory outer = _swapAction(100e6, 0.061875e18);
        outer.target = address(reentrant);
        MandateVault.Action memory inner = outer;

        vm.expectRevert(ReentrancyGuard.ReentrancyGuardReentrantCall.selector);
        reentrant.run(vault, outer, inner);

        assertEq(vault.actionNonce(), 0);
        assertEq(uint256(vault.spentUsd(1)), 0);
        assertEq(usdc.allowance(address(vault), address(reentrant)), 0);
    }

    // ---------------------------------------------------------------------
    // A-04.4b: liquid reserve view and post-condition #16
    // ---------------------------------------------------------------------

    function test_LiquidReserveUsd8_ReadsReserveAtOraclePrice() public {
        assertEq(vault.liquidReserveUsd8(), 1000e8);
        oracle.setPrice(address(usdc), 1.1e8);
        assertEq(vault.liquidReserveUsd8(), 1100e8);
    }

    function test_Execute_Check16_ReserveBelowMinimum() public {
        _setMandateReserve(950e8);
        MandateVault.Action memory a = _swapAction(100e6, 0.061875e18);
        uint256 vaultUsdcBefore = usdc.balanceOf(address(vault));

        vm.prank(executor);
        vm.expectRevert(MandateVault.PostConditionFailed.selector);
        vault.execute(a);

        assertEq(usdc.balanceOf(address(vault)), vaultUsdcBefore);
        assertEq(vault.actionNonce(), 0);
        assertEq(uint256(vault.spentUsd(1)), 0);
        assertEq(usdc.allowance(address(vault), address(swap)), 0);
    }

    function test_Execute_Check16_ReserveAtBoundaryPasses() public {
        _setMandateReserve(900e8);
        MandateVault.Action memory a = _swapAction(100e6, 0.061875e18);

        vm.prank(executor);
        assertEq(vault.execute(a), 100e8);

        assertEq(vault.liquidReserveUsd8(), 900e8);
        assertEq(vault.actionNonce(), 1);
        assertEq(uint256(vault.spentUsd(1)), 100e8);
    }

    function test_Execute_Check16_HfDecreases() public {
        _setExecMandate(true, 7);
        _supplyVaultCollateral(1e18);
        (uint256 collateralBefore, uint256 debtBefore) = sim.positionOf(0, address(vault));

        MandateVault.Action memory a = _baseAction();
        a.actionType = MandateVault.ActionType.BORROW;
        a.amount = 1e6;

        vm.prank(executor);
        vm.expectRevert(MandateVault.PostConditionFailed.selector);
        vault.execute(a);

        (uint256 collateralAfter, uint256 debtAfter) = sim.positionOf(0, address(vault));
        assertEq(collateralAfter, collateralBefore);
        assertEq(debtAfter, debtBefore);
        assertEq(vault.actionNonce(), 0);
        assertEq(uint256(vault.spentUsd(1)), 0);
    }

    function test_Execute_Check16_HfImprovesPasses() public {
        _setExecMandate(true, 7);
        _supplyVaultCollateral(1e18);
        vm.prank(address(vault));
        sim.borrow(0, 100e6);
        uint256 hfBefore = sim.healthFactor(0, address(vault));

        MandateVault.Action memory a = _baseAction(); // REPAY 100 mUSDC

        vm.prank(executor);
        assertEq(vault.execute(a), 100e8);

        assertGt(sim.healthFactor(0, address(vault)), hfBefore);
    }

    function _supplyVaultCollateral(uint256 amount) private {
        vm.prank(address(vault));
        weth.approve(address(sim), amount);
        vm.prank(address(vault));
        sim.supply(0, amount);
    }

    function _setMandateForTarget(address target) private returns (uint64 id) {
        id = vault.nextMandateId();
        address[] memory targets = new address[](1);
        targets[0] = target;
        address[] memory locked = new address[](1);
        locked[0] = address(weth);

        MandateVault.Mandate memory m = MandateVault.Mandate({
            id: id,
            validFrom: uint64(block.timestamp),
            validUntil: uint64(block.timestamp + 1 days),
            maxTotalSpendUsd: 260e8,
            maxPerActionUsd: 260e8,
            minLiquidReserveUsd: 0,
            maxSlippageBps: 100,
            maxPriceAgeSec: 600,
            maxPriceDeviationBps: 300,
            allowedActions: 7,
            allowBorrow: false,
            allowedTargets: targets,
            lockedTokens: locked
        });
        vm.prank(owner);
        vault.setMandate(m);
    }

    function _setMandateReserve(uint256 minReserveUsd) private returns (uint64 id) {
        id = vault.nextMandateId();
        address[] memory targets = new address[](2);
        targets[0] = address(sim);
        targets[1] = address(swap);
        address[] memory locked = new address[](1);
        locked[0] = address(weth);

        MandateVault.Mandate memory m = MandateVault.Mandate({
            id: id,
            validFrom: uint64(block.timestamp),
            validUntil: uint64(block.timestamp + 1 days),
            maxTotalSpendUsd: 260e8,
            maxPerActionUsd: 260e8,
            minLiquidReserveUsd: uint128(minReserveUsd),
            maxSlippageBps: 100,
            maxPriceAgeSec: 600,
            maxPriceDeviationBps: 300,
            allowedActions: 7,
            allowBorrow: false,
            allowedTargets: targets,
            lockedTokens: locked
        });
        vm.prank(owner);
        vault.setMandate(m);
    }

    function _setExecMandate(bool allowBorrow, uint8 allowedActions) private returns (uint64) {
        return _setExecMandate(allowBorrow, allowedActions, 260e8, 260e8);
    }

    function _setExecMandate(bool allowBorrow, uint8 allowedActions, uint256 maxPerActionUsd, uint256 maxTotalSpendUsd)
        private
        returns (uint64)
    {
        return _setMandateFull(
            allowBorrow,
            allowedActions,
            maxPerActionUsd,
            maxTotalSpendUsd,
            uint64(block.timestamp),
            uint64(block.timestamp + 1 days)
        );
    }

    function _setMandateFull(
        bool allowBorrow,
        uint8 allowedActions,
        uint256 maxPerActionUsd,
        uint256 maxTotalSpendUsd,
        uint64 validFrom,
        uint64 validUntil
    ) private returns (uint64 id) {
        id = vault.nextMandateId();
        address[] memory targets = new address[](2);
        targets[0] = address(sim);
        targets[1] = address(swap);
        address[] memory locked = new address[](1);
        locked[0] = address(weth);

        MandateVault.Mandate memory m = MandateVault.Mandate({
            id: id,
            validFrom: validFrom,
            validUntil: validUntil,
            maxTotalSpendUsd: uint128(maxTotalSpendUsd),
            maxPerActionUsd: uint128(maxPerActionUsd),
            minLiquidReserveUsd: 100e8,
            maxSlippageBps: 100,
            maxPriceAgeSec: 600,
            maxPriceDeviationBps: 300,
            allowedActions: allowedActions,
            allowBorrow: allowBorrow,
            allowedTargets: targets,
            lockedTokens: locked
        });
        vm.prank(owner);
        vault.setMandate(m);
    }

    function _baseAction() private view returns (MandateVault.Action memory a) {
        a = MandateVault.Action({
            mandateId: vault.activeMandateId(),
            nonce: vault.actionNonce(),
            actionType: MandateVault.ActionType.REPAY,
            target: address(sim),
            poolId: 0,
            tokenIn: address(usdc),
            tokenOut: address(0),
            amount: 100e6,
            minAmountOut: 0,
            quotedPriceUsd8: 1e8,
            deadline: uint64(block.timestamp + 1 hours)
        });
    }

    function _swapAction(uint256 amount, uint256 minAmountOut) private view returns (MandateVault.Action memory a) {
        a = _baseAction();
        a.actionType = MandateVault.ActionType.SWAP;
        a.target = address(swap);
        a.tokenIn = address(usdc);
        a.tokenOut = address(weth);
        a.amount = amount;
        a.minAmountOut = minAmountOut;
    }

    function _viemMandate(bool nonEmpty) private pure returns (MandateVault.Mandate memory m) {
        address[] memory targets = new address[](nonEmpty ? 1 : 0);
        address[] memory locked = new address[](nonEmpty ? 1 : 0);
        if (nonEmpty) {
            targets[0] = 0x1111111111111111111111111111111111111111;
            locked[0] = 0x2222222222222222222222222222222222222222;
        }

        m = MandateVault.Mandate({
            id: 1,
            validFrom: 1_700_000_000,
            validUntil: 1_700_086_400,
            maxTotalSpendUsd: 26_000_000_000,
            maxPerActionUsd: 26_000_000_000,
            minLiquidReserveUsd: 10_000_000_000,
            maxSlippageBps: 100,
            maxPriceAgeSec: 600,
            maxPriceDeviationBps: 300,
            allowedActions: 3,
            allowBorrow: false,
            allowedTargets: targets,
            lockedTokens: locked
        });
    }

    function _mandate(uint64 id) private view returns (MandateVault.Mandate memory m) {
        address[] memory targets = new address[](1);
        targets[0] = address(0x1234);
        address[] memory locked = new address[](1);
        locked[0] = address(0xBEEF);

        m = MandateVault.Mandate({
            id: id,
            validFrom: uint64(block.timestamp),
            validUntil: uint64(block.timestamp + 1 days),
            maxTotalSpendUsd: 260e8,
            maxPerActionUsd: 260e8,
            minLiquidReserveUsd: 100e8,
            maxSlippageBps: 100,
            maxPriceAgeSec: 600,
            maxPriceDeviationBps: 300,
            allowedActions: 3,
            allowBorrow: false,
            allowedTargets: targets,
            lockedTokens: locked
        });
    }

    function _sign(uint256 pk, MandateVault.Mandate memory m, uint256 deadline) private view returns (bytes memory) {
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(pk, _digest(m, deadline));
        return abi.encodePacked(r, s, v);
    }

    function _digest(MandateVault.Mandate memory m, uint256 deadline) private view returns (bytes32) {
        bytes32 domainSeparator = keccak256(
            abi.encode(
                keccak256("EIP712Domain(string name,string version,uint256 chainId,address verifyingContract)"),
                keccak256("MarginPilotVault"),
                keccak256("1"),
                block.chainid,
                address(vault)
            )
        );
        bytes32 structHash = keccak256(abi.encode(SET_MANDATE_TYPEHASH, _mandateStructHash(m), deadline));
        return keccak256(abi.encodePacked("\x19\x01", domainSeparator, structHash));
    }

    function _mandateStructHash(MandateVault.Mandate memory m) private pure returns (bytes32) {
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

    function _hashAddressArray(address[] memory arr) private pure returns (bytes32) {
        bytes32[] memory words = new bytes32[](arr.length);
        for (uint256 i; i < arr.length; ++i) {
            words[i] = bytes32(uint256(uint160(arr[i])));
        }
        return keccak256(abi.encodePacked(words));
    }

    // ---------------------------------------------------------------------
    // A-05 adversarial T-ID tests (Foundry layer)
    // ---------------------------------------------------------------------

    function test_T01_SwapLockedTokenRevertsAssetLocked() public {
        _setExecMandate(false, 15);
        MandateVault.Action memory a = _swapAction(0.01e18, 0);
        a.tokenIn = address(weth);
        a.tokenOut = address(usdc);
        a.quotedPriceUsd8 = 1600e8;

        vm.prank(executor);
        vm.expectRevert(MandateVault.AssetLocked.selector);
        vault.execute(a);
    }

    function test_T01_SwapNotAllowedRevertsActionNotAllowed() public {
        _setExecMandate(false, 3);
        MandateVault.Action memory a = _swapAction(100e6, 0);

        vm.prank(executor);
        vm.expectRevert(MandateVault.ActionNotAllowed.selector);
        vault.execute(a);
    }

    function test_T02_BudgetReplanRevertsAndSpentUnchanged() public {
        uint64 id = _setExecMandate(false, 7, 260e8, 260e8);
        vault.setSpent(id, 150e8);
        MandateVault.Action memory a = _baseAction();
        a.amount = 150e6 + 1;

        vm.prank(executor);
        vm.expectRevert(MandateVault.BudgetExceeded.selector);
        vault.execute(a);
        assertEq(uint256(vault.spentUsd(id)), 150e8);
        assertEq(vault.actionNonce(), 0);
    }

    function test_T03_BorrowForbidden() public {
        _setExecMandate(false, 7);
        MandateVault.Action memory a = _baseAction();
        a.actionType = MandateVault.ActionType.BORROW;
        a.amount = 1e6;

        vm.prank(executor);
        vm.expectRevert(MandateVault.BorrowForbidden.selector);
        vault.execute(a);
    }

    function test_T04_TargetNotAllowed() public {
        _setExecMandate(false, 7);
        MandateVault.Action memory a = _baseAction();
        a.target = address(swap);

        vm.prank(executor);
        vm.expectRevert(MandateVault.TargetNotAllowed.selector);
        vault.execute(a);
    }
}
