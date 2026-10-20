# PRD — MarginPilot: a mandate-bound autonomous wallet for DeFi loan rescue
FinTechathon 2026 · International Track · **Topic F — Agent Wallet (Autonomous On-chain Wallet)**
Status: approved for build. Specs in `docs/spec/` are the design; this file is the "what and why".

## 1. One-liner
An AI wallet agent that, given a plain-language instruction ("protect my loans, spend at most $260, don't touch my ETH"), plans and executes a **multi-step rescue across several at-risk lending positions**, while an **on-chain vault enforces the user's signed mandate** (cumulative budget, locked assets, allowed actions, freshness) — so the limits survive replanning, failures and even a compromised agent process.

## 2. Problem (evidence in `docs/research/EVIDENCE.md`, with verification status per source)
1. **Liquidations cost borrowers real money.** Peer-reviewed measurement of Aave/Compound/MakerDAO/dYdX shows liquidation designs transfer value from borrowers via bonuses and can over-liquidate (Qin et al., ACM IMC 2021).
2. **Per-position automation exists** (e.g. DeFi Saver, protocol position managers, research agents such as *From Risk to Rescue*, arXiv 2604.14583). It acts locally; when several positions compete for one limited pot of funds, what to protect first and how to keep acting within the user's limits across several steps is left to the user or to independent rules.
3. **Agents holding keys are fragile.** Context/memory-manipulation attacks on Web3 agents are demonstrated (arXiv 2503.16248), tool-using agents are inconsistent across repeated runs (τ-bench, ICLR 2025), and execution-layer guards are an active research area (PACE arXiv 2608.17220; arXiv 2603.10092).
4. **The hard part is not the arithmetic.** Choosing repay amounts for 2–5 positions is a small knapsack (exact search suffices). The hard part is **reliable delegated execution**: irreversible, non-atomic multi-step actions under moving prices and failures, with user limits that persist across replans, and an agent that cannot be talked out of them.

We do **not** claim this problem is "unsolved" or that nobody has built parts of it. Our claim is narrow and tested (§9).

## 3. Users
- **Primary (demo persona, "Rina"):** an active DeFi borrower with two loans on different collateral who wants to delegate rescue without giving an agent free reign over her wallet.
- **Evaluators (judges):** open a public link, give an instruction, watch the agent act, try to break it, read the evidence pack.

## 4. Goals / Non-goals
Goals: (G1) complete real workflows end-to-end on a public testnet with tx hashes; (G2) demonstrate that limits hold in tested adversarial scenarios; (G3) a smooth, explainable interaction; (G4) reproducible, honest evaluation against baselines.
Non-goals: real-money/mainnet use; a new lending protocol; cross-chain; yield/trading; claiming universal security; production audit; MEV protection; supporting arbitrary protocols.

## 5. Scope and priorities
| Priority | Feature (FR ids below) |
|---|---|
| **P0 (must demo)** | FR-01…FR-13, FR-17, eval Part 2 on anvil + Part 1 pure simulation, evidence pack for S1, S2, S7 (+ S3 or S4) on a public testnet |
| **P1 (should)** | FR-05 grounding check, FR-14 Part 3 (agent-specific), FR-15 memory, FR-16 differential test, S6/S8, repeated-run study, wallet-mode signing, on-chain source verification, **FR-20 defensive learning (S10, eval Part 4)** |
| **P2 (could)** | FR-18 MCP exposure of tools, FR-19 owner-signed per-action approval, SWAP/SUPPLY planning in optimizer |
**Cut order if time runs out:** P2 → **FR-20 (see FR-20 internal order)** → memory → wallet-mode signing → Part 3 → differential test → S6/S8. If FR-20 is cut entirely, also remove H4 and every "learning" wording from the docs and UI (D-020). **Never cut:** real testnet tx evidence, the on-chain gate, adversarial tests, honest known-risks.

