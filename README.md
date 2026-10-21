# MarginPilot

**Mandate-bound wallet agent for rescuing several at-risk lending positions under one owner-signed,
on-chain-enforced budget.** FinTechathon 2026, Topic F.

The agent proposes and executes only inside a mandate; the vault enforces the limits. The lending
market in this repository is **SIMULATED** (D-002). The agent can run against a **real EVM chain**
through `ViemChainPort`: a fresh local-anvil end-to-end run installs an owner-signed mandate and
mines two rescue actions
([`evidence/anvil-e2e-20261021T060254Z.json`](evidence/anvil-e2e-20261021T060254Z.json)). There is
still **no public-testnet deployment**, because that broadcast needs a funded public-testnet account
and RPC from the human. See
[Execution Evidence](docs/submission/EXECUTION-EVIDENCE.md).

## What works at this commit

| Area | State |
|---|---|
| Core policy, loss model, exhaustive planner, audit chain, ledger | Implemented, 89 tests |
| Deterministic `ScriptedLlm`, mandate compiler, clarification gate, prompt sanitizer | Implemented, agent suite 74 tests |
| Orchestrator: fixed tools, plan binding, replans on remaining budget, unknown-tx reconciliation, halt/kill switch | Implemented; S1–S5, S7, S9 on `MockChainPort`, plus local-anvil E2E |
| Fastify API + SSE + zod boundaries + always-on 429 limits + demo signing | Implemented, 9 API tests |
| Web console (instruction → mandate → plan → live state → ledger) | Implemented, 5 tests; verified at 1440px and 390px |
| Seeded Part 1 evaluation and generated report | Implemented, 500 cases |
| Part 2 ablation runner (configs A–D × S1–S5/S7/S9/T15) | Implemented on `MockChainPort`, **SIMULATED**; 8 eval tests |
| `ViemChainPort`: reads, simulate-before-submit, receipts, unknown reconciliation, owner/executor writes | Implemented; real local-anvil E2E (chain 31338) |
| Owner signing: server owner key and browser-wallet EIP-712 relay | Implemented; unit/API tested (no MetaMask extension run recorded) |
| OpenAI-compatible LLM client (tools, JSON-schema retry, primary→fallback) | Implemented, mock-HTTP tests only; **no live model call** (D-036) |
| Public testnet deployment and public URL | **Not run**: needs the human's funded testnet RPC/keys (A-10/A-13) |
| On-chain `execute` effects and post-condition check #16 | Merged (PR #1 `7039146`, PR #2 `c7000f0`); direct anvil receipts above |

## Quick start (setup in fewer than ten commands)

Prerequisites: Node 22, pnpm 10, Python 3, and (for contract tests) Foundry.

```bash
pnpm install
pnpm --filter @marginpilot/web build
CHAIN_MODE=simulated pnpm --filter @marginpilot/agent start   # SIMULATED, http://127.0.0.1:8787
pnpm -r test
pnpm -r typecheck
pnpm eval:run -- --part 1 --seed 1
pnpm eval:run -- --part 2 --seed 1
scripts/verify-all.sh
cd contracts && forge test
```

Open `http://127.0.0.1:8787`. The page is served by the API at one URL. The preloaded mandate is
SIMULATED; click **Run rescue** to watch observe → plan → simulate → two gated repays → refreshed
state and ledger. **Demo signing** needs `DEMO_OWNER_PRIVATE_KEY` in the environment (or `.env`);
without it the UI shows the configured error path and the preloaded mandate still runs. Never commit
a key.

### Real EVM path (local anvil, no public funds)

`scripts/e2e-anvil.sh` starts a throwaway anvil chain (31338), deploys and seeds the simulator,
installs an owner-signed mandate, runs the rescue, and writes real local-anvil receipts to
`evidence/`. It uses only anvil's public test keys and does not touch a public network.

```bash
bash scripts/e2e-anvil.sh
```

For an interactive UI on anvil, deploy on 31337 (`bash scripts/dev-anvil.sh` in one terminal,
`bash scripts/deploy.sh` in another), copy `.env.example` to `.env`, set
`CHAIN_MODE=anvil CHAIN_ID=31337 RPC_URL=http://127.0.0.1:8545`, and run
`bash scripts/start-testnet.sh anvil`. The UI badge is `ANVIL`.

### Public testnet (human-present, funded account)

This is **not run** in the repository. After filling `.env` with `CHAIN_MODE=testnet`, a public
testnet `CHAIN_ID`, `RPC_URL`, `EXPLORER_BASE_URL`, public `OWNER_ADDRESS`/`EXECUTOR_ADDRESS`, and a
funded `SENDER`:

