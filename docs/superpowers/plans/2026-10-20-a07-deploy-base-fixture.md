# A-07 Deploy + Base Fixture Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** One local-anvil command deploys the full simulator + vault, seeds the SCENARIOS base state, and emits the deployment record, base fixture and ABIs that unblock B-08/B-12.

**Architecture:** A Foundry script deploys and seeds; a thin bash wrapper runs it against anvil, patches the deployment metadata, and exports ABIs. The fixture is generated from the same constants the script seeds with, so the two cannot drift.

**Tech Stack:** Solidity 0.8.24, Foundry (`forge script`, `cast`), bash + `jq`, anvil 31337.

**Spec:** `docs/spec/CONTRACTS.md` §2.3/§3, `docs/spec/INTERFACES.md` §9, `docs/spec/SCENARIOS.md` base state, `tasks/DEV-A.md` A-07.

## Global Constraints

- Base state: mUSDC 1.00, mWETH 2,000, mWSTETH 2,300; pool 0 = 1.0 mWETH / 1,400 mUSDC; pool 1 = 2.0 mWSTETH / 2,800 mUSDC; reserve 400 mUSDC; locked 0.5 mWETH; shock = mWETH 1,600 / mWSTETH 1,840.
- Timestamps are **unix seconds**; every price gets a fresh `updatedAt` at deploy (including mUSDC), else D-031 makes every action `StalePrice`.
- No private key is read, printed or committed. Local deploy uses anvil's unlocked account 0; testnet requires an explicit `SENDER` (A-10, human present).
- The vault's #16 forbids borrowing, so demo positions are seeded through the simulator's admin-only deploy helper, never through `execute`.
- A failed simulation must revert before broadcast; never write a deployment record for a failed run.

## Review Focus

- Fresh chain + fresh timestamps: a fixture without per-price `updatedAt` makes the first action fail closed.
- Fixture/deployment drift: the fixture is generated from the seeded values, not typed separately.
- Seeded position vs vault custody: `seedPosition` writes the simulator's accounting only; the sim must hold the collateral tokens to pay liquidators.
- Non-anvil deploy: anvil's default executor must never be used off chain id 31337.
- ABI drift: ABIs are regenerated from the compiled contracts on every deploy.

---

### Task 1: Simulator deploy helper

**Files:**
- Modify: `contracts/src/LendingSim.sol`
- Test: `contracts/test/LendingSim.t.sol`
- Modify: `docs/spec/CONTRACTS.md` §2.3
- Modify: `docs/security/KNOWN-RISKS.md`

**Interfaces:**
- Produces: `seedPosition(uint8 poolId, address user, uint256 collateral, uint256 debt) external` — admin only, writes `_positions[poolId][user]`, no token transfers, validates the pool.

- [ ] **Step 1: Write the failing tests**

```solidity
function test_SeedPosition_AdminOnly() public {
    vm.prank(alice);
    vm.expectRevert(LendingSim.NotAdmin.selector);
    sim.seedPosition(0, bob, 1e18, 1_000e6);
}

function test_SeedPosition_WritesPosition() public {
    sim.seedPosition(0, bob, 2e18, 500e6);
    (uint256 collateral, uint256 debt) = sim.positionOf(0, bob);
    assertEq(collateral, 2e18);
    assertEq(debt, 500e6);
}

function test_SeedPosition_RejectsUnknownPool() public {
    vm.expectRevert(abi.encodeWithSelector(LendingSim.InvalidPool.selector, 2));
    sim.seedPosition(2, bob, 1e18, 1);
}
```

- [ ] **Step 2: Run them; expect failure (`seedPosition` not found).**
- [ ] **Step 3: Implement `seedPosition`; call `_pool(poolId)` first.**
- [ ] **Step 4: Run `forge test --match-test SeedPosition`; expect 3 passed.**
- [ ] **Step 5: Add the API line to CONTRACTS §2.3 and risk row R13 to KNOWN-RISKS.**
- [ ] **Step 6: Commit.**

### Task 2: `Deploy.s.sol`

**Files:**
- Create: `contracts/script/Deploy.s.sol`
- Modify: `contracts/foundry.toml` (add `fs_permissions` for `../eval/fixtures`)
- Modify: `.env.example` (add `EXECUTOR_ADDRESS`)
- Generated: `deployments/31337.json`, `eval/fixtures/base.json`

