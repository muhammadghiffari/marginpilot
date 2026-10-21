# STATUS (update at the end of every task; agents load this each session)

Last updated: 2026-10-21 by the audit agent. The real-EVM path is implemented and green on local
anvil; the default demo remains SIMULATED. **Public-testnet broadcast is the remaining external
blocker**: `.env` still points at local anvil and no funded public-testnet account/RPC is configured.
- **Real chain adapter (2026-10-21):** `apps/agent/src/chain/viem-port.ts` implements reads,
  simulate-before-submit, receipt handling, unknown-tx reconciliation, owner/executor writes and
  custom-error decoding. `AgentRuntime` serves both modes; `CHAIN_MODE=simulated|anvil|testnet|chain`
  is explicit (no silent fallback). Owner signing supports a server key that must match the
  deployment owner, or a browser-wallet EIP-712 prepare/verify/relay flow.
- **Local-anvil E2E GREEN:** `bash scripts/e2e-anvil.sh` on a throwaway chain 31338 deployed the
  simulator, refreshed prices, installed mandate #1, ran the two-repay rescue and mined both actions.
  Evidence: `evidence/anvil-e2e-20261021T060254Z.json` (mandate
  `0x62dcec…0b8ad`, actions `0x85136a…d8366` and `0x82088d…f5225`). This is REAL EVM on anvil,
  **not public testnet**; the UI labels it `ANVIL`.
- **Current gate:** `scripts/verify-all.sh` GREEN = 128 Forge + 89 core + 74 agent + 5 web + 8 eval =
  **304 tests**; `check-secrets: clean`; `pnpm -r typecheck` green (2026-10-21).
- **Public testnet (A-10) still not run.** `scripts/deploy-testnet.sh` and
  `scripts/start-testnet.sh` are ready and refuse well-known mainnet/local chain ids, key material on
  the command line, owner = executor, and contract accounts. They need the human's funded testnet RPC/keys and presence.
- **Earlier validation (2026-10-20):** Part 2 remains SIMULATED (`MockChainPort`, D-034);
  D-036 LLM client is mock-tested only; the web console was verified at 1440px/390px; A-04/A-07 are
  merged (`7039146`/`c7000f0`); push credentials are still missing.

## Milestones
- [ ] M0 Setup done (both machines pass `scripts/preflight.sh`; repo pushed; keys funded) — Owner; push still blocked
- [x] M1 Foundations: contracts compile + core types/optimizer tests green; `MockChainPort` ready
- [x] M2 End-to-end on anvil: S1 + S7 automated, agent drives vault via `ViemChainPort` (2026-10-21)
- [ ] M3 Testnet: deployed, S1/S2/S7 (+S3/S4) with real tx hashes in `evidence/` — blocked on human RPC/funding
- [ ] M4 Eval + docs: `pnpm eval:run` results, security self-assessment, tech doc filled — eval done; public-testnet evidence pending
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
| B-08 | Dev B | P0 | done | 5f61240 + 8fcbb0d | `ViemChainPort` in `apps/agent/src/chain/viem-port.ts`; explicit `CHAIN_MODE`, owner-key + browser-wallet signing, receipt/unknown handling; local-anvil E2E green (`evidence/anvil-e2e-20261021T060254Z.json`). Public testnet remains A-10 (human). |
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
- **Public-testnet broadcast (A-10) is blocked on external inputs:** `.env` still has
  `CHAIN_ID=31337`/local anvil RPC, no funded public-testnet owner/executor is confirmed, and the
  `mp-owner` Foundry keystore password is unknown. Needed from the human: a public testnet chain id +
  RPC, a funded `SENDER` EOA, public `OWNER_ADDRESS`/`EXECUTOR_ADDRESS`, a keystore/hardware signer
  (or its password entered interactively), and explicit go-ahead with the human present.
- **Push still needs the human's terminal:** agent-side git has no cached credential
  (`could not read Username for 'https://github.com'` with `GIT_TERMINAL_PROMPT=0`); no credential
  may be pasted to an agent. Local work is committed in small commits; push remains the human's.
- **A-09 was cut** (D-034): Part 2 numbers remain SIMULATED on `MockChainPort`. The local-anvil E2E
  is separate real-EVM proof; it does not turn Part 2 into on-chain results.
- **A-13 (public URL)** is human-run and not done.

## Decisions needed from human
See `docs/DECISIONS.md` rows with OPEN/VERIFY (D-003, D-013, D-020, D-021). D-006 and D-016 are superseded by D-036/D-035; D-018 is superseded by D-027.
