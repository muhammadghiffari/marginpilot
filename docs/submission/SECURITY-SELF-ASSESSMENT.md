# Security Self-Assessment — MarginPilot

Commit: `ee8c840` (code + evaluation docs; later commits may add documents only) · Run date: 2026-10-20 · Chain: **SIMULATED (`MockChainPort`)**; no public
testnet deployment at this commit (TODO(human)/TODO(Dev A): A-10 deploy, A-13 URL; A-09 cut, D-034).
Branch `a/A-05-adversarial` @ `80677ae` adds 15 explicit Foundry adversarial tests and 3 A-06
invariants (§4.1); that branch is not merged into the submission commit.

Wording rule followed: no violations were found in the reported scenarios; this is **not** a claim
that the system is secure. Contracts are unaudited and must not hold real funds.

## 1. Scope & trust zones

In scope: `contracts/src/MandateVault.sol`, `LendingSim.sol`, `MockSwap.sol`, the TypeScript policy
mirror and orchestrator, the mandate compiler/prompt boundary, the Fastify API, and the demo runtime.

Trust zones (`docs/spec/ARCHITECTURE.md`):

1. **LLM** — untrusted for facts and authority; it returns typed tool calls only.
2. **Agent process** — runs the loop and holds the executor key in the planned deployment; not
   trusted as the sole enforcer.
3. **MandateVault** — enforcer for the executor key, independent of agent behaviour.

Out of scope: mainnet, real lending protocols, production custody, external audit, formal
verification, multi-chain, ERC-1271 smart-account owners, gas accounting on chain.

## 2. Permission tiers

| Tier | Name | What the agent may do | Enforced in code |
|---|---|---|---|
| L0 | Read-only | read positions, prices, vault, audit | `apps/agent/src/orchestrator.ts` read tool handlers; no key needed |
| L1 | Plan & simulate | compute plans, `simulate` actions, explain | `orchestrator.ts` simulate path; no submit call |
| L2 | Bounded execution | submit actions inside the owner mandate | `contracts/src/MandateVault.sol:176` `execute` checks #1–#16 (PR #1 `7039146`); `packages/core/src/policy.ts:89` mirror |
| L3 | Owner decision | more budget, new target, unlock, extend, unpause | `MandateVault.sol:135` `unpause`, `:141` `ownerWithdraw`, `:151`/`:156` mandate setters; agent emits `HALTED_NEEDS_OWNER` |

The agent has no tool that creates or edits a mandate; `execute` builds target calldata itself and
never accepts raw calldata. Stopping is always allowed (`pause`, `MandateVault.sol:128`); only the
owner may unpause.

## 3. Controls implemented

| Control | Implementation | Test evidence |
|---|---|---|
| Owner-signed EIP-712 mandate | `MandateVault.sol:156` `setMandateWithSig`; typehash and domain in contract | `test_Eip712Digest_*`, `test_Typehash_MatchesSpec`, `test_SetMandateWithSig_*` |
| Cumulative budget, per-action cap | checks #13–#14, `spentUsd` state | `test_Execute_Check13_*`, `test_Execute_Check14_*`; agent `S3` |
| Asset locks | check #10 | `test_Execute_Check10_*`; agent `S7/T15` |
| Action allow-list / borrow ban | checks #8–#9 | `test_Execute_Check08_*`, `Check09_*` |
| Price freshness / deviation | checks #11–#12, price set includes pool collateral/debt (D-023) | `test_Execute_Check11_*`, `Check12_*`; agent `S5` |
| Slippage bound | check #15 | `test_Execute_Check15_*` |
| Exact approvals, reentrancy guard | `execute` `nonReentrant`, approve exact then reset | `test_Execute_Check01_ExecutorPasses`; code review |
| Pause / owner withdraw | `pause`, `unpause`, `ownerWithdraw` | `test_Pause_*`, `test_Unpause_OwnerOnly`, `test_OwnerWithdraw_*` |
| Plan binding & freshness | plan id/index/nonce/price revalidation, `MAX_PLAN_AGE_BLOCKS` | `apps/agent/test/orchestrator.test.ts` plan-binding and plan-age tests |
| Unknown submit reconciliation | `getTx`; never resubmit | `orchestrator.test.ts` unknown-submit test |
| Injection handling | `apps/agent/src/prompts.ts:77` sanitize, `:62` tripwire, escaping | `apps/agent/test/llm.test.ts` sanitizer/tripwire; `mandate.test.ts` m09 |
| Mandate clamping / clarification | `apps/agent/src/mandate/compile.ts`; refusal on open clarifications | `mandate.test.ts` m01–m12, widening/clarification tests |
| Redaction | `packages/core/src/redact.ts:20` `redactText`, `:38` `redactValue` | `packages/core/test/audit-redact.test.ts` (7 tests) |
| Rate limiting / demo gating | `apps/agent/src/api/server.ts:63` bucket, `:174` 429, demo route guard | `apps/agent/test/api.test.ts` 429 and demo-hidden tests |

