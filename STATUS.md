# STATUS (update at the end of every task; agents load this each session)

Last updated: 2026-10-20 21:40 WIB by Dev B. PR #1 and PR #2 merged; mirror mirrors D-032; Part 2 (SIMULATED) and the OpenAI-compatible LLM client are in; both branches verified and a fresh-clone gate is green. **Only the human push and the A-10/A-13 items remain.**
- **Final local state (21:40 WIB):** `feat/dev-b-foundations` and `main` are both at `ee8c840` plus this STATUS-only commit; **origin/main = `c7000f0`, origin/feat = `6e81935`**. Agent pushes fail with `could not read Username` (empty cache, `GIT_TERMINAL_PROMPT=0`), so the human must push both branches. No force push was used.
- **Fresh-clone gate GREEN:** `git clone /home/catalna/marginpilot /home/catalna/mp-fresh-gate` @ `ee8c840` (re-run after the D-036 audit commit; the earlier `0b8ecf6` gate was also green) → `pnpm install --frozen-lockfile` → `scripts/verify-all.sh` = 128 Forge + 89 core + 42 agent + 5 web + 8 eval = **272 tests**, `check-secrets: clean` (21:38 WIB).
- **A-04 PR #1 merged** (`7039146` + `b01a970`): checks #1–#16, effects, `liquidReserveUsd8`, `ActionExecuted`, SWAP role probe at #9b (D-032), reserve token in the #11 price set (D-031), missing price → `StalePrice`; 125 Forge tests (`b01a970`).
- **A-07 PR #2 merged** (`c7000f0`, branch `a/A-07-deploy`): fresh anvil + `scripts/deploy.sh` → `deployments/31337.json` (vault `0x0165...`, block 7), `eval/fixtures/base.json` (fresh `updatedAt` per price incl. mUSDC, `blockTimestamp`, `timestampUnit: "seconds"`, reserve + lockedToken, both positions, post-shock prices), 5 ABIs in `packages/core/src/abi/`; `forge test` = 128 passed (3 new `seedPosition` tests).
- **B-12 Part 2 done (SIMULATED)** (`eval/results/2026-10-20T14-11-32-655Z/summary.md`): configs A–D × S1–S5/S7/S9/T15 = 28 runs on `MockChainPort` with `ScriptedLlm`; config **D: 0 hard-constraint violations and 7/7 acceptance passes**; 12 violations across 7 of 28 runs, all in the deliberately weak A/C configs (budget, stale-price, direct-SWAP); 4 false completions (C), 0 duplicates. No anvil and no on-chain hashes (D-034).
- **D-036 LLM client**: `OpenAICompatLlm` (tools → JSON-schema retry, primary→fallback, temperature 0, key never logged) and a hash-chained `llm.response` audit entry (`model`, `temperature`, `usage`, `toolCalls`; no prompts or keys), tested against a local mock HTTP server only; `ScriptedLlm` remains the CI and demo default. **No live model call was made.**
- **Mirror synced to D-032** (`packages/core/src/policy.ts`): SWAP-role check at #9b, lending-role after #10, reserve token priced for every action; ordering tests assert the precedence both ways. Thread: `docs/reviews/A04-PR1-REVIEW.md`, `docs/reviews/MESSAGE-TO-DEV-A.md`, D-030/D-031/D-032.
- Gates: `scripts/verify-all.sh` GREEN = 128 Forge + 89 core + 42 agent + 5 web + 8 eval = **272 tests**; `check-secrets: clean`.

