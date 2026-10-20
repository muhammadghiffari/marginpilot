# DEV-B — core + agent + web (Dev B)

Read first: `AGENTS.md`, `STATUS.md`, `docs/DECISIONS.md`, `docs/prd/PRD.md` §5-6, `docs/spec/REPO-MAP.md` (file-level map: which file, which task), `docs/spec/INTERFACES.md`, `docs/spec/OPTIMIZER.md`, `docs/spec/AGENT-DESIGN.md` (§1-§9; skip §7A, it is blocked), `docs/spec/SCENARIOS.md`, `docs/spec/UI-SPEC.md`, `docs/eval/EVALUATION-PLAN.md`.
You can start immediately: Node 22 + pnpm are enough. No chain needed until B-08; build against `MockChainPort`.

| Task | Priority | Needs | Deliverable | Acceptance |
|---|---|---|---|---|
| B-01 | P0 | - | pnpm workspace scaffold (`packages/core`, `apps/agent`, `apps/web`), tsconfig strict, vitest, root scripts (`test`, `typecheck`, `eval:run`) | [x] `pnpm -r test` and `typecheck` run; `scripts/verify-all.sh` picks them up (2026-10-20: 1 test passed; 3 projects typechecked; VERIFY-ALL GREEN) |
| B-02 | P0 | B-01 | `types.ts`, zod schemas, bigint (de)serialization, ErrorName | round-trip tests |
| B-03 | P0 | B-02 | `valuation.ts` + `health.ts` (usd8, decimals, HF wad) | 6-dec vs 18-dec tests; HF values 0.942857 / 1.051429 |
| B-04 | P0 | B-03 | `optimizer.ts` per OPTIMIZER.md | pinned fixture (86.57 / 163.59 / ≈16.4179; local baseline 64.00), determinism, brute-force cross-check |
| B-05 | P0 | B-03 | `policy.ts` mirror with exact check order | unit test per check; same error names |
| B-06 | P0 | B-02, B-05 | `MockChainPort` (same math/checks as contracts) + ledger + state machines + hash-chained audit + redactor | all unit tested |
| B-07 | P0 | B-02 | LLM layer: `LlmClient`, provider impl, `ScriptedLlm`; `compile_mandate` with normalizer and clarification logic | seed prompts m01–m12: no dangerous widening; ambiguous ⇒ clarification (scripted + live) |
| B-08 | P0 | A-07, B-06 | `ViemChainPort` against Dev A's ABIs/deployments; submit = simulate first, reconcile unknown | integration against anvil: S1 happy path |
| B-09 | P0 | B-04..B-07 (anvil acceptance also A-09, B-08) | Orchestrator: tool set (incl. `explain_plan` as template-only text from `RationaleFacts`; the LLM paraphrase and grounding check come in B-13), run loop, plan binding, replan (remaining budget), halt, kill switch | S1–S5, S7, S9 pass automatically on anvil with `ScriptedLlm` |
| B-10 | P0 | B-09 | API server (INTERFACES §10), SSE, demo endpoints, rate limits, serves `apps/web/dist` | contract tests for endpoints; 429 on burst |
| B-11 | P0 | B-10 | Web UI per UI-SPEC (chat, mandate card + sign, plan, state, ledger, txs, scenario lab) | demo script runs end-to-end by clicking; mobile 390px usable |
| B-12 | P0 | B-04, B-09, A-09 | Eval harness: Part 1 simulation, Part 2 runner (configs A–D), report writer | `pnpm eval:run -- --part all --seed 1` writes results.json + summary.md |
| B-13 | P1 | B-09 | Grounding check for explanations | ungrounded number ⇒ fallback + audit entry |
| B-14 | P1 | B-07, B-09 | Part 3 eval (NL compile ≥30 prompts, explanation rubric, injection) + session memory (T12) | results in summary |
| B-15 | P1 | B-06, A-08, A-12 | Differential test policy vs chain (FR-16); wallet-mode signing in UI | ≥500 cases agree; MetaMask flow works |
| B-16 | P1 | B-12 | Repeated-run study (k=5) for LLM configs | pass^k reported |
| B-17 | P2 | B-09 | MCP wrapper for read tools | — |

Not in this list on purpose: FR-20 defensive learning (PRD §6, AGENT-DESIGN §7A, S10, eval Part 4) and any "multi-agent" work. They stay blocked until the owner marks D-020 / D-021 `DECIDED` in `docs/DECISIONS.md`; then add the tasks through a PR to this file. Do not start them earlier.

`Needs` = tasks whose deliverable this one builds on (derived from the deliverables). If a needed task is not done, take the next unblocked task (AGENTS.md, "When blocked"). `eval/fixtures/base.json` is created by Dev A in A-07; until then use the numbers in `docs/spec/SCENARIOS.md` and `docs/spec/OPTIMIZER.md` §6.

Rules: LLM provider details stay behind `LlmClient`; UI renders numbers from structured payloads only; never log secrets; every endpoint validates with zod. Keep demo-only endpoints behind `DEMO_MODE`.
