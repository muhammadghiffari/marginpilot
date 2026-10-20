# Security Self-Assessment — MarginPilot

Commit: `99ecd55` · Run date: 2026-10-20 · Chain: **SIMULATED (`MockChainPort`)**; no public
testnet deployment at this commit (TODO(Dev A): A-07/A-09).

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
| L2 | Bounded execution | submit actions inside the owner mandate | `contracts/src/MandateVault.sol:176` `execute` checks #1–#15; `packages/core/src/policy.ts:89` mirror |
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

`tests_total=228 passed=228 scenarios=7 runs_per_scenario=1 any_failed=none`

Breakdown: 98 Foundry, 83 core, 36 agent, 5 web, 6 eval (all run 2026-10-20; `scripts/verify-all.sh`
GREEN). The seven scenarios are S1–S5, S7, S9, each run once with `ScriptedLlm` on
`MockChainPort`. This is **not** a repeated-run (pass^k) study.

| ID | Status | Layer | Evidence / gap |
|---|---|---|---|
| T01 | pass | C, T | `Check10_SwapLockedToken`, `Check08_ActionNotAllowed`; agent `S7/T15` (`ActionNotAllowed`, `AssetLocked`) |
| T02 | pass | C, T | `Check14_BudgetExceeded`, `Check13_PerActionCapExceeded`; agent `S3` keeps remaining budget |
| T03 | pass | C | `Check08_BorrowForbidden` |
| T04 | pass | C | `Check09_TargetNotAllowed` |
| T05 | pass | C, T | `Check11_Stale*`; agent `S5` zero transactions, halt recorded |
| T05b | pass | C, T | `Check12_DeviationExceeded`; agent `S3` replans after price move |
| T06 | pass | C | `Check15_SlippageExceeded`, `test_Swap_RevertsOneUnitAboveSlippage` |
| T07 | **partial** | C, T | Off-chain half: agent `S4` simulate fails, no tx, ledger 0 spend, halt. On-chain target-revert atomicity is blocked on A-04.4 effects/check #16 (branch `dec5aae`, not merged) |
| T08 | **partial** | T | Sanitizer/tripwire and m09 unit tests; no end-to-end injected-note run |
| T09 | pass | C | `SetMandateWithSig_*` replay/wrong signer/expired; EIP-712 digest tests |
| T09b | pass | C | `Check04_WrongMandateId`, `Check04_WrongNonce` |
| T10 | pass | C | `SetMandate_OnlyOwner`, `RevokeMandate_OnlyOwner`, `SetExecutor_OwnerOnlyAndEffective`, `OwnerWithdraw_OnlyOwner`, `Unpause_OwnerOnly` |
| T11 | pass | C | `Pause_Executor`, `OwnerWithdraw_WorksWhilePausedAndNoMandate`; external mid-run pause E2E not run |
| T12 | **partial** | T | Poisoned-note sanitizer test; no plan-unchanged comparison against a control run |
| T13 | **not run** | E | Needs B-13/Part 3 five-run study |
| T14 | **not run** | E | No indexer in scope; decision uses chain reads only |
| T15 | pass (SIMULATED) | T | `S7/T15 config D rejects direct SWAP; permissive C wiring mines` on `MockChainPort` |
| T16 | pass | C | `Pause_Executor` succeeds, `Unpause_OwnerOnly` reverts for executor |
| T17 | pass | T | 7 audit/redaction tests; secret-shaped prompt test reports pattern ids only |
| T18 | pass | T | API burst test returns 429; demo endpoints hidden when `DEMO_MODE=false` |

Not represented as passing: mainnet/testnet evidence, on-chain post-conditions, repeated-run
consistency, injected-note plan comparison, indexer disagreement, wallet signing.

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
| R7 | LLM variance and third-party dependency | inconsistent plan text/choices; provider downtime | numbers from code, gate independent, `ScriptedLlm` for tests | live provider is an offline stub; no pass^k study |
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