```bash
# The signer is a Foundry keystore/hardware account; never --private-key.
EXTRA_FORGE_ARGS='--account <keystore-name>' bash scripts/deploy-testnet.sh
CHAIN_MODE=testnet pnpm --filter @marginpilot/agent prices:refresh  # executor key re-stamps the simulator oracle
bash scripts/start-testnet.sh testnet
```

The wrappers refuse mainnet chain ids, local chain ids as testnet, `--private-key`, owner = executor,
and contract accounts as owner/executor. The agent verifies the RPC chain id and that every deployed
address has code before serving. See
[Execution Evidence](docs/submission/EXECUTION-EVIDENCE.md) for the exact remaining blocker.

`pnpm eval:run` writes `eval/results/<timestamp>/{results.json,summary.md,run-meta.json}`. Use the
generated summary; never hand-edit results. Part 2 runs the A–D ablation on `MockChainPort` only:
**SIMULATED, no anvil and no on-chain hashes** (D-034). Sample seed 1: config D records 0
hard-constraint violations and passes all seven scenario acceptance tests; the 12 recorded violations
all sit in the deliberately weak A/C configs (budget, stale-price, direct-SWAP). Generated evidence:
[`eval/results/2026-10-20T14-11-32-655Z/summary.md`](eval/results/2026-10-20T14-11-32-655Z/summary.md).

### Live LLM (D-036, optional)

`ScriptedLlm` is the CI/demo default. To point the agent at an OpenAI-compatible endpoint, copy
`.env.example` to `.env` (never commit it) and fill `LLM_PROVIDER`, `LLM_MODEL`, `LLM_BASE_URL`,
`LLM_API_KEY`, plus the optional `LLM_FALLBACK_*` names. Keys are read only from the environment and
are never logged or placed in a prompt. `OpenAICompatLlm` was tested against a local mock HTTP server
only; **no live call has been verified**, so do not claim it works until you run it yourself. Start the
demo with `DEMO_MODE=true pnpm --filter @marginpilot/agent start`; the demo runtime still uses the
deterministic script.

## What is real vs simulated

- **SIMULATED (default):** `MockChainPort`; lending protocol, oracle, swap, token balances and every
  transaction hash are in memory. The UI and docs label these `SIMULATED`.
- **REAL EVM, LOCAL ANVIL:** `CHAIN_MODE=anvil` uses `ViemChainPort` against a local anvil chain.
  The hashes in `evidence/anvil-e2e-*.json` are real receipts on that local chain and resolve on its
  JSON-RPC, not on a public explorer. The UI labels this `ANVIL`.
- **REAL code paths:** EIP-712 mandate signing (server key or browser wallet with server-side
  recovery), vault enforcement, policy checks, orchestrator gating, audit hashing, API validation,
  receipt handling and unknown-transaction reconciliation.
- **PUBLIC TESTNET:** not run yet. `TESTNET` is reserved for a chain that is actually a public
  testnet; the source tree contains no public-testnet address or explorer link.
- **Not claimed:** production security, real-protocol performance, per-case optimizer dominance, or
  rescue of real DeFi positions. Contracts are unaudited; do not use with real funds.

Part 1 measured, for 500 seeded constructed two-pool cases: realized-loss mean B − A
**−$13.9234**, bootstrap 95% CI **[−$17.6227, −$10.3966]**, win/tie/loss **118/158/224**; B loses
individual cases because A may choose partial-target amounts outside B's discrete levels. Generated
evidence: [`eval/results/2026-10-20T09-44-04-427Z/summary.md`](eval/results/2026-10-20T09-44-04-427Z/summary.md).

## Documentation

- [Technical documentation](docs/submission/TECH-DOC.md) · [Security self-assessment](docs/submission/SECURITY-SELF-ASSESSMENT.md) · [Execution evidence](docs/submission/EXECUTION-EVIDENCE.md)
- [Architecture](docs/spec/ARCHITECTURE.md) · [Interfaces](docs/spec/INTERFACES.md) · [Contracts](docs/spec/CONTRACTS.md) · [Scenarios](docs/spec/SCENARIOS.md)
- [Evaluation plan](docs/eval/EVALUATION-PLAN.md) · [Known risks](docs/security/KNOWN-RISKS.md) · [Decisions](docs/DECISIONS.md)
- [Status](STATUS.md) · [Dev A blockers](docs/reviews/MESSAGE-TO-DEV-A.md)
