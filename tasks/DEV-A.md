# DEV-A — infra + contracts + chain (Dev A)

Read first: `AGENTS.md`, `STATUS.md`, `docs/DECISIONS.md` (D-022/D-023 changed the contract spec), `docs/prd/PRD.md` §5-6, `docs/spec/REPO-MAP.md` (file-level map: which file, which task), `docs/spec/CONTRACTS.md`, `docs/spec/INTERFACES.md` §4,8,9, `docs/security/ADVERSARIAL-TESTS.md`, `docs/spec/SCENARIOS.md`.
Use `forge install foundry-rs/forge-std` (requires git repo) and OpenZeppelin only if needed (`ECDSA`, `EIP712`, `ReentrancyGuard`); pin versions in `STATUS.md`.

| Task | Priority | Needs | Deliverable | Acceptance |
|---|---|---|---|---|
| A-01 | P0 | - | Foundry scaffold; `forge build` works; `MockERC20`, `MockOracle` + tests | tests for decimals, `setPriceAt`, unknown token |
| A-02 | P0 | A-01 | `LendingSim` (pools per CONTRACTS §2.3, events, pause) + tests | HF values for the shock state match `eval/worked_example.py` (0.942857 / 1.051429); liquidation bonus event math; paused pool reverts |
| A-03 | P0 | A-01 | `MockSwap` + tests | fee, slippage revert, `setBroken` |
| A-04 | P0 | A-02, A-03 | `MandateVault` core: owner/executor, pause, withdraw, mandate set (direct + EIP-712), `execute` with ordered checks #1–#16 | one test per check with exact custom error + a boundary-positive case; reentrancy guard; no raw calldata; approvals reset |
| A-05 | P0 | A-04 | Adversarial suite T01–T05b, T07, T09, T09b, T10, T11, T15(D side), T16 in Foundry | all pass; names map to IDs (`test_T01_...`) |
| A-06 | P0 | A-04 | Fuzz/invariant: spend monotonic, never > cap; nonce monotonic | invariant test passes |
| A-07 | P0 | A-04, B-01 | `Deploy.s.sol` + `scripts/deploy.sh` (local anvil first) writing `deployments/<chainId>.json`; ABI export to `packages/core/src/abi/`; **also creates `eval/fixtures/base.json`** (prices, positions, reserve, locked mWETH from `docs/spec/SCENARIOS.md` base state) that the deploy script seeds from and Dev B reads | `scripts/dev-anvil.sh` + deploy gives a ready demo state (base positions, reserve, locked mWETH) |
| A-08 | P0 | A-04, B-02 | **Pair with Dev B:** cross-language EIP-712 test (viem signs, vault verifies) | integration test green; typehash string equals INTERFACES §8 |
| A-09 | P0 | A-07, B-01 | Scenario scripts for anvil (`eval/chain/*.ts` or forge scripts): shock, stale, pool pause, liquidator bot using `liquidate` and summing `bonusUsd8` | S1–S5, S7, S9 setups reproducible with snapshot/revert |
| A-10 | P0 | A-07, A-09, B-09, B-10 | **Testnet deploy** (human present): fund keys, deploy, record in `deployments/`, run S1/S2/S7 (+S3/S4) with the real agent, capture hashes to `evidence/` | every hash resolves on the explorer; evidence rows generated, not typed |
| A-11 | P1 | A-10 | Source verification on explorer (`forge verify-contract`) | explorer shows verified source |
| A-12 | P1 | A-04, B-06 | Differential-test harness support (anvil side) for FR-16 | ≥500 cases agree |
| A-13 | P0 | B-10 | Host/deploy the single server (Dockerfile or provider config) with Dev B; env vars set; health check | public URL works from a phone |

`Needs` = tasks whose deliverable this one builds on (derived from the deliverables). If a needed task is not done, take the next unblocked task (AGENTS.md, "When blocked"). A-13 is P0 because FR-17 (public URL) is P0.

Rules: do not change error names or struct layouts without updating INTERFACES.md and telling Dev B. Export ABIs after each change. Gas/cost is irrelevant; clarity and tests matter.
