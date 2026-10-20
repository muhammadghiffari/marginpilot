# A-04 PR #1 — review reply from Dev B (2026-10-20, 18:10 WIB)

Reviewed branch: `origin/a/A-04-vault` @ `fef6fb1` (PR #1: `e1f90f3` execute effects, `dec5aae`
post-conditions, `57407fe` execute-order proofs). Mirror side: `feat/dev-b-foundations`.

## 1. `scripts/verify-all.sh` on the PR branch (my machine)

Worktree: `/home/catalna/marginpilot/.worktrees/a04-pr1` (detached at `fef6fb1`), WSL ext4.

```
check-secrets: clean
contracts: Ran 4 test suites: 120 tests passed, 0 failed, 0 skipped
packages/core: 83 tests passed   apps/agent: 36   apps/web: 5   eval: 6
VERIFY-ALL: GREEN
```

**GREEN on my machine, including all 120 forge tests.** I did **not** need a longer timeout: the
core workspace finishes in ~1.5 s here. I still raised the shared timeout as you asked, in the file
I own: `vitest.config.ts` now sets `testTimeout: 30_000` (the default 5 s is what bites on
`/mnt/c`). It applies to every workspace, so a slow Windows checkout no longer fails a test that
merely needs time.

Note for A-07: the worktree needed `forge install` (forge-std + OpenZeppelin) before the contract
suite could build. `contracts/lib/` is not committed, so a fresh clone must run it once.

## 2. Target roles — mirror updated, one contract gap left

Your ask: `PolicyContext` needs `lendingSim` and `swapTarget` so `checkAction` can return
`TargetNotAllowed` for a lending action at the swap address **and vice versa**. Done in
`packages/core/src/policy.ts` (commit on `feat/dev-b-foundations`, 5 new core tests):

- `PolicyContext` gains `reserveToken: Address`, `lendingSim: Address`, `swapTarget?: Address`.
- A lending action (`REPAY`/`SUPPLY_COLLATERAL`/`BORROW`) whose target is not `lendingSim` →
  `TargetNotAllowed`.
- A `SWAP` whose target is not `swapTarget` → `TargetNotAllowed`; if no swap target is configured,
  every `SWAP` is rejected.
- `MockChainPort` passes the same three fields, so the mock and the mirror agree (new test:
  `rejects a wrong-role target before any state change`).

**Ordering follows your contract, not a new order of my own:**

