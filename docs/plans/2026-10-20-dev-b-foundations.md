# Dev B Foundations Implementation Plan

> **For agentic workers:** Use executing-plans to implement this plan task-by-task with TDD.

**Goal:** Deliver B-01 through B-06 against the approved specs and D-025.

**Architecture:** Pure bigint core math, exhaustive planner, ordered policy checks and an atomic simulated chain adapter. Strict schemas protect transport boundaries. Agent/web receive scaffold only.

**Tech Stack:** Node 22, pnpm, TypeScript strict, Vitest, Zod, viem.

Short plan format follows AGENTS.md. Each task: red tests → implementation → focused green → `bash scripts/verify-all.sh` → update STATUS/task evidence → separate commit. No deployment or live LLM calls.

## B-01 — workspace
- [ ] Create root `package.json`, `pnpm-workspace.yaml`, `tsconfig.base.json`, `vitest.config.ts`; package manifests/tsconfigs and `src/index.ts` in `packages/core`, `apps/agent`, `apps/web`.
- [ ] Test workspace scripts/package resolution in `packages/core/test/workspace.test.ts`; run `pnpm -r test` / `pnpm -r typecheck`. `eval:run` initially runs the honest Python reference; full harness is B-12.

## B-02 — typed boundaries
- [ ] Create `packages/core/src/types.ts`, `schemas.ts`; test `test/schemas.test.ts` for nested bigint round-trips, invalid addresses/uints/actions, strict field rejection.
- [ ] Preserve INTERFACES types and unchanged ErrorName union; JSON encodes bigint as decimal strings, never JSON numbers.

## B-03 — valuation/health
- [ ] Create `src/valuation.ts`, `src/health.ts`, `test/math.test.ts`. Cover 6/18 decimals, spend ceil, debt-zero max uint256, invalid inputs, pinned HF values.

## B-04 — optimizer
- [ ] Create `src/optimizer.ts`, `test/optimizer.test.ts`, `test/fixtures.ts` (explicit SIMULATED addresses).
- [ ] Pin Python/spec candidate levels, 86.57/163.59 repayments, 250.16 spend, exact bigint loss and baseline 64.00. Test shuffled determinism, cents-ceil, zero debt, budget exhaustion, nonces, remaining budget, independent seeded brute force.
- [ ] Run `python3 eval/worked_example.py` alongside focused Vitest.

## B-05 — ordered policy
- [ ] Create `src/policy.ts`, `test/policy.test.ts`; D-025 context and separate post-check. One negative/positive case per check #1–#16, precedence, pool freshness, decimals and cumulative budget.
- [ ] Reject unavailable metadata without guessing. Preserve shared error names.

## B-06 — simulated execution and records
- [ ] Create `src/chain-port.ts`, `mock-chain-port.ts`, `ledger.ts`, `state-machines.ts`, `audit.ts`, `redact.ts`; matching `test/*.test.ts`.
- [ ] Test tentative effects/rollback, simulate-before-submit, unknown reconciliation without resend, demo guards, event-derived spend/gas separation, legal state transitions/replan cap/owner-only halt exit, canonical hash integrity and redaction.

## Review and acceptance
- [ ] Review each major task against specs, run full verification and secret scan before committing. Record exact outputs and blockers in STATUS.md; tick task acceptance with evidence.
- [ ] Dev A note is `docs/reviews/D-025-dev-a.md`. GitHub CLI unavailable in WSL; do not claim remote PR publication.
