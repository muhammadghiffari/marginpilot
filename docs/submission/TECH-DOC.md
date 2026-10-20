# MarginPilot — Technical Documentation

Team: `<TEAM NAME>` (TODO(human), D-016) · Topic F · Commit: `99ecd55` · Date: 2026-10-20

This document describes only what the repository at commit `99ecd55` implements and what was
actually run on 2026-10-20. Where an artifact is still missing, it says so. The lending market is
**SIMULATED**; the repository currently has **no public-testnet deployment** (see §7 and
`docs/submission/EXECUTION-EVIDENCE.md`).

## 1. Problem & motivation

A borrower with several lending positions can be liquidated in one market while a rescue in another
market consumes the same limited stablecoin balance. A naive automation bot needs a hot key and an
unbounded allowance; an LLM with a wallet is worse, because prompt text can be attacker-controlled.
MarginPilot separates three things:

- the **owner** sets a signed, cumulative, expiring mandate;
- the **agent** may only choose among fixed tools inside that mandate;
- the **vault** enforces every limit on chain, even if the agent process and executor key are
  compromised.

The product question in `docs/prd/PRD.md` §5 is narrow: can a shared-budget rescue under an
on-chain mandate complete the supported scenarios without a policy violation, and how does its
allocation quality compare with a simple independent threshold rule?

## 2. Related work & what we claim

We do not claim that any individual ingredient is new. `docs/research/NOVELTY-AND-PRIOR-ART.md`
catalogues liquidation agents, rule-based rescue keepers, wallet-permission standards and
execution-layer invariants. The closest prior art we actually read is arXiv:2604.14583 (V-read:
abstract only), an agentic liquidation-prevention framework that predicts risk and simulates
interventions on an Aave v3 simulator. Our narrow, falsifiable question is different: whether an
owner-signed cumulative budget and asset locks survive replanning and a compromised executor key,
compared with an off-chain-only policy.

Other citations in that file are marked `V-search` or `U`; they are deliberately **not** cited here
until the human verification task in `docs/research/EVIDENCE.md` is complete (TODO(human)).

No claim of "first", "novel", "unsolved", or "secure" is made.

## 3. Solution overview

Trust zones (`docs/spec/ARCHITECTURE.md`):

1. **LLM** — untrusted for facts and authority; it can only return typed tool calls.
2. **Agent process** — runs the loop and holds the executor key in the planned deployment; it is
   *not* trusted as the sole enforcer.
3. **MandateVault** — the enforcer; it constrains the executor key regardless of agent behaviour.

