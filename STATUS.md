# STATUS (update at the end of every task; agents load this each session)

Last updated: 2026-10-20 19:55 WIB by Dev B. PR #1 merged into `main` with the D-032 probe commit; B-01..B-07, B-09, B-10, B-11 done; B-12 Part 1 done; B-08 blocked on A-07; Part 8 submission package done (`3adcbe1`, `a612d22` on `main`); mirror now mirrors D-032.
- **A-04 PR #1 merged** (`7039146`): checks #1–#16, effects, `liquidReserveUsd8`, `ActionExecuted`, the SWAP role probe at #9b (D-032), the reserve token in the #11 price set (D-031), missing price → `StalePrice`; `forge test` = 125 passed, 0 failed per Dev A (this worktree re-runs the full verify gate below).
- **Mirror synced to D-032** (`packages/core/src/policy.ts`): SWAP-role check at #9b (equality vs `ctx.lendingSim` + trusted `ctx.swapTarget`), lending-role after #10, reserve token priced for every action; ordering tests assert the precedence both ways. Reply thread: `docs/reviews/A04-PR1-REVIEW.md`, `docs/reviews/MESSAGE-TO-DEV-A.md`, D-030/D-031/D-032 in `docs/DECISIONS.md`.

- B-11 (`99ecd55`): one Vite/React page served by the API — compile/clarify/sign, plan, live state, ledger, audit, demo-only scenario lab, 390px layout; 5 web tests; browser click-through observed run→2 actions→ledger, stale-oracle halt and budget-exhausted halt; screenshots in `docs/submission/screenshots/`.
- B-12 Part 1 (`4c4da28`, summary `eval/results/2026-10-20T09-44-04-427Z/summary.md`): realized-loss mean B−A −$13.9234, win/tie/loss 118/158/224, bootstrap 95% CI [−$17.6227, −$10.3966]; B loses some cases because A may choose partial-target amounts outside B's discrete candidates — no per-case dominance claim.
- Part 8: root `README.md` (setup in 8 commands), `docs/submission/TECH-DOC.md`, `SECURITY-SELF-ASSESSMENT.md`, `EXECUTION-EVIDENCE.md`, `DECK-OUTLINE.md` (≤10 min, source per slide), `REGISTRATION-EMAIL.md`; `scripts/check-secrets.sh` clean and `scripts/verify-all.sh` GREEN (98 Forge + 83 core + 36 agent + 5 web + 6 eval = 228 tests, 7 scenarios × 1 run).
- B-12 Part 2 and B-08 blocked on A-07/A-09 artifacts; A-04.4 (`e1f90f3`, `dec5aae`) exists on `a/A-04-vault` but is not merged. D-025/D-029 recorded; D-026..D-028 confirmed.

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
| A-04 | Dev A | P0 | done | #1 / a/A-04-vault | Auth/pause/withdraw; EIP-712 mandate; checks #1–#16; effects + `ActionExecuted`; D-030/D-031/D-032 role + reserve-price parity; 125 Forge tests; PR pending merge |
| A-05 | Dev A | P0 | todo | | |
| A-06 | Dev A | P0 | todo | | |
| A-07 | Dev A | P0 | todo | | |
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
- **Push partially resolved (2026-10-20 20:31 WIB)**: the human re-authenticated in an interactive terminal and pushed `feat/dev-b-foundations` to `origin` (`b2182e4..6e81935`) — the agent's pushes still fail (`could not read Username`): the WSL credential cache is not served to agent processes, so **`push main` is the one remaining auth step** (`main` is locally fast-forwarded to `6e81935` and `verify-all` GREEN, 261 tests). Worktree-local merge is complete; the shared remote `main` still points at `7039146`. Never share or paste credentials to agents; the token exposed in chat earlier must be revoked. B-08 is blocked on A-07 (`Deploy.s.sol`, `scripts/deploy.sh`, `deployments/<chainId>.json`, `packages/core/src/abi/`, `eval/fixtures/base.json`) — the A-04.4 contract rules themselves are merged (PR #1 `7039146` + `b01a970`). See `docs/reviews/MESSAGE-TO-DEV-A.md`.
- B-08 remains blocked on A-07 (`Deploy.s.sol`, `scripts/deploy.sh`, `deployments/<chainId>.json`, `packages/core/src/abi/`, `eval/fixtures/base.json`) — the A-04.4 contract rules themselves are merged (PR #1 `7039146`). See `docs/reviews/MESSAGE-TO-DEV-A.md`.
- PR #1 is **merged into `main`** (with `b01a970`: SWAP role probe at #9b, reserve token in #11, missing price → `StalePrice`; 125 Forge tests per Dev A). The mirror carries the same rules at the same positions; the differential test (B-15) will prove the two sides agree once `ViemChainPort` exists (B-08).
- B-12 Part 2 (anvil configs A–D) is blocked on the same A-07 artifacts and A-09 chain runner; Part 1 is independent and generated.

## Decisions needed from human
See `docs/DECISIONS.md` rows with OPEN/VERIFY (D-003, D-006, D-013, D-016, D-020, D-021). D-018 is superseded by D-027.
