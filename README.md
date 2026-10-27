# MarginPilot

**Mandate-bound wallet agent for rescuing several at-risk lending positions under one owner-signed,
on-chain-enforced budget.** FinTechathon 2026, Topic F.

The agent proposes and executes only inside a mandate; the vault enforces the limits. The lending
market in this repository is **SIMULATED** (D-002). The agent can run against a **real EVM chain**
through `ViemChainPort`: local-anvil and public Ethereum Sepolia runs each mined owner-mandated
rescue actions ([local evidence](evidence/anvil-e2e-20261021T060254Z.json),
[Sepolia evidence](evidence/sepolia-ui-e2e-20261021.json)). The transactions are real, **not real
lending-protocol rescues**. The Sepolia run was driven **from the console in a browser** and
finished `COMPLETED` with both positions rescued; see
[Execution Evidence](docs/submission/EXECUTION-EVIDENCE.md).

## What works at this commit

| Area | State |
|---|---|
| Core policy, loss model, exhaustive planner, audit chain, ledger | Implemented, 89 tests |
| Deterministic `ScriptedLlm`, mandate compiler, clarification gate, prompt sanitizer | Implemented, agent suite 79 tests |
| Orchestrator: fixed tools, plan binding, replans on remaining budget, replan-on-stale-plan, unknown-tx reconciliation, halt/kill switch | Implemented; S1–S5, S7, S9 on `MockChainPort`, plus local-anvil and Sepolia E2Es |
| Fastify API + SSE + zod boundaries + always-on 429 limits + demo signing | Implemented, 10 API tests |
| Web console (instruction → mandate → plan → live state → ledger) with **block-explorer links** | Implemented, 6 tests; verified at 1440px and 390px on Sepolia |
| Seeded Part 1 evaluation and generated report | Implemented, 500 cases |
| Part 2 ablation runner (configs A–D × S1–S5/S7/S9/T15) | Implemented on `MockChainPort`, **SIMULATED**; 8 eval tests |
| `ViemChainPort`: reads, simulate-before-submit, receipts, unknown reconciliation, owner/executor writes | Implemented; real local-anvil and public Sepolia receipts |
| Owner signing: server owner key and browser-wallet EIP-712 relay | Implemented; unit/API tested (no MetaMask extension run recorded) |
| OpenAI-compatible LLM client (tools, JSON-schema retry, primary→fallback) | Implemented, mock-HTTP tests only; **no live model call** (D-036) |
| Local anvil deploy, base fixture and ABIs | Implemented; `scripts/deploy.sh` (A-07), `eval/fixtures/base.json`, 5 ABIs in `packages/core/src/abi/` |
| A-10 testnet evidence tooling | `scripts/testnet-evidence.sh` + `evidence/testnet-31337.json` / `evidence/TESTNET-EVIDENCE.md` (15 txs, H1 success + R1–R6 expected reverts); keystore mode via `OWNER_ACCOUNT`/`EXECUTOR_ACCOUNT`; a testnet deploy writes `eval/fixtures/testnet-<chainId>.json` |
| Public testnet deployment and public URL | Sepolia chain 11155111 deployed; a **browser-driven rescue completed** (`COMPLETED`, two mined REPAYs, Etherscan links in the UI); **public URL not live** (A-13), S2/S7 not yet broadcast |
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

### Ethereum Sepolia (public testnet; simulated lending market)

