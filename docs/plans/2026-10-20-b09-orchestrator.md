# B-09 orchestrator implementation plan

> Execute inline. TDD with `ScriptedLlm`; all scenarios use `MockChainPort` and are SIMULATED.

**Goal:** a fixed-tool rescue loop that turns a `Plan` into gated submissions, replans safely, halts on stale/unsafe state, and reports honestly.

**Architecture:** `RescueOrchestrator` owns the run state, plan binding, plan-age/price-drift guards, ledger and audit. `tools.ts` is the closed tool set (no mandate/free-form tool). `explain.ts` is template-only from `RationaleFacts`. `MockChainPort` gets a small consistency fix so `PositionSnapshot.healthFactor` reflects effects and demo price changes.

## Files

- Create `apps/agent/src/tools.ts` — closed tool names/definitions and per-tool zod args.
- Create `apps/agent/src/explain.ts` — `explainPlan(plan, mandate, vault)`.
- Create `apps/agent/src/orchestrator.ts` — `RescueOrchestrator.run()`, tool dispatch, guards, ledger/audit/report.
- Create `apps/agent/test/orchestrator.test.ts` — S1, S2, S3, S4, S5, S7, S9, T15, plan age/binding, unknown reconcile, max tool calls, kill switch.
- Modify `packages/core/src/mock-chain-port.ts` — update `healthFactor` after effects and `demoSetPrice`.
- Modify `packages/core/test/mock-chain.test.ts` — assert updated health fields.
- Modify `apps/agent/src/llm/scripted.ts` — allow dynamic tool-call arguments for tests (deterministic given history).
- Modify `STATUS.md`, `tasks/DEV-B.md`.

## Tasks

1. [ ] Write the scenario tests and fixture helpers (base state from SCENARIOS), expecting missing modules.
2. [ ] Implement `explain.ts` and `tools.ts`; test tool allow-list and template output.
3. [ ] Implement orchestrator core: observe, plan, execute, finish; S1/S2 green.
4. [ ] Add guards: plan id/index/nonce, plan age, price drift → replan, simulate rejection → halt, unknown reconcile, max tool calls, kill switch. S3/S4/S5/S9 + guard tests green.
5. [ ] Add S7/T15 direct-key MockChainPort tests; no SWAP in D; permissive C is documented as the weaker wiring.
6. [ ] Run `pnpm -r test`, `pnpm -r typecheck`, `scripts/verify-all.sh`; update docs/STATUS; commit; push.
