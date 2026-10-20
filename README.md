# MarginPilot

**Mandate-bound wallet agent for rescuing several at-risk lending positions under one owner-signed,
on-chain-enforced budget.** FinTechathon 2026, Topic F.

The agent proposes and executes only inside a mandate; the vault enforces the limits. The lending
market in this repository is **SIMULATED**. There is currently **no public-testnet deployment**,
so every hash is synthetic and no explorer link exists. See
[Execution Evidence](docs/submission/EXECUTION-EVIDENCE.md).

## What works at this commit

| Area | State |
|---|---|
| Core policy, loss model, exhaustive planner, audit chain, ledger | Implemented, 89 tests |
| Deterministic `ScriptedLlm`, mandate compiler, clarification gate, prompt sanitizer | Implemented, agent suite 42 tests |
| Orchestrator: fixed tools, plan binding, replans on remaining budget, unknown-tx reconciliation, halt/kill switch | Implemented; S1–S5, S7, S9 on `MockChainPort` |
| Fastify API + SSE + zod boundaries + 429 limit + demo signing | Implemented, 8 API tests |
| Web console (instruction → mandate → plan → live state → ledger) | Implemented, 5 tests; verified at 1440px and 390px |
| Seeded Part 1 evaluation and generated report | Implemented, 500 cases |
| Part 2 ablation runner (configs A–D × S1–S5/S7/S9/T15) | Implemented on `MockChainPort`, **SIMULATED**; 8 eval tests |
| OpenAI-compatible LLM client (tools, JSON-schema retry, primary→fallback) | Implemented, mock-HTTP tests only; **no live model call** (D-036) |
| Public testnet deployment, `ViemChainPort`, wallet signing, public URL | **Not implemented / not run**: B-08 deferred, A-10 and A-13 are human-run |
| On-chain `execute` effects and post-condition check #16 | Merged (PR #1 `7039146`, PR #2 `c7000f0`) |

## Quick start (setup in fewer than ten commands)

Prerequisites: Node 22, pnpm 10, Python 3, and (for contract tests) Foundry.

```bash
pnpm install
pnpm --filter @marginpilot/web build
DEMO_MODE=true pnpm --filter @marginpilot/agent start
pnpm -r test
pnpm -r typecheck
pnpm eval:run -- --part 1 --seed 1
pnpm eval:run -- --part 2 --seed 1
scripts/verify-all.sh
cd contracts && forge test
```

Open `http://127.0.0.1:8787`. The page is served by the API at one URL. The preloaded mandate is
SIMULATED; click **Run rescue** to watch observe → plan → simulate → two gated repays → refreshed
state and ledger. **Demo signing** additionally needs `DEMO_OWNER_PRIVATE_KEY` in the environment;
without it the UI shows the configured error path and the preloaded mandate still runs. Never commit
a key.

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

- **SIMULATED:** the lending protocol, oracle, swap, token balances and every transaction hash.
  The UI and docs label these.
- **REAL code paths:** EIP-712 mandate signing, policy checks, orchestrator gating, audit hashing,
  API validation, evaluation code. No real funds and no public chain are touched.
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
