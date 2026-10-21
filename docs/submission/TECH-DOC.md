# MarginPilot — Technical Documentation

Team: **MarginPilot** (D-035) · Topic F · Date: 2026-10-21

This document describes the repository working tree at the time of writing and what was measured;
where an artifact is missing, it says so. The lending market is **SIMULATED** (D-002). The vault and
agent can run against a real EVM chain: local-anvil and public Ethereum Sepolia runs are recorded in
`evidence/anvil-e2e-20261021T060254Z.json` and `evidence/sepolia-ui-e2e-20261021.json`. The Sepolia
run was driven from the console in a browser and finished `COMPLETED` with two mined REPAY
transactions. The lending market is still a self-deployed simulator.

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
| Contracts | `contracts/src/MandateVault.sol`, `LendingSim.sol`, `MockSwap.sol` | EIP-712 mandate, execution check gate #1–#16, pause/withdraw, simulated two-pool market |
| Core | `packages/core/src/policy.ts`, `optimizer.ts`, `mock-chain-port.ts`, `audit.ts`, `ledger.ts` | Pure policy mirror, loss model and exhaustive planner, typed chain port, hash-chained audit, redaction |
| Agent | `apps/agent/src/orchestrator.ts`, `llm/`, `mandate/`, `api/`, `demo/` | Fixed tool loop, deterministic `ScriptedLlm`, mandate compiler, Fastify API/SSE, demo runtime |
| Web | `apps/web/src/` | One Vite/React page for instruction → mandate → plan → verified state |
| Evaluation | `eval/src/part1-simulation.ts`, `eval/src/part2-runner.ts`, `report.ts`, `cli.ts` | Seeded Part 1 study and the SIMULATED A–D Part 2 ablation, with generated artifacts |

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
specified target call; after the call, reserve floor and non-decreasing HF. Checks #1–#16 and the
effects are merged on `main` (PR #1 `7039146`, follow-up `b01a970`; PR #2 `c7000f0`): wrong-role
targets map to `TargetNotAllowed` (SWAP role probe at #9b, D-032), the reserve token is in the #11
price set (D-031), and a missing price maps to `StalePrice`. Reverts are atomic and the off-chain
ledger records no spend for a reverted action.

**Integration status:** the on-chain code is merged and its Foundry suite is green (128 tests).
`apps/agent/src/chain/viem-port.ts` (`ViemChainPort`) implements reads, simulate-before-submit,
receipt handling, unknown-transaction reconciliation and owner/executor writes against the deployed
contracts. `scripts/e2e-anvil.sh` deploys a fresh chain, installs an owner-signed mandate, runs the
two-action rescue and records mined transaction hashes (local anvil, chain 31338). The TypeScript
policy mirror implements the same ordering plus `checkPostConditions`; the full differential test is
B-15. On Sepolia, a browser-driven run signed mandate #2 and mined both REPAY actions in one run
after the agent replanned when the first plan aged past the two-block limit; the stale action was
never broadcast. The market remains simulated.

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
open clarifications. `ScriptedLlm` replays deterministic traces in tests and remains the CI/demo
default. `OpenAICompatLlm` (D-036) implements the same `LlmClient` against any OpenAI-compatible
`/chat/completions` endpoint: tools first, a JSON-schema retry when the endpoint rejects tools, a
primary→fallback chain, temperature 0, model/usage recorded in the response, and the API key read
only from the environment and never logged. The orchestrator appends a hash-chained `llm.response`
audit entry with `model`, `temperature`, `usage` and `toolCalls` (never prompt text or keys). It was tested against a local mock HTTP server only; **no
live model call was made**, so no live-provider result is claimed.

The API (`apps/agent/src/api/server.ts`) validates every request with zod, streams typed
`RunEvent`s over SSE, rate-limits with a capacity bucket (429, always on), hides `/api/demo/*` unless
demo controls are explicitly enabled, and serves the built web page from one URL. Chain mode is
explicit (`CHAIN_MODE=anvil` or `testnet`); there is no silent fallback to the mock. Owner signing has
two paths: a server-side key that must match the deployment owner, and browser-wallet EIP-712
signing where the API prepares the typed data, verifies the recovered owner before relaying, and
never receives a private key. No key material is logged.

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

Deployment addresses: `deployments/31337.json` (local anvil), `deployments/11155111.json` (public
Sepolia, the vault the console now serves) and `deployments/11155111-run1.json` (the first Sepolia
deployment, kept so its recorded receipts stay verifiable). `scripts/e2e-anvil.sh` deploys a
throwaway chain 31338 and records local receipts under `evidence/`. The Sepolia receipts and the
browser-driven run report are in `evidence/sepolia-ui-e2e-20261021.json`. `scripts/deploy-testnet.sh`
is a guarded wrapper but its Forge gas estimation **failed** on Sepolia; the successful deployment
used an encrypted keystore, explicit `cast send` gas limits, and the smaller via-IR vault.
`scripts/start-testnet.sh` starts the agent against `deployments/<chainId>.json`. The wrapper refuses
mainnet chain ids, local chain ids, a
`--private-key` argument, an owner equal to the executor, and contract accounts as owner/executor.
It requires a Foundry keystore or hardware signer, a funded `SENDER`, and a matching RPC chain id.
The agent refuses mainnet ids, verifies the RPC chain id, and checks that code exists at every
deployed address before serving.

UI evidence captured from the served demo on 2026-10-20 (`docs/submission/screenshots/`): desktop
run, 390px layout, and two halt reasons. Those screenshots are from the **SIMULATED** mode and say
so; their hashes are synthetic. The local-anvil run is separately evidenced by the JSON file above
and is labelled `ANVIL`, not `TESTNET`.

## 8. Evaluation

Design (`docs/eval/EVALUATION-PLAN.md`): Part 1 compares a local threshold rule A
(`localThresholdBaseline`) with the exhaustive optimizer B on seeded, constructed two-pool cases.
Part 2 runs the A–D ablation of workflow/enforcement. Part 3 (LLM compile/explanation/injection)
is **not run**.

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

### Part 2 — workflow & enforcement (SIMULATED, `MockChainPort`)

Command actually run: `pnpm eval:run -- --part 2 --seed 1`. Generated artifact:
`eval/results/2026-10-20T14-11-32-655Z/summary.md` (28 runs: configs A–D × S1–S5, S7/T15, S9).
A-09 (anvil runner + liquidator bot) was cut to protect the deadline (D-034), so Part 2 runs on the
in-memory `MockChainPort` with the deterministic `ScriptedLlm`: it produces **no anvil transactions,
no gas observations and no on-chain hashes**. Every Part 2 number is SIMULATED, and on-chain evidence
must come from the testnet run.

Configs: A = per-position threshold script + permissive mandate; B = fixed optimizer loop + strict
on-chain gate; C = agent on a permissive mandate (off-chain per-plan check only); D = agent with the
strict on-chain gate (the product). A and C are weak by construction; the comparison is an ablation
of design choices, not a competitive benchmark. Realized loss applies a single-step liquidation
model (close factor × liquidation bonus) to the final simulated state; it is not chain state.

| Cfg | Violations (all 7 scenarios) | False completions | Acceptance passes | Direct SWAP (S7/T15) |
|---|---:|---:|---:|---|
| A | 4 (stale ×1, direct-SWAP ×3) | n/a (script) | 1/7 | mines → intended-mandate violations |
| B | 0 | n/a (script) | 5/7 | rejected, 0 tx |
| C | 8 (budget ×3, stale ×2, direct-SWAP ×3) | 4 | 2/7 | mines → 3 intended-mandate violations |
| D | **0** | **0** | **7/7** | rejected, 0 tx |

Totals: 12 hard-constraint violations across 7 of 28 runs, all in A/C; 0 duplicate executions;
false completion 4/28 (all C). Config D spent $250.16 on S1 (cap $260), $86.57 on S2 (cap $150,
`COMPLETED_PARTIAL`), halted on S4/S5/S9 as expected, and left $32.8357 modeled realized loss on S3
after the mid-plan 5% price move (it replanned; no violation). The exact per-run rows are in the
generated `summary.md`; do not copy numbers from this prose without regenerating.

## 9. Security

`docs/submission/SECURITY-SELF-ASSESSMENT.md` reports controls and T01–T18 status honestly. The
current tree has 328 passing automated tests: 144 Foundry, 89 core, 79 agent, 8 web, 8 eval
(`scripts/verify-all.sh`, 2026-10-21). Seven scenarios (S1–S5, S7, S9) run once each with
`ScriptedLlm` on `MockChainPort`, plus the 28-run Part 2 ablation. Config D records 0
hard-constraint violations and 7/7 acceptance passes in that SIMULATED study; this is not a k=5
reliability study and not public-testnet evidence. The contracts are unaudited and must not hold
real funds.

## 10. Limitations & future work

From `docs/security/KNOWN-RISKS.md`: unaudited contracts; simulated market and oracle; hot executor
key; server-held demo-owner key; gas outside the on-chain budget; oracle dependence; LLM/provider
variance; injection robustness relies on the gate; one chain, one simulated protocol, two pools;
public-demo abuse; EOA-only signatures; constructed evaluation. The real chain adapter and
server-side owner signing were exercised on Sepolia; browser-wallet extension E2E was not.
B-15's full differential test and B-13 (LLM paraphrase/grounding) are not complete, A-09 was
cut (D-034), and A-10 still needs public S2/S7 cases plus a reproducible deployment path.
A-13 (public URL) is human-run and not done. Mainnet is out of scope.

## 11. References

1. Spadea & Seneviratne, *From Risk to Rescue: An Agentic Survival Analysis Framework for
   Liquidation Prevention*, arXiv:2604.14583, 16 Apr 2026. **V-read (abstract)**; used only for the
   qualitative description in §2.
2. All other sources in `docs/research/EVIDENCE.md` remain `V-search`/`U` and are not cited in this
   submission until verified (TODO(human)).