The live vault is
[`0xd7FC116f1acaE8cE017114aD7E41F132a998743C`](https://sepolia.etherscan.io/address/0xd7FC116f1acaE8cE017114aD7E41F132a998743C)
on chain `11155111`. A **browser session against the served console** shocked the market, signed
mandate #13 and ran the rescue: run `run-mvihf91d-1` finished **`COMPLETED`** with two mined REPAY
transactions ([$86.57](https://sepolia.etherscan.io/tx/0x756b52c8f4292c6ef918331d84fa710a31616cf8955faa588eabd82634016e04),
[$163.59](https://sepolia.etherscan.io/tx/0xadb2d86c3906fe9a8ec4d5f108732866817160e545becc0ac8078830d5df5fb9))
and both health factors above 1.0 (`0.943 → 1.005`, `1.051 → 1.117`), spending `$250.16` of the
`$260` mandate. Evidence: [13 receipts re-read from a second public RPC](evidence/sepolia-ui-e2e-20261022.json)
and the screenshots in `docs/submission/screenshots/`. These are real **Sepolia EVM transactions**
against self-deployed simulator contracts, **not real DeFi positions**.

In the console the chain badge links to the vault, a **Deployment** card links all seven contracts,
the owner-signed mandate transaction is linked, and every mined action links to Etherscan.

The **Scenario lab** (bottom right, `TESTNET CONTROLS`) has the market controls: `mWETH -20%` /
`mWSTETH -20%` shock a pool, and **Refresh oracle timestamps** re-stamps every price (including the
reserve token). The mandate only accepts prices younger than its freshness window (600 s in the
demo), so a run that halts with `StalePrice` just needs that button and a second run.

To use the existing deployment, supply public Sepolia overrides **after** sourcing your ignored
`.env` (which holds the testnet-only keys). `scripts/start-testnet.sh` supports `ENV_FILE` pointing
to an ignored shell file that sources `.env` and then sets `CHAIN_ID=11155111`, Sepolia `RPC_URL`,
`EXPLORER_BASE_URL=https://sepolia.etherscan.io`, the public `OWNER_ADDRESS`/`EXECUTOR_ADDRESS`,
and `PORT`. Keep `HOST=127.0.0.1`; set `ALLOW_DEMO_CONTROLS=true` only for a loopback demo because
the shock controls and server-key mandate confirmation are not authenticated in demo mode. Never
proxy that configuration to a public URL. Run
`ENV_FILE=<your-ignored-config> bash scripts/start-testnet.sh testnet`.
The oracle refresh CLI now selects a configured key matching the oracle's **on-chain admin**;
the executor cannot refresh this admin-controlled oracle.

`apps/web/test/browser_testnet.py` replays the whole browser flow against a running testnet agent
(shock → draft → sign → run → check the explorer links, 390 px layout, no page errors):

```bash
source ~/.local/opencode-venv/bin/activate
python3 apps/web/test/browser_testnet.py --base-url http://127.0.0.1:8790
```

**Deployment caveat:** Sepolia's observed gas schedule caused earlier `scripts/deploy-testnet.sh`
Forge broadcasts to fail; it now refuses Sepolia before any RPC/broadcast. The recorded deployment
used an encrypted keystore and explicit per-transaction
`cast send` gas limits; the vault was compiled with `via_ir = true`, `optimizer_runs = 1` to fit the
observed 16,777,216 gas ceiling. A reusable manual-deploy wrapper is pending. Do not claim that
`deploy-testnet.sh` reproduced this deployment. The agent validates chain id, contract code, and
owner/executor roles at startup. Details: [Execution Evidence](docs/submission/EXECUTION-EVIDENCE.md).

`pnpm eval:run` writes `eval/results/<timestamp>/{results.json,summary.md,run-meta.json}`. Use the
generated summary; never hand-edit results. Part 2 runs the A–D ablation on `MockChainPort` only:
**SIMULATED, no anvil and no on-chain hashes** (D-034); it uses the A-07 deployment artifacts and
does not need an anvil chain runner. Sample seed 1: config D records 0
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
- **PUBLIC TESTNET:** real Ethereum Sepolia transactions on chain `11155111`; the lending protocol
  remains a self-deployed **simulator**. See `deployments/11155111.json` and `evidence/sepolia-e2e-20261021.json`.
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

## Team and roles

All commits in this repository were made under a single Git identity (`muhammadghiffari`), so the commit log does not show who did what. Roles:

| Area | Role | Folders |
|---|---|---|
| Dev A: contracts, deployment, chain evidence | Muhammad Ghiffari | `contracts/`, `deployments/`, `scripts/deploy*`, `evidence/` |
| Dev B: core, agent, web, real-chain adapter and Sepolia run | Radith (collaborator) | `packages/`, `apps/`, TS side of `eval/` |

Post-submission work (from 2026-10-28) is described in `docs/DECISIONS.md` D-046 and is not part of the original competition submission.

## License

MIT, copyright "MarginPilot team" (D-044). See `LICENSE`.
