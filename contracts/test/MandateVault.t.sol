// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {Test} from "forge-std/Test.sol";
import {MockERC20} from "../src/MockERC20.sol";
import {MockOracle} from "../src/MockOracle.sol";
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

/// @notice A-04 tests: auth, pause, owner withdrawal, then owner-signed mandates.
contract MandateVaultTest is Test {
    MockERC20 private usdc;
    MockOracle private oracle;
    MandateVault private vault;

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
}