## 6. Functional requirements
| ID | Requirement | Acceptance criterion (testable) |
|---|---|---|
| FR-01 | Compile a natural-language instruction into a structured mandate draft with clarifications and listed assumptions | ≥ 90% field-exact match on the seeded prompt set (`eval/fixtures/mandate-prompts.jsonl`, expanded to ≥ 30); ambiguous prompts produce a clarification, not a guess |
| FR-02 | Owner reviews a plain-language + raw view and signs the mandate (EIP-712); vault accepts only the owner's signature | signature from another key ⇒ `BadSignature`; replay ⇒ `BadNonce`; UI blocks confirm while clarifications exist |
| FR-03 | Observe positions, prices, vault balances from chain; never from LLM text | all numbers in reports equal chain reads at the cited block |
| FR-04 | Deterministic rescue planner (`OPTIMIZER.md`) | reproduces the pinned fixture; deterministic; passes brute-force cross-check |
| FR-05 | Explain every plan (what, why, expected effect, what is *not* done, residual risk, remaining budget) | rubric in `EVALUATION-PLAN.md` Part 3; P1: grounding check rejects ungrounded numbers |
| FR-06 | Execute only through `MandateVault.execute` with the executor key; no raw calldata, no free-form tool for funds | direct call with executor key and a forbidden action reverts with the exact error (tests T01–T10) |
| FR-07 | Verify post-state, update ledger, produce a final report | `false completion rate` = 0 on scenario suite; ledger equals `ActionExecuted` events |
| FR-08 | Replan on stale/rejected plans with the **remaining** cumulative budget | S3: total spend across replans ≤ cap; ≤ 3 replans |
| FR-09 | Halt safely (tier-3) with an exact owner decision request; never widen limits itself | S2/S5: halt reason present; zero policy violations |
| FR-10 | Kill switch (`pause`) and owner withdrawal | S9: no action after pause; `ownerWithdraw` works while paused |
| FR-11 | Hash-chained audit log, exportable | chain verifies; secrets redacted (unit test) |
| FR-12 | Scenario lab (DEMO_MODE): shock, stale oracle, failure injection | every scenario S1–S9 reproducible from the UI or script |
| FR-13 | Dashboard: HF before/after, budget bar, run timeline, tx links | judge can follow a run without docs (`UI-SPEC.md`) |
| FR-14 | Evaluation harness with 3 parts (`EVALUATION-PLAN.md`) | `pnpm eval:run` writes `eval/results/<ts>/results.json` + `summary.md` |
| FR-15 | Session memory treated as untrusted | T12 passes |
| FR-16 | Differential test: `policy.ts` vs on-chain reverts | ≥ 500 random actions agree on `ok/error` |
| FR-17 | Public deployment with rate limiting and demo-only controls | URL works from outside; abuse limits active; keys testnet-only |
| FR-18 | (P2) MCP server exposing read tools | — |
| FR-19 | (P2) per-action owner co-signature | — |
| FR-20 | (P1) **Defensive learning.** Derive parameter *lessons* deterministically (no LLM) from structured run events only (ledger/audit, liquidator-bot events, owner feedback `planId + rating + reasonCode`). Only a `self_tighten` lesson that moves a registry parameter toward *more restrictive* may auto-apply; every `plan_hint` and every loosening requires owner approval after a `shadowReplay`. Safety claim: **bounded, owner-controlled learning** (`AGENT-DESIGN.md` §7A). Requires D-020 to be DECIDED before build | S10 passes; `deriveLessons` output is byte-identical on repeated and shuffled input and makes 0 LLM calls; no lesson outside registry bounds; no non-tightening lesson reaches `applied` without owner approval; mandate and on-chain vault state are unchanged by learning; eval Part 4 reports safety invariants (violations found, with N) and held-out utility, including no-gain results |

**FR-20 internal cut order:** Part 4 utility study (4c/4d) → UI polish of the Learning panel → `plan_hint` lessons (R4, R5) → `self_loosen` (R6). Never cut: registry bounds, the asymmetric ratchet, S10 safety assertions, Part 4 safety invariants (4a, 4b, 4e).

## 7. Non-functional requirements
Security: gate outside LLM and outside the agent process; no secret in prompts/logs/repo; fail closed. Reliability: no duplicate execution; unknown tx status is reconciled, never resent. Reproducibility: fixtures, seeds, pinned versions, scripts. Cost: LLM spend capped (`DEMO_MAX_RUNS_PER_HOUR`, provider-side usage limit). Performance: a run completes in < 90 s on testnet in the happy path (blocks permitting). Accessibility: works on mobile width.

