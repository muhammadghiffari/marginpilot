# STATUS (update at the end of every task; agents load this each session)

Last updated: 2026-10-20 (handover package) by owner. No task has been started; the repo contains design, specs and tooling only.

## Milestones
- [ ] M0 Setup done (both machines pass `scripts/preflight.sh`; repo pushed; keys funded) — Owner
- [ ] M1 Foundations: contracts compile + core types/optimizer tests green; `MockChainPort` ready
- [ ] M2 End-to-end on anvil: S1 + S7 automated, agent drives vault via `ViemChainPort`
- [ ] M3 Testnet: deployed, S1/S2/S7 (+S3/S4) with real tx hashes in `evidence/`
- [ ] M4 Eval + docs: `pnpm eval:run` results, security self-assessment, tech doc filled
- [ ] M5 Public URL live, final verification, submitted

## Task board (ids and deliverables in tasks/*.md; states: todo / doing / blocked / done)
| Task | Owner | Pri | State | PR/commit | Notes |
|---|---|---|---|---|---|
| A-01 | Dev A | P0 | todo | | |
| A-02 | Dev A | P0 | todo | | |
| A-03 | Dev A | P0 | todo | | |
| A-04 | Dev A | P0 | todo | | |
| A-05 | Dev A | P0 | todo | | |
| A-06 | Dev A | P0 | todo | | |
| A-07 | Dev A | P0 | todo | | |
| A-08 | Dev A | P0 | todo | | |
| A-09 | Dev A | P0 | todo | | |
| A-10 | Dev A | P0 | todo | | |
| A-11 | Dev A | P1 | todo | | |
| A-12 | Dev A | P1 | todo | | |
| A-13 | Dev A | P0 | todo | | |
| B-01 | Dev B | P0 | done | 5c1a119 | workspace scaffold; `pnpm -r typecheck`, `pnpm -r test`, verify-all green |
| B-02 | Dev B | P0 | done | 16f58e7 | strict types/schemas; 10 tests pass, typecheck green |
| B-03 | Dev B | P0 | done | f088ad7 | 6/18-dec valuation, HF pinned 0.942857/1.051429; 18 tests green |
| B-04 | Dev B | P0 | done | 8b7327c | pinned 86.57/163.59, 250.16 spend, 16.417875 loss, baseline 64.00; 11 optimizer tests |
| B-05 | Dev B | P0 | done | a00581b | ordered #1-#15 + pure #16; 21 policy tests, D-023 set; D-025 |
| B-06 | Dev B | P0 | done | 43282e9 | 15 new tests: atomic rollback, UNKNOWN no-resubmit, event ledger, audit chain, redactor, state machines; 81 total |
| B-07 | Dev B | P0 | todo | | |
| B-08 | Dev B | P0 | todo | | |
| B-09 | Dev B | P0 | todo | | |
| B-10 | Dev B | P0 | todo | | |
| B-11 | Dev B | P0 | todo | | |
| B-12 | Dev B | P0 | todo | | |
| B-13 | Dev B | P1 | todo | | |
| B-14 | Dev B | P1 | todo | | |
| B-15 | Dev B | P1 | todo | | |
| B-16 | Dev B | P1 | todo | | |
| B-17 | Dev B | P2 | todo | | |
| I-1 | both | - | todo | | |
| I-2 | both | - | todo | | |
| I-3 | both | - | todo | | |
| I-4 | both | - | todo | | |
| I-5 | both | - | todo | | |
| I-6 | both | - | todo | | |

## Pinned versions (fill when installed: forge-std, OpenZeppelin if used, solc, viem, zod, vitest, Fastify/Express, Vite)
(none yet)

## Blockers
(none)

## Decisions needed from human
See `docs/DECISIONS.md` rows with OPEN/VERIFY (D-003, D-006, D-013, D-016, D-018, D-020, D-021).