**Interfaces:**
- Consumes: `seedPosition`, all contract constructors, `MandateVault(owner, executor, oracle, mUSDC)`.
- Produces: `run()` writes the deployment record (INTERFACES §9) and the base fixture; both are keyed by `block.chainid`.

- [ ] **Step 1: Write the script.**

Constants: prices, positions, reserve, locked amount, shock prices, pool risk params. Deploy tokens/oracle/lending/swap/vault. Set pools, prices (`setPrice`, so `updatedAt = block.timestamp`), mint reserve/locked tokens to the vault, mint swap liquidity (10,000 mUSDC, 10 mWETH, 10 mWSTETH), mint sim collateral (1 mWETH, 2 mWSTETH) + 10,000 mUSDC, seed both positions.
Owner = `vm.envOr("OWNER_ADDRESS", msg.sender)`; executor = `vm.envOr("EXECUTOR_ADDRESS", address(0))`, defaulting to the anvil account-1 address **only** on chain id 31337, else revert.
Write `../deployments/<chainId>.json`: `chainId`, `deployedAt` = unix seconds (the wrapper converts to ISO-8601), `deployer`, `owner`, `executor`, `contracts`, `blocks.vault` = 0 (the wrapper patches it), `explorerBase` from `vm.envOr("EXPLORER_BASE_URL", "")`.
Write `../eval/fixtures/base.json`: `chainId`, `timestampUnit: "seconds"`, `blockTimestamp`, `contracts`, `reserve`, `lockedToken`, `prices` (symbol → `{token, priceUsd8, updatedAt}` as decimal strings), `positions` (`pool0`/`pool1` → `{collateral, debt}` decimal strings), `postShockPrices`, `defaultMandate` (SCENARIOS values, validity ±1 day around `block.timestamp`).
End with assertions: both positions match, vault mUSDC = 400e6, vault mWETH = 0.5e18, three prices set with `updatedAt == block.timestamp`.

- [ ] **Step 2: Compile (`forge build`).**
- [ ] **Step 3: Run against anvil via the Task 3 wrapper; expect exit 0 and both files.**
- [ ] **Step 4: Commit the script + generated local files.**

### Task 3: `scripts/deploy.sh`

**Files:**
- Create: `scripts/deploy.sh`
- Generated: `packages/core/src/abi/{MockERC20,MockOracle,LendingSim,MockSwap,MandateVault}.json`

**Interfaces:**
- Consumes: `deployments/<chainId>.json` (written by Task 2).
- Produces: a ready anvil state; ABIs for B-08; ISO-8601 `deployedAt`; `blocks.vault` from the broadcast artifact.

- [ ] **Step 1: Write the script.**
`set -eu`; read `RPC_URL` (default `http://127.0.0.1:8545`), `CHAIN_ID` (default 31337). Fail if `cast chain-id` does not match. Sender = `SENDER` or `cast rpc eth_accounts` account 0; only use `--unlocked` on 31337. Run `forge script script/Deploy.s.sol:Deploy --rpc-url "$RPC_URL" --sender "$SENDER" --unlocked --broadcast -vv`. Then:
- `deployedAt` = ISO-8601 from the unix value in the record.
- `blocks.vault` = `receipt.blockNumber` for `MandateVault` in `contracts/broadcast/Deploy.s.sol/<chainId>/run-latest.json`.
- Export ABIs with `forge inspect <Contract> abi --json`.
- Print the deployment path and the fixture path; never print a key.

- [ ] **Step 2: `bash -n scripts/deploy.sh`.**
- [ ] **Step 3: Run it on a fresh anvil; expect `deployment: deployments/31337.json`, 5 ABI files, and the vault address.**
- [ ] **Step 4: Verify with `cast call`: `positionOf(0,vault)`, `positionOf(1,vault)`, `liquidReserveUsd8()`, `getPrice(mUSDC)`.**
- [ ] **Step 5: Commit.**

### Task 4: Verification + STATUS

- [ ] Run `scripts/verify-all.sh` (must be GREEN; 125 Forge tests + new `seedPosition` tests).
- [ ] Run `scripts/check-secrets.sh` (clean).
- [ ] Update `STATUS.md`: A-07 done, ABI/fixture paths, 31337 deploy evidence, B-08/B-12 unblocked.
- [ ] Commit and push the A-07 branch; open the PR with commands and results.