## 4. Test results

`tests_total=288 passed=288 scenarios=7 runs_per_scenario=1 any_failed=none` (branch `a/A-05-adversarial` @ `80677ae`)

Breakdown: 144 Foundry, 89 core, 42 agent, 5 web, 8 eval (all run 2026-10-20; `scripts/verify-all.sh`
GREEN). The seven scenarios are S1–S5, S7, S9, each run once with `ScriptedLlm` on
`MockChainPort`; the Part 2 ablation adds 28 SIMULATED runs (A–D × S1–S5/S7/S9/T15). This is **not**
a repeated-run (pass^k) study and not on-chain evidence. Foundry includes 15 explicit `test_Txx`
adversarial tests and 3 invariants (64 runs × depth 100 = 6400 calls, 0 reverts).

| ID | Status | Layer | Evidence / gap |
|---|---|---|---|
| T01 | pass | C, T | `Check10_SwapLockedToken`, `Check08_ActionNotAllowed`; agent `S7/T15` (`ActionNotAllowed`, `AssetLocked`) |
| T02 | pass | C, T | `Check14_BudgetExceeded`, `Check13_PerActionCapExceeded`; agent `S3` keeps remaining budget |
| T03 | pass | C | `Check08_BorrowForbidden` |
| T04 | pass | C | `Check09_TargetNotAllowed` |
| T05 | pass | C, T | `Check11_Stale*`; agent `S5` zero transactions, halt recorded |
| T05b | pass | C, T | `Check12_DeviationExceeded`; agent `S3` replans after price move |
| T06 | pass | C | `Check15_SlippageExceeded`, `test_Swap_RevertsOneUnitAboveSlippage` |
| T07 | pass (Foundry C); E2E not run | C, T | Off-chain: agent `S4` simulate fails, no tx, ledger 0 spend, halt. On-chain atomicity: `test_T07_PoolPausedRevertsAndRollsBackNonceAndSpend`. E2E on anvil is not run (A-09 cut) |
| T08 | **partial** | T | Sanitizer/tripwire and m09 unit tests; no end-to-end injected-note run |
| T09 | pass | C | `SetMandateWithSig_*` replay/wrong signer/expired; EIP-712 digest tests |
| T09b | pass | C | `Check04_WrongMandateId`, `Check04_WrongNonce` |
| T10 | pass | C | `SetMandate_OnlyOwner`, `RevokeMandate_OnlyOwner`, `SetExecutor_OwnerOnlyAndEffective`, `OwnerWithdraw_OnlyOwner`, `Unpause_OwnerOnly` |
| T11 | pass | C | `Pause_Executor`, `OwnerWithdraw_WorksWhilePausedAndNoMandate`, `test_T11_PauseMidRunBlocksNextExecuteButOwnerCanWithdraw`; external mid-run pause E2E not run |
| T12 | **partial** | T | Poisoned-note sanitizer test; no plan-unchanged comparison against a control run |
| T13 | **not run** | E | Needs B-13/Part 3 five-run study |
| T14 | **not run** | E | No indexer in scope; decision uses chain reads only |
| T15 | pass (SIMULATED TS + Foundry strict) | C, T | `test_T15_ExecutorDirectForbiddenSwapReverts`; `S7/T15 config D rejects direct SWAP; permissive C wiring mines` on `MockChainPort` |
| T16 | pass | C | `Pause_Executor` succeeds, `Unpause_OwnerOnly` reverts for executor |
| T17 | pass | T | 7 audit/redaction tests; secret-shaped prompt test reports pattern ids only |
| T18 | pass | T | API burst test returns 429; demo endpoints hidden when `DEMO_MODE=false` |

