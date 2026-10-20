# STATUS (update at the end of every task; agents load this each session)

Last updated: 2026-10-20 by Dev A. A-04 merged (`7039146`); A-07 merged (`c7000f0`). D-030/D-031/D-032 closed on the contract side. B-01..B-07, B-09, B-10, B-11 done; B-12 Part 1 done; B-08 unblocked by A-07; Part 8 submission package done (`3adcbe1`, `a612d22` on `main`).
- **A-04 PR #1**: merged at `7039146`; checks #1–#16, effects, `liquidReserveUsd8`, `ActionExecuted`, the SWAP role probe (D-032), the reserve token in the #11 price set (D-031), and missing-price → `StalePrice`; `forge test` = 125 passed at merge.
- **A-07 local deploy**: fresh anvil + `scripts/deploy.sh` → `deployments/31337.json` (vault `0x0165...`, block 7), `eval/fixtures/base.json` (fresh `updatedAt` per price including mUSDC, `blockTimestamp`, `timestampUnit: "seconds"`, reserve + lockedToken, both positions, post-shock prices), and 5 ABIs in `packages/core/src/abi/`; `cast call` confirms pool 0 1e18/1400e6, pool 1 2e18/2800e6, reserve 400e6. `forge test` = 128 passed (3 new `seedPosition` tests).
- **Mirror updated for the PR**: `PolicyContext` gains `reserveToken`, `lendingSim`, `swapTarget`; wrong-role targets and the reserve price are now enforced in `packages/core/src/policy.ts` (D-030, D-031); 88 core tests green, all workspaces green (235 tests). Reply: `docs/reviews/A04-PR1-REVIEW.md`; Dev A asks: `docs/reviews/MESSAGE-TO-DEV-A.md`. Pending on the mirror side: move the SWAP role check from after #15 to after #9 (D-032).
- B-11 (`99ecd55`): one Vite/React page served by the API — compile/clarify/sign, plan, live state, ledger, audit, demo-only scenario lab, 390px layout; 5 web tests; browser click-through observed run→2 actions→ledger, stale-oracle halt and budget-exhausted halt; screenshots in `docs/submission/screenshots/`.
- B-12 Part 1 (`4c4da28`, summary `eval/results/2026-10-20T09-44-04-427Z/summary.md`): realized-loss mean B−A −$13.9234, win/tie/loss 118/158/224, bootstrap 95% CI [−$17.6227, −$10.3966]; B loses some cases because A may choose partial-target amounts outside B's discrete candidates — no per-case dominance claim.
- Part 8: root `README.md` (setup in 8 commands), `docs/submission/TECH-DOC.md`, `SECURITY-SELF-ASSESSMENT.md`, `EXECUTION-EVIDENCE.md`, `DECK-OUTLINE.md` (≤10 min, source per slide), `REGISTRATION-EMAIL.md`; `scripts/check-secrets.sh` clean and `scripts/verify-all.sh` GREEN (98 Forge + 83 core + 36 agent + 5 web + 6 eval = 228 tests, 7 scenarios × 1 run).
- B-08 and B-12 Part 2 now have the A-07 artifacts; B-12 Part 2 still needs A-09's chain runner. A-04 is merged (`7039146`). D-025/D-029 recorded; D-026..D-028 confirmed.

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
| A-01 | Dev A | P0 | done | b6b5a7f | Foundry scaffold, MockERC20 + MockOracle, 7 tests |
| A-02 | Dev A | P0 | done | f1d41c1 | LendingSim; HF 0.942857/1.051429, 11 tests |
| A-03 | Dev A | P0 | done | a7893aa | MockSwap; 30 bps fee, slippage, setBroken, 5 tests |
| A-04 | Dev A | P0 | done | #1 / 7039146 | Auth/pause/withdraw; EIP-712 mandate; checks #1–#16; effects + `ActionExecuted`; D-030/D-031/D-032 role + reserve-price parity; 125 Forge tests at merge |
| A-05 | Dev A | P0 | todo | | |
| A-06 | Dev A | P0 | todo | | |
| A-07 | Dev A | P0 | done | #2 / c7000f0 | `Deploy.s.sol` + `scripts/deploy.sh`; `deployments/31337.json`, `eval/fixtures/base.json`, 5 ABIs; fresh-anvil evidence; 128 Forge tests |
| A-08 | Dev A | P0 | todo | | |
| A-09 | Dev A | P0 | todo | | |
| A-10 | Dev A | P0 | todo | | |
| A-11 | Dev A | P1 | todo | | |
| A-12 | Dev A | P1 | todo | | |
| A-13 | Dev A | P0 | todo | | |
| B-01 | Dev B | P0 | done | 759a7cc | workspace scaffold; `pnpm -r typecheck`, `pnpm -r test`, verify-all green |
| B-02 | Dev B | P0 | done | b499d92 | strict types/schemas; 10 tests pass, typecheck green |
| B-03 | Dev B | P0 | done | d82f8dd | 6/18-dec valuation, HF pinned 0.942857/1.051429; 18 tests green |
| B-04 | Dev B | P0 | done | 250462e | pinned 86.57/163.59, 250.16 spend, 16.417875 loss, baseline 64.00; 11 optimizer tests |
| B-05 | Dev B | P0 | done | 9284979 | ordered #1-#15 + pure #16; 21 policy tests, D-023 set; D-025 |
| B-06 | Dev B | P0 | done | 43282e9 | 31 new tests: atomic rollback, UNKNOWN no-resubmit, event ledger, audit chain, redactor, state machines; 81 total |
| B-07 | Dev B | P0 | done | 81837e6 | `LlmClient`, typed live stub, `ScriptedLlm`, normalizer, clarifications, sanitizer/tripwire; m01–m12 zero dangerous widening; 16 tests green |
| B-08 | Dev B | P0 | blocked | | A-07 missing: `deployments/<chainId>.json`, `packages/core/src/abi/`, `eval/fixtures/base.json`, `Deploy.s.sol`; skipped without inventing an adapter |
| B-09 | Dev B | P0 | done | d8b0701 | fixed tool set + orchestrator; S1–S5/S7/S9 green with `ScriptedLlm` on `MockChainPort` (SIMULATED); 12 tests; verify-all GREEN |
| B-10 | Dev B | P0 | done | 81c5794 | Fastify API + SSE + zod + demo gating + 429 + static serving + demo signing; 8 contract tests; verify-all GREEN |
| B-11 | Dev B | P0 | done | 99ecd55 | Vite/React console served with the API: compile/sign/run/SSE/audit/scenario lab; 5 web tests; 1440px + 390px browser check; all labels SIMULATED |
| B-12 | Dev B | P0 | partial | 4c4da28 | Part 1: 500 seeded SIMULATED cases, 6 eval tests, generated summary; Part 2 blocked on A-07/A-09, `--part all` fails closed |
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
- solc 0.8.24 (`contracts/foundry.toml`)
- forge-std v1.17.0 (`f3dae6e`, `contracts/foundry.lock`)
- OpenZeppelin v5.0.2 (`dbb6104`, `contracts/foundry.lock`)