- B-11 (`99ecd55`): one Vite/React page served by the API — compile/clarify/sign, plan, live state, ledger, audit, demo-only scenario lab, 390px layout; 5 web tests; browser click-through observed run→2 actions→ledger, stale-oracle halt and budget-exhausted halt; screenshots in `docs/submission/screenshots/`.
- B-12 Part 1 (`4c4da28`, summary `eval/results/2026-10-20T09-44-04-427Z/summary.md`): realized-loss mean B−A −$13.9234, win/tie/loss 118/158/224, bootstrap 95% CI [−$17.6227, −$10.3966]; B loses some cases because A may choose partial-target amounts outside B's discrete candidates — no per-case dominance claim.
- Part 8: root `README.md` (setup in 8 commands), `docs/submission/TECH-DOC.md`, `SECURITY-SELF-ASSESSMENT.md`, `EXECUTION-EVIDENCE.md`, `DECK-OUTLINE.md` (≤10 min, source per slide), `REGISTRATION-EMAIL.md`; `scripts/check-secrets.sh` clean. Current gate after PR #1/#2 + B-12 Part 2: `scripts/verify-all.sh` GREEN (128 Forge + 89 core + 42 agent + 5 web + 8 eval = 272 tests; 28 SIMULATED Part 2 runs).
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
| A-04 | Dev A | P0 | done | #1 `7039146` + `b01a970` | Auth/pause/withdraw; EIP-712 mandate; checks #1–#16; effects + `ActionExecuted`; D-030/D-031/D-032 role + reserve-price parity; 125 Forge tests |
| A-05 | Dev A | P0 | todo | | |
| A-06 | Dev A | P0 | todo | | |
| A-07 | Dev A | P0 | done | #2 `c7000f0` | `Deploy.s.sol` + `scripts/deploy.sh`; `deployments/31337.json`, `eval/fixtures/base.json`, 5 ABIs; 128 Forge tests |
| A-08 | Dev A | P0 | todo | | |
| A-09 | Dev A | P0 | cut | D-034 | anvil runner + liquidator bot cut to protect the deadline; Part 2 runs SIMULATED on `MockChainPort` |
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
| B-08 | Dev B | P0 | deferred | — | A-07 artifacts are present (`deployments/31337.json`, `packages/core/src/abi/`, `eval/fixtures/base.json`, `Deploy.s.sol`, `scripts/deploy.sh`), but `ViemChainPort` was time-boxed out before the 22:00 freeze; no adapter was invented. Remaining downstream: A-10 testnet deploy (human) and A-13 URL. |
| B-09 | Dev B | P0 | done | d8b0701 | fixed tool set + orchestrator; S1–S5/S7/S9 green with `ScriptedLlm` on `MockChainPort` (SIMULATED); 12 tests; verify-all GREEN |
| B-10 | Dev B | P0 | done | 81c5794 | Fastify API + SSE + zod + demo gating + 429 + static serving + demo signing; 8 contract tests; verify-all GREEN |
| B-11 | Dev B | P0 | done | 99ecd55 | Vite/React console served with the API: compile/sign/run/SSE/audit/scenario lab; 5 web tests; 1440px + 390px browser check; all labels SIMULATED |
| B-12 | Dev B | P0 | done | 4c4da28 + Part 2 | Part 1: 500 seeded SIMULATED cases + generated summary. Part 2 (`eval/results/2026-10-20T14-11-32-655Z/`): 28 SIMULATED runs (A–D × S1–S5/S7/S9/T15); D 0 violations 7/7 acceptance; 8 eval tests |
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
- **Push still needs the human's terminal (21:40 WIB)**: agent-side git processes have no cached credential (`fatal: could not read Username for 'https://github.com'` with `GIT_TERMINAL_PROMPT=0`), so both pushes were attempted and failed. **Local `feat/dev-b-foundations` = local `main` = `ee8c840` + STATUS-only commit; push both.** No credential may be pasted to an agent; the earlier exposed token must stay revoked. Push range to publish: `origin/main c7000f0..<local main>` and `origin/feat 6e81935..<local feat>`.
- **B-08 deferred, not blocked on missing files**: A-07 is merged (`c7000f0`) with `deployments/31337.json`, `packages/core/src/abi/*`, `eval/fixtures/base.json`, `contracts/script/Deploy.s.sol`, `scripts/deploy.sh`. `ViemChainPort` was time-boxed out before the 22:00 freeze (freeze rule), so the demo still uses `MockChainPort`; no adapter was invented. Downstream remains A-10 (testnet deploy, human present) and A-13 (public URL).
- **A-09 is cut** (D-034): Part 2 numbers are SIMULATED on `MockChainPort`; on-chain evidence can only come from the testnet run (TODO(human)/TODO(Dev A) in `docs/submission/EXECUTION-EVIDENCE.md`).
- **A-10/A-13** are human/Dev A items: testnet deploy with real tx hashes and the public URL. Nothing on the Dev B side can produce real hashes.

## Decisions needed from human
See `docs/DECISIONS.md` rows with OPEN/VERIFY (D-003, D-013, D-020, D-021). D-006 and D-016 are superseded by D-036/D-035; D-018 is superseded by D-027.