Not represented as passing: mainnet/testnet evidence, on-chain post-conditions, repeated-run
consistency, injected-note plan comparison, indexer disagreement, wallet signing.

### 4.1 Generated Foundry evidence map

Generated from `grep -n 'function test_T' contracts/test/MandateVault.t.sol` and
`grep -n 'function invariant_' contracts/test/Invariants.t.sol` at branch `a/A-05-adversarial`
commit `80677ae`; every listed test passed in `forge test` (144 Foundry tests, 0 failed). A T-ID
with no **Foundry** test is marked `not covered (Foundry)` even where a TypeScript test exists;
the Status column in the table above still describes the full evidence set.

| T-ID / invariant | Foundry test | File:line | Foundry status |
|---|---|---|---|
| T01 | `test_T01_SwapLockedTokenRevertsAssetLocked`; `test_T01_SwapNotAllowedRevertsActionNotAllowed` | `contracts/test/MandateVault.t.sol:1555`; `:1567` | pass |
| T02 | `test_T02_BudgetReplanRevertsAndSpentUnchanged` | `contracts/test/MandateVault.t.sol:1576` | pass |
| T03 | `test_T03_BorrowForbidden` | `contracts/test/MandateVault.t.sol:1589` | pass |
| T04 | `test_T04_TargetNotAllowed` | `contracts/test/MandateVault.t.sol:1600` | pass |
| T05 | `test_T05_StalePriceReverts` | `contracts/test/MandateVault.t.sol:1610` | pass |
| T05b | `test_T05b_PriceDeviationRevertsAfterQuoteMoves` | `contracts/test/MandateVault.t.sol:1620` | pass |
| T06 | `test_T06_SlippageExceeded` | `contracts/test/MandateVault.t.sol:1630` | pass |
| T07 | `test_T07_PoolPausedRevertsAndRollsBackNonceAndSpend` (target revert atomicity only) | `contracts/test/MandateVault.t.sol:1639` | pass |
| T08 | — | — | not covered (Foundry); TS partial |
| T09 | `test_T09_SignatureReplayWrongSignerAndExpired` | `contracts/test/MandateVault.t.sol:1656` | pass |
| T09b | `test_T09b_StaleActionAfterNonceUsed` | `contracts/test/MandateVault.t.sol:1679` | pass |
| T10 | `test_T10_NonOwnerCannotAdminister` | `contracts/test/MandateVault.t.sol:1691` | pass |
| T11 | `test_T11_PauseMidRunBlocksNextExecuteButOwnerCanWithdraw` | `contracts/test/MandateVault.t.sol:1706` | pass |
| T12 | — | — | not covered (Foundry); TS partial |
| T13 | — | — | not covered |
| T14 | — | — | not covered |
| T15 | `test_T15_ExecutorDirectForbiddenSwapReverts` (strict wiring only) | `contracts/test/MandateVault.t.sol:1725` | pass |
| T16 | `test_T16_ExecutorCanPauseButNotUnpause` | `contracts/test/MandateVault.t.sol:1737` | pass |
| T17 | — | — | not covered (Foundry); TS pass |
| T18 | — | — | not covered (Foundry); TS pass |
| A-06 spend ≤ mandate cap | `invariant_SpentAtOrBelowMandateCap` | `contracts/test/Invariants.t.sol:97` | pass |
| A-06 spend monotonic | `invariant_SpentMonotonic` | `contracts/test/Invariants.t.sol:102` | pass |
| A-06 nonce monotonic | `invariant_NonceMonotonic` | `contracts/test/Invariants.t.sol:106` | pass |