## Spec notes for Dev B (2026-10-20)
- **EIP-712:** arrays use standard encoding (each address padded to 32 bytes, concatenated, `keccak256`), not `abi.encodePacked(address[])`. `SET_MANDATE_TYPEHASH` is the full EIP-712 `encodeType` hash, including the referenced `Mandate` type string. viem's `hashTypedData` already does both; `INTERFACES.md` §8 types are unchanged.
- **Events:** vault pause events are `VaultPaused` / `VaultUnpaused`; the error remains `Paused` (D-022). Update any ABI/event usage accordingly.
- **Pools:** `MandateVault` reads `LendingSim.pools(uint8)` for the collateral/debt tokens (checks #11 and #16). `CONTRACTS.md` §2.3 will document that public getter; `PolicyContext.pools` already carries exactly `{ collateralToken, debtToken }` per pool.
- **Wrong-role target (D-030/D-032):** on chain, a lending action at an allowed target that is not `LendingSim` maps the failed `pools()` read (start of #11) to `TargetNotAllowed`; a SWAP at a target that answers `pools()` is rejected immediately after #9. The mirror already names both; move its SWAP check from after #15 to after #9 to match the vault's precedence. `PolicyContext.lendingSim`/`swapTarget` carry the roles.
- **Missing price (D-032):** the vault maps a missing oracle price in the #11 price set (including the reserve token) to `StalePrice`; it no longer leaks `MockOracle.UnknownToken`.

## Blockers
- A-07 is merged (`c7000f0`); B-08 can read `deployments/31337.json`, `packages/core/src/abi/` and `eval/fixtures/base.json`. B-12 Part 2 still needs A-09's chain runner. See `docs/reviews/DEV-A-sync.md` and `docs/reviews/MESSAGE-TO-DEV-A.md`.
- A-04 is merged on `main` (`7039146`) with D-030/D-031/D-032 (SWAP role after #9, reserve token in #11, missing price → `StalePrice`). The mirror still places the SWAP role check after #15; it must move to after #9. B-15 proves the two sides agree.
- B-12 Part 2 (anvil configs A–D) is blocked on the A-09 chain runner; the A-07 fixture/ABIs are present. Part 1 is independent and generated.

## Decisions needed from human
See `docs/DECISIONS.md` rows with OPEN/VERIFY (D-003, D-006, D-013, D-016, D-020, D-021). D-018 is superseded by D-027.
