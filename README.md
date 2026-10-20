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
| Core policy, loss model, exhaustive planner, audit chain, ledger | Implemented, 83 tests |
| Deterministic `ScriptedLlm`, mandate compiler, clarification gate, prompt sanitizer | Implemented, 16 tests |
| Orchestrator: fixed tools, plan binding, replans on remaining budget, unknown-tx reconciliation, halt/kill switch | Implemented, 12 tests; S1–S5, S7, S9 on `MockChainPort` |
| Fastify API + SSE + zod boundaries + 429 limit + demo signing | Implemented, 8 tests |
| Web console (instruction → mandate → plan → live state → ledger) | Implemented, 5 tests; verified at 1440px and 390px |
| Seeded Part 1 evaluation and generated report | Implemented, 6 tests; 500 cases |
| Public testnet deployment, `ViemChainPort`, wallet signing, live LLM provider | **Not implemented** (A-07/B-08/B-15/B-13) |
| On-chain `execute` effects and post-condition check #16 | On Dev A's `a/A-04-vault` branch, not merged here |

## Quick start (setup in fewer than ten commands)

Prerequisites: Node 22, pnpm 10, Python 3, and (for contract tests) Foundry.

```bash
pnpm install
pnpm --filter @marginpilot/web build
DEMO_MODE=true pnpm --filter @marginpilot/agent start
pnpm -r test
pnpm -r typecheck
pnpm eval:run -- --part 1 --seed 1
scripts/verify-all.sh
cd contracts && forge test
```

Open `http://127.0.0.1:8787`. The page is served by the API at one URL. The preloaded mandate is
SIMULATED; click **Run rescue** to watch observe → plan → simulate → two gated repays → refreshed
state and ledger. **Demo signing** additionally needs `DEMO_OWNER_PRIVATE_KEY` in the environment;
without it the UI shows the configured error path and the preloaded mandate still runs. Never commit
a key.

`pnpm eval:run` writes `eval/results/<timestamp>/{results.json,summary.md,run-meta.json}`. Use the
generated summary; never hand-edit results. Part 2 fails closed until Dev A's deployment artifacts
exist.

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