| Component | Path | Role |
|---|---|---|
| Contracts | `contracts/src/MandateVault.sol`, `LendingSim.sol`, `MockSwap.sol` | EIP-712 mandate, execution check gate (#1–#15 at this commit; effects/#16 on Dev A's branch), pause/withdraw, simulated two-pool market |
| Core | `packages/core/src/policy.ts`, `optimizer.ts`, `mock-chain-port.ts`, `audit.ts`, `ledger.ts` | Pure policy mirror, loss model and exhaustive planner, typed chain port, hash-chained audit, redaction |
| Agent | `apps/agent/src/orchestrator.ts`, `llm/`, `mandate/`, `api/`, `demo/` | Fixed tool loop, deterministic `ScriptedLlm`, mandate compiler, Fastify API/SSE, demo runtime |
| Web | `apps/web/src/` | One Vite/React page for instruction → mandate → plan → verified state |
| Evaluation | `eval/src/part1-simulation.ts`, `report.ts`, `cli.ts` | Seeded Part 1 study and generated report artifacts |

Data flow: instruction → zod-validated mandate draft (untrusted text is escaped and tripwired) →
owner/demo signature → `getPositions`/`getPrices`/`getVault` → `optimizeRescue` → per-action
`simulate` → `submit` → `getTx` reconciliation → audit/ledger/SSE. The web page renders only
structured payloads; it never parses numbers out of model prose.

## 4. Mandate & enforcement design

`Mandate` fields (`packages/core/src/types.ts`, mirrored in Solidity): id, validFrom/validUntil,
`maxTotalSpendUsd`, `maxPerActionUsd`, `minLiquidReserveUsd`, `maxSlippageBps`, `maxPriceAgeSec`,
`maxPriceDeviationBps`, `allowedActions`, `allowBorrow`, `allowedTargets`, `lockedTokens`.
Amounts are USD-8 decimals and token amounts are `bigint`.

The owner signs an EIP-712 `Mandate` (`MarginPilotVault` / version `1`, chain id and verifying
contract bound). `setMandateWithSig` rejects replay, wrong signer, expired deadline and non-next id;
`setMandate` is owner-only. The executor cannot install or edit a mandate.

`execute` applies the check order frozen in `docs/spec/CONTRACTS.md`: executor, pause, active
mandate, mandate id/nonce, deadline, validity window, non-zero amount, action bit (and
`BorrowForbidden`), target allow-list, locked tokens, price freshness for every token in the
action's price set, quoted-price deviation, per-action cap, cumulative budget, slippage, then the
specified target call; after the call, reserve floor and non-decreasing HF. At this commit the
contract enforces checks #1–#15 but does not yet perform the effects or check #16; reverts are
atomic and the off-chain ledger records no spend for a reverted action.

**Current integration limit:** the evaluated commit enforces checks #1–#15. Effects,
check #16 (`PostConditionFailed`) and `liquidReserveUsd8()` exist on Dev A's `a/A-04-vault` branch
(commits `e1f90f3`, `dec5aae`) but are not yet merged into `main`; therefore T07's on-chain half is
not run here (TODO(Dev A): A-04.4 merge). The TypeScript policy mirror already implements the same
ordering plus `checkPostConditions`.

Permission tiers (`docs/security/PERMISSION-TIERS.md`): L0 read, L1 plan/simulate (no submit path),
L2 bounded execution inside the mandate, L3 owner-only decisions such as more budget, unlock,
unpause. The agent cannot raise its own tier; stopping is always allowed; unknown state halts.

## 5. Agent design

The tool set is fixed in `AGENT-DESIGN` §2: reads, `simulate_action`, `submit_action`,
`explain_plan`, `halt`. There is no tool that creates a mandate, changes limits, or passes raw
calldata. `explain_plan` is template-only in this commit; an LLM paraphrase with a grounding check
is B-13 and is not implemented.

The loop (`apps/agent/src/orchestrator.ts`) observes, plans, binds the plan to the observed block,
revalidates the current plan id/index/nonce and quoted prices before each action, simulates before
submit, and reconciles unknown submissions with `getTx` instead of resending. Replans are allowed
only for the remaining budget, up to `MAX_REPLANS` (default 3); an action older than
`MAX_PLAN_AGE_BLOCKS` (default 2) is never submitted. `MAX_TOOL_CALLS` (default 30) aborts the run.
A pause or stale/conflicting data halts with `HALTED_NEEDS_OWNER`. The owner pause is the kill
switch.

Prompt handling: `apps/agent/src/llm/sanitize.ts` strips control/zero-width characters, caps
length, neutralizes delimiter look-alikes, and flags directive/secret-shaped text with pattern ids
only. The mandate compiler clamps model output to the owner's text, cross-checks amounts with a
regex, emits clarifications for missing or ambiguous fields, and refuses to confirm a draft with
open clarifications. `ScriptedLlm` replays deterministic traces in tests; the configured live
provider is a typed offline stub that makes no network call (`LlmNotConfiguredError` /
`LlmProviderUnavailableError`).

The API (`apps/agent/src/api/server.ts`) validates every request with zod, streams typed
`RunEvent`s over SSE, rate-limits with a capacity bucket (429), hides `/api/demo/*` unless
`DEMO_MODE=true`, and serves the built web page from one URL. Demo signing is server-side EIP-712
and refuses to run without `DEMO_OWNER_PRIVATE_KEY`; no key material is logged.

## 6. Planner

`packages/core/src/optimizer.ts` values a position by the loss if liquidated: debt × close factor ×
liquidation bonus, evaluated now and under a 10% stress with weight `lambdaBps=5000`; safe means
`HF >= 1.005`. For each position it considers discrete repay levels (`safe-now`, `safe-stress`,
`target`, `none`), enumerates allocations under the shared budget, per-action cap, reserve floor,
locked tokens and allowed actions, and returns the feasible plan with the lowest modeled loss. It is
exact for the discrete candidate set, not for continuous amounts. It can therefore lose to a
partial-target rule on individual cases; the generated report says so.

This deterministic planner is intentionally not the research novelty. The LLM's role is the
natural-language mandate, clarification, orchestration and explanation; all money and limits come
from code.

## 7. Implementation

Stack: Solidity 0.8.24 + Foundry; TypeScript strict with `bigint` money and zod at boundaries;
Fastify; React 19 + Vite; pnpm workspaces; Vitest.

Repository map and run instructions are in the root `README.md` (setup in fewer than ten commands).
`.env.example` lists names only. `scripts/verify-all.sh` is the green gate.

Deployment addresses: **none for a public testnet yet**. `TODO(Dev A)`: A-07 must provide
`contracts/script/Deploy.s.sol`, `scripts/deploy.sh`, `deployments/<chainId>.json`,
`packages/core/src/abi/` and `eval/fixtures/base.json`; `ViemChainPort` (B-08) is blocked on those
artifacts. Until then the API uses `MockChainPort` only in explicit demo mode; there is no silent
production fallback.

## 8. Evaluation

Design (`docs/eval/EVALUATION-PLAN.md`): Part 1 compares a local threshold rule A
(`localThresholdBaseline`) with the exhaustive optimizer B on seeded, constructed two-pool cases.
Part 2 (anvil configs A–D) and Part 3 (LLM compile/explanation/injection) are **not run**: Part 2
needs A-07/A-09 and Part 3 needs B-13. No numbers are claimed for them.

Part 1 command actually run:

`pnpm eval:run -- --part 1 --seed 1`

Generated artifact: `eval/results/2026-10-20T09-44-04-427Z/summary.md` (500 cases, seeds 1–500;
`results.json` and `run-meta.json` are regenerated locally and not committed). The artifact header
records commit `4c4da28`, the evaluation-code commit; later commits changed UI/API/demo code and
docs, not the Part 1 generator. It is SIMULATED: no chain, no LLM. A and B share one Bernoulli
stress realization per case (10% drop, 50% probability).

| Metric (USD unless noted) | A mean / median / p90 | B mean / median / p90 |
|---|---:|---:|
| Modeled expected loss | 118.0107 / 84.0291 / 274.9051 | 103.2832 / 70.3459 / 249.2791 |
| Realized loss under stress | 90.3839 / 80.6432 / 201.8006 | 76.4605 / 68.6981 / 183.6662 |
| Spend | 132.9882 / 127.0000 / 271.0000 | 77.5270 / 56.5300 / 214.9600 |
| Safe pools (count) | 1.4120 / 2.0000 / 2.0000 | 1.5100 / 2.0000 / 2.0000 |

Realized loss, B − A: mean **−$13.9234**, bootstrap 95% CI **[−$17.6227, −$10.3966]**;
win/tie/loss **118 / 158 / 224**. Modeled expected loss, B − A: mean **−$14.7275**, CI
**[−$17.7052, −$11.8094]**; win/tie/loss **203 / 50 / 247**.

Threats to validity: the generator is constructed and limited to two pools by the current
`PositionSnapshot.poolId` union; the loss model mirrors the optimizer; A is deliberately simple;
there is no interest, MEV or execution cost; B's discrete levels can lose to A's partial-target
amount. The result supports "lower mean loss in this study", not per-case dominance and not
real-market performance. Raw numbers must be regenerated, never hand-edited.

## 9. Security

`docs/submission/SECURITY-SELF-ASSESSMENT.md` reports controls and T01–T18 status honestly. The
evaluated tree has 228 passing automated tests: 98 Foundry, 83 core, 36 agent, 5 web, 6 eval.
Seven scenarios (S1–S5, S7, S9) run once each with `ScriptedLlm` on `MockChainPort`; this is not a
k=5 reliability study. No violations were found in those reported scenarios; the contracts are
unaudited and must not hold real funds.

## 10. Limitations & future work

From `docs/security/KNOWN-RISKS.md`: unaudited contracts; simulated market and oracle; hot executor
key; server-held demo-owner key; gas outside the on-chain budget; oracle dependence; LLM/provider
variance; injection robustness relies on the gate; one chain, one simulated protocol, two pools;
public-demo abuse; EOA-only signatures; constructed evaluation. B-08 (`ViemChainPort`), B-15
(wallet signing), B-13 (LLM paraphrase/grounding) and A-07/A-09 (deployment and anvil runner) are
not complete. Mainnet is out of scope.

## 11. References

1. Spadea & Seneviratne, *From Risk to Rescue: An Agentic Survival Analysis Framework for
   Liquidation Prevention*, arXiv:2604.14583, 16 Apr 2026. **V-read (abstract)**; used only for the
   qualitative description in §2.
2. All other sources in `docs/research/EVIDENCE.md` remain `V-search`/`U` and are not cited in this
   submission until verified (TODO(human)).
