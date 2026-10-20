# STATUS (update at the end of every task; agents load this each session)

Last updated: 2026-10-20 by Dev A. A-04 done on `a/A-04-vault` (sub-steps 1–4: auth/pause/withdraw, EIP-712 mandate, checks #1–#15, effects + #16; 97 vault tests, 120 Foundry tests total). Dev B: B-01..B-07 and B-09 done (83 core + 16 agent + 12 orchestrator tests); B-08 now only blocked on A-07; D-025/D-029 recorded; D-026..D-028 confirmed.

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
| A-04 | Dev A | P0 | done | a/A-04-vault | Sub-steps 1–4: auth/pause/withdraw; EIP-712 mandate; checks #1–#15; effects + #16. 97 vault tests |
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
| B-08 | Dev B | P0 | todo | | |
| B-09 | Dev B | P0 | done | d8b0701 | fixed tool set + orchestrator; S1–S5/S7/S9 green with `ScriptedLlm` on `MockChainPort` (SIMULATED); 12 tests; verify-all GREEN |
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
- solc 0.8.24 (`contracts/foundry.toml`)
- forge-std v1.17.0 (`f3dae6e`, `contracts/foundry.lock`)
- OpenZeppelin v5.0.2 (`dbb6104`, `contracts/foundry.lock`)

## Spec notes for Dev B (2026-10-20)
- **EIP-712:** arrays use standard encoding (each address padded to 32 bytes, concatenated, `keccak256`), not `abi.encodePacked(address[])`. `SET_MANDATE_TYPEHASH` is the full EIP-712 `encodeType` hash, including the referenced `Mandate` type string. viem's `hashTypedData` already does both; `INTERFACES.md` §8 types are unchanged.
- **Events:** vault pause events are `VaultPaused` / `VaultUnpaused`; the error remains `Paused` (D-022). Update any ABI/event usage accordingly.
- **Pools:** `MandateVault` reads `LendingSim.pools(uint8)` for the collateral/debt tokens (checks #11 and #16). `CONTRACTS.md` §2.3 now documents that public getter; `PolicyContext.pools` already carries exactly `{ collateralToken, debtToken }` per pool. The vault ABI is unchanged.
- **Wrong-role target:** a lending action at an allowed target that is not `LendingSim` maps the failed `pools()` read to `TargetNotAllowed` (implemented in A-04.4). `PolicyContext` has no `lendingSim`/`swapTarget`, so the TS mirror cannot yet detect this; see `docs/reviews/D-025-dev-a-reply.md` §e.
- **#16 BORROW consequence:** a BORROW that changes debt lowers HF, so it always reverts `PostConditionFailed`; the `allowBorrow` bit is effectively unusable in P0. The TS `checkPostConditions` has the same rule.

## Blockers
- B-08 is unblocked on A-04.4 (`a/A-04-vault`: effects, #16, `liquidReserveUsd8`, `ActionExecuted`); it is blocked only on A-07 (`Deploy.s.sol`, `scripts/deploy.sh`, `deployments/<chainId>.json`, `packages/core/src/abi/`, `eval/fixtures/base.json`). See `docs/reviews/DEV-A-sync.md` and `docs/reviews/MESSAGE-TO-DEV-A.md`.

## Decisions needed from human
See `docs/DECISIONS.md` rows with OPEN/VERIFY (D-003, D-006, D-013, D-016, D-020, D-021). D-018 is superseded by D-027.