## 8. Mapping to the official rubric (weights: task 40, security 30, innovation & interaction 30, bonus 0–5)
| Criterion | What we show | Evidence artifact |
|---|---|---|
| Task completion (40) | NL → mandate → plan → real txs → verified report; S1, S2, S3/S4 end-to-end with tx hashes; false-completion = 0 | `evidence/execution-evidence.md`, eval summary |
| Security & compliance (30) | On-chain enforced mandate; permission tiers; 18 adversarial tests with results and N; honest known-risks; kill switch | `docs/security/*`, test output, evidence hashes of rejected attempts (reverts are simulated via `eth_call`; mined rejections only where intended) |
| Innovation & interaction (30) | Limits that persist across replanning (ablation C vs D); NL mandate with clarification; grounded explanations; scenario lab; P1: owner-approved learning panel with shadow-replay evidence (FR-20) | ablation table, UI, demo script |
| On-chain bonus (0–5) | Multi-step real transactions through the gate incl. one rejection shown | explorer links |
Security is a **baseline requirement for every topic**; we do not treat it as our only differentiator. The differentiators are interaction quality and measured evidence.

## 9. What we claim — and what we do not
Claim (hypotheses tested in the evaluation): (H1) global allocation lowers expected/realized liquidation loss vs independent threshold automation under shared limited funds — *with ties and losses reported*; (H2) mandate enforcement that persists across replans and lives on-chain prevents violations that an off-chain, per-plan check does not (ablation, by construction); (H3) the LLM layer adds measurable value only in NL mandate compilation, tool orchestration and explanation, **not** in allocation math; (H4, FR-20) lessons derived deterministically from structured run events, with only tightenings auto-applied and everything else gated by owner-approved shadow replay, reduce rejected/reverted submissions and, for `plan_hint` lessons, realized liquidation loss on **held-out** seeded scenarios, while the number of policy violations stays zero — *no-gain and negative results are reported*.
Do **not** write: "first AI wallet", "first agent to prevent liquidation", "unsolved problem", "100% secure", "guarantees no liquidation", "saved real DeFi positions". Write: "no violations were found in N reported scenarios". For FR-20 also do **not** write: "self-improving agent", "autonomous learning", "learns to be safe", "the agent adapts its own limits". Write: "bounded, owner-controlled learning" (the agent can only tighten its own pre-flight thresholds; everything else needs the owner).

## 10. Assumptions and constraints
Testnet + simulated market (D-002). Deadline per D-014 (22:59 WIB, 20 Oct 2026; clock time not confirmed from a primary source). Two developers. Network acceptance per D-003 (verify). No audit; contracts are hackathon-grade.

## 11. Risks
| Risk | Mitigation |
|---|---|
| Scope too large for the time | P0/P1/P2 + cut order; vertical slice first on anvil; testnet only after green local run |
| Faucet/RPC flakiness | request test ETH immediately; two RPC URLs; deploy early (milestone M3) |
| LLM variance/cost | `ScriptedLlm` for CI; temperature 0; k-run study only for scenarios that matter |
| Cross-language EIP-712 mismatch | dedicated integration test, pair on it |
| FR-20 scope creep or a "learning" claim the evidence cannot support | P1 with its own cut order; learnable surface is a closed registry of 5 parameters; Part 4 reports held-out results including no gain; claim limited to "bounded, owner-controlled learning" |
| Judges consider it "just a spending limit" | lead the demo with S3 (replan keeps budget) and S7 (compromised executor key still blocked), show the ablation |
| Unverified claims in docs | `EVIDENCE.md` verification table; `AGENTS.md` rule: never state unverified facts |

## 12. Glossary
Mandate: owner-signed limits. Executor: agent's hot key, only able to call `execute`. Gate: the vault's ordered checks. HF: health factor. Ablation: removing a component to measure its effect. Lesson: a deterministic, hash-chained proposal to change one registry parameter, derived from structured events. Ratchet: auto-apply only toward more restrictive; everything else needs the owner. Shadow replay: offline re-planning of recorded runs with a candidate lesson applied.