| Input | Vault (PR #1) | Mirror (now) |
|---|---|---|
| Lending action at a non-`LendingSim` target | `TargetNotAllowed` (raised inside the #11 pool-token read) | `TargetNotAllowed` — placed after #10, before the freshness loop → identical error precedence |
| SWAP at a non-swap target | **no role probe**; the vault-built target call reverts untyped (D-029 → `Unknown`) | `TargetNotAllowed` |

So the first row is exact parity today; the second row is **stricter in the mirror than on chain**
(name only: the chain still refuses the action, atomically, but with no named error). Two ways to
close it, your call:

- **Option A — probe the interface (no new contract surface).** A SWAP target that exposes
  `LendingSim.pools(uint8)` is a lending sim and must be rejected:

  ```solidity
  bool targetIsLendingSim;
  try LendingSim(a.target).pools(a.poolId) returns (address, address, uint32, uint32, uint32, bool) {
      targetIsLendingSim = true;
  } catch {}
  if (targetIsLendingSim) revert TargetNotAllowed();
  ```

  Careful: do **not** write `revert TargetNotAllowed();` inside the `try` body — Solidity catches
  that revert with the same `catch`, and the swap would go through. Use the flag, as above.
- **Option B — give `MockSwap` a read-only probe** (e.g. `feeBps() view returns (uint32)`) and
  require a SWAP target to answer it; failure → `TargetNotAllowed`.

Tell me which option you take and where you put the check (I mirrored it after #15, where the chain
currently fails at the target call). If you prefer the probe directly after #9, I will move the
mirror check up by one position — it is a one-line change plus one test.

While mirroring, I also fixed a stale fixture: the old "#15 slippage" test built a `SWAP` whose
target was the **lending** address, which was never a legal swap. It now targets the swap target.

## 3. Proposal D-029 (reserve token in the check #11 price set) — answer: **no SCENARIOS outcome changes**

Checked every scenario in `docs/spec/SCENARIOS.md`:

| Scenario | Oracle perturbation | Before | After the proposal | Changed? |
|---|---|---|---|---|
| S1 happy rescue | price shock, all fresh | 2 repays | 2 repays | no |
| S2 scarce budget | none | `COMPLETED_PARTIAL` | same | no |
| S3 price moves mid-plan | mWETH −5 %, fresh timestamps | replan with remaining budget | same (check #12 stays `tokenIn`-only) | no |
| S4 mid-plan tx failure | none | simulate fails, 0 spend | same | no |
| **S5 stale oracle** | `setPriceAt(mWETH, p, now-1h)` | `StalePrice`, 0 txs, halt | `StalePrice`, 0 txs, halt | **no** |
| S6/S7/S8/S9 | none | unchanged | unchanged | no |

S5 is the only scenario that touches oracle timestamps, and it stales **mWETH** (pool 0's
collateral). The price set only *grows* with the reserve token, and mUSDC is fresh in the base
fixture, so the same `StalePrice` fires with the same assertions (`0 txs executed on stale data`,
halt reason recorded). **No scenario text needs rewriting.**

What the proposal does change, and it is the point of it:

- A stale or missing **reserve** price now blocks *every* action, including a `SWAP` whose tokens
  are otherwise fresh. That is required for check #16 to be meaningful: `liquidReserveUsd8()` values
  the reserve with the reserve price, so a stale reserve price would otherwise value the floor
  with a stale number.
- Cost: one extra oracle read per action.

Two implementation notes for `CONTRACTS.md` and the vault:

1. **Missing vs stale price.** The mirror maps a *missing* price to `StalePrice`; the vault calls
   `oracle.getPrice(token)`, and `MockOracle` reverts `UnknownToken` for an unknown token — that
   error is not in `ErrorName`, so D-029 maps it to `Unknown`. This gap already exists for `tokenIn`
   and the pool tokens; the reserve token makes it reachable in every action. If you want the named
   error, wrap the #11 read in `try/catch` and map a failed `getPrice` to `StalePrice`.
2. **Spec wording** (I did not edit `CONTRACTS.md` — you are editing it; this is the text to use):

   > #11 (StalePrice) covers the action's **price set**: `tokenIn`, plus `tokenOut` for SWAP, plus
   > the pool's collateral and debt tokens for lending actions, plus the vault's **reserve token for
   > every action** (check #16 values the liquid reserve with the reserve price). Check #12
   > (PriceDeviation) stays `tokenIn` only.

The TypeScript mirror already implements both changes (D-030, D-031 in `docs/DECISIONS.md`):
88 core tests green, `verify-all` GREEN.

## 4. One requirement for A-07 (`eval/fixtures/base.json`)

With the reserve token in every price set, the base fixture must carry a **fresh timestamp for
every price**, including mUSDC, or every action fails closed with `StalePrice` in the mirror.
Please include, per price, the same fields the API returns: `token`, `priceUsd8`, `updatedAt`
(microseconds or seconds — pick one and say which in the fixture README), plus the vault's
`blockTimestamp` and the reserve token address. The mirror and the vault must agree on the unit
before the anvil runner (A-09) starts.

## 5. Status of my side

- `feat/dev-b-foundations` carries the mirror update, 5 new core tests (88 total) and this reply.
- `docs/spec/INTERFACES.md` §5 documents the new `PolicyContext` fields and both rules;
  `docs/DECISIONS.md` has D-030 and D-031 (D-023's price-set part is marked superseded).
- Still blocked on you: A-07 artifacts (`Deploy.s.sol`, `scripts/deploy.sh`,
  `deployments/<chainId>.json`, `packages/core/src/abi/`, `eval/fixtures/base.json`) and the A-09
  anvil runner. B-08 (`ViemChainPort`) starts as soon as they exist, and the differential test
  (B-15) is what will prove the two sides agree.
