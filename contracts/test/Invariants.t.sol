// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {Test} from "forge-std/Test.sol";
import {MockERC20} from "../src/MockERC20.sol";
import {MockOracle} from "../src/MockOracle.sol";
import {LendingSim} from "../src/LendingSim.sol";
import {MandateVault} from "../src/MandateVault.sol";

/// @dev A-06 state-transition handler. Only the executor path is fuzzed; failures are
/// expected once limits are reached and are swallowed so the invariant run continues.
contract VaultInvariantHandler is Test {
    MandateVault public immutable vault;
    address private immutable sim;
    address private immutable usdc;
    address private immutable executor = address(0xE1EC);

    uint256 public ghostLastSpentUsd;
    uint256 public ghostLastNonce;

    constructor() {
        MockERC20 usdcToken = new MockERC20("Mock USD Coin", "mUSDC", 6);
        MockERC20 weth = new MockERC20("Mock Wrapped Ether", "mWETH", 18);
        MockOracle oracle = new MockOracle();
        LendingSim lending = new LendingSim(address(oracle));
        lending.setPool(0, address(weth), address(usdcToken), 8250, 500, 5000);
        oracle.setPrice(address(usdcToken), 1e8);
        oracle.setPrice(address(weth), 1600e8);

        vault = new MandateVault(address(this), executor, address(oracle), address(usdcToken));
        usdcToken.mint(address(vault), 1_000e6);
        weth.mint(address(vault), 1e18);
        sim = address(lending);
        usdc = address(usdcToken);

        address[] memory targets = new address[](1);
        targets[0] = sim;
        address[] memory locked = new address[](1);
        locked[0] = address(weth);
        vault.setMandate(
            MandateVault.Mandate({
                id: 1,
                validFrom: uint64(block.timestamp),
                validUntil: uint64(block.timestamp + 1 days),
                maxTotalSpendUsd: 260e8,
                maxPerActionUsd: 50e8,
                minLiquidReserveUsd: 100e8,
                maxSlippageBps: 100,
                maxPriceAgeSec: 600,
                maxPriceDeviationBps: 300,
                allowedActions: 3,
                allowBorrow: false,
                allowedTargets: targets,
                lockedTokens: locked
            })
        );
    }

    function executeRepay(uint96 rawAmount) external {
        uint256 amount = bound(uint256(rawAmount), 1, 10e6);
        MandateVault.Action memory a = MandateVault.Action({
            mandateId: vault.activeMandateId(),
            nonce: vault.actionNonce(),
            actionType: MandateVault.ActionType.REPAY,
            target: sim,
            poolId: 0,
            tokenIn: usdc,
            tokenOut: address(0),
            amount: amount,
            minAmountOut: 0,
            quotedPriceUsd8: 1e8,
            deadline: uint64(block.timestamp + 1 hours)
        });

        vm.prank(executor);
        try vault.execute(a) {} catch {}

        uint256 spent = uint256(vault.spentUsd(1));
        uint256 nonce = vault.actionNonce();
        require(spent >= ghostLastSpentUsd, "spentUsd decreased");
        require(nonce >= ghostLastNonce, "actionNonce decreased");
        ghostLastSpentUsd = spent;
        ghostLastNonce = nonce;
    }
}

/// @notice A-06 invariants: cumulative spend, spend monotonicity and nonce monotonicity.
contract VaultInvariantsTest is Test {
    VaultInvariantHandler private handler;

    function setUp() public {
        vm.warp(1_700_000_000);
        handler = new VaultInvariantHandler();
        targetContract(address(handler));
    }

    function invariant_SpentAtOrBelowMandateCap() public view {
        MandateVault vault = handler.vault();
        assertLe(uint256(vault.spentUsd(1)), uint256(vault.mandate().maxTotalSpendUsd));
    }

    function invariant_SpentMonotonic() public view {
        assertGe(uint256(handler.vault().spentUsd(1)), handler.ghostLastSpentUsd());
    }

    function invariant_NonceMonotonic() public view {
        assertGe(handler.vault().actionNonce(), handler.ghostLastNonce());
    }
}