Invariant run: `runs: 64, calls: 6400, reverts: 0` (`[invariant] runs = 64`, `depth = 100` in
`contracts/foundry.toml`). Depth is configured, not printed by this forge version; runs and calls are
printed. The handler fuzzes only the executor `REPAY` path; it does not cover owner/admin paths,
SWAP, BORROW or mandate replacement.

## 5. Failures found and fixed

1. **Mock SWAP fee vs `minAmountOut` mismatch** — fixed in `7cac091`; both sides now agree on the
   30 bps fee and slippage check.
2. **D-029: target errors absent from `ErrorName`** — contract reverts such as `PoolPaused` cannot
   be represented as a typed error. `ViemChainPort`/`MockChainPort` map them to
   `{ ok: false, error: 'Unknown', raw }`; the ledger records zero spend. Agent `S4` asserts this.
3. **Demo clock made expiry look past** — demo fixtures used a 2023 timestamp, so a 24 h mandate
   displayed an expiry in 2023. `DEMO_NOW` is now `1_792_454_400` (2026-10-20T00:00:00Z); all 36
   agent tests re-run green.
4. **Evaluation over-claim corrected** — B does not dominate A per case because A can choose a
   partial-target amount outside B's discrete levels. The report keeps 224 realized-loss losses and
   states the limitation instead of hiding them.

## 6. Known risks

| # | Risk | Impact | Mitigation implemented | Not handled / remaining |
|---|---|---|---|---|
| R1 | Contracts unaudited, written in a day | funds loss on mainnet use | testnet only; Foundry tests + fuzz; adversarial suite | no formal verification, no external audit — **do not use with real funds** |
| R2 | Simulated lending market and admin-set oracle | results don't transfer to real protocols | self-deployed sim documented as a simulation; loss model mirrors sim | real protocol interest, partial liquidations, oracle lag, MEV not modeled |
| R3 | Executor is a hot key on a server | key leak lets attacker act within mandate | gate limits damage to the mandate; pause/revoke; funds withdrawable by owner | attacker can still spend up to the remaining budget on allowed actions |
| R4 | Demo-owner key lives on the server | server compromise lets attacker set mandates | testnet only; labelled; wallet mode planned (B-15) | not suitable for production custody |
| R5 | Gas not counted in on-chain budget | spend slightly above stated budget in total cost | tracked off-chain per run and reported separately | no on-chain gas accounting |
| R6 | USD valuation depends on oracle | wrong/stale price mis-sizes limits | freshness and deviation checks; fail closed | oracle compromise out of scope |
| R7 | LLM variance and third-party dependency | inconsistent plan text/choices; provider downtime | numbers from code, gate independent, `ScriptedLlm` for tests, primary→fallback client (D-036) | live client is mock-tested only, never called live in this run; no pass^k study |
| R8 | Prompt/memory injection | model might be nudged to odd choices | untrusted delimiting, tool allow-list, plan binding, on-chain gate | model-level robustness is not guaranteed; we rely on the gate |
| R9 | Single chain, single protocol, 2 pools | narrow generality | explicit scope | no multi-chain, no real Aave |
| R10 | Public demo abuse | cost burn, spam | rate limits, demo-only controls | determined DoS not handled |
| R11 | EOA-only signature verification | no ERC-1271 smart-account owners | documented | contract-wallet owners unsupported |
| R12 | Evaluation uses constructed scenarios | may favor our design | seeded randomized study reports ties/losses; baselines defined before running | external benchmark absent |

## 7. Not covered

- Public-testnet deployment, explorer-resolvable hashes, wallet-mode signing (A-07/B-08/B-15).
- `execute` effects and post-condition check #16 at the evaluated commit (A-04.4 branch only).
- Real protocol integration, mainnet, multi-chain, ERC-1271, on-chain gas accounting.
- T12, T13, T14 and the end-to-end half of T07/T08; no k=5 repeated-run study.
- External audit, formal verification, load/DoS testing beyond a single 429 burst.
