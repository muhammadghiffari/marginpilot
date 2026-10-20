# ARCHITECTURE

```
 Owner (wallet / demo owner key)                    Judge / User (browser)
        │ EIP-712 SetMandate                                │ NL instruction, approve, demo controls
        ▼                                                   ▼
┌──────────────────────┐   REST + SSE    ┌──────────────────────────────────────────────┐
│  apps/web (React)    │◄───────────────►│ apps/agent (Node 22, TypeScript)             │
│  chat, mandate card, │                 │  Orchestrator (LLM tool loop)                │
│  plan, ledger, txs   │                 │   ├─ tools → packages/core (optimizer, policy │
└──────────────────────┘                 │   │          mirror, ledger, state machines)  │
                                         │   ├─ ChainPort (viem)  ── reads/writes ──┐    │
                                         │   └─ audit log (hash-chained JSONL)      │    │
                                         │  keys: executor (hot), demo-owner (demo) │    │
                                         └──────────────────────────────────────────┼────┘
                                                                                    ▼
                         EVM chain (anvil locally · Sepolia/Base Sepolia for evidence)
                         MandateVault ──execute──► LendingSim · MockSwap ◄── MockOracle
                         (owner-signed mandate, cumulative budget, locks, pause)   (admin-controlled prices)
                                       ▲
                          eval/chain liquidator bot (anyone may liquidate HF<1) → realized loss events
```

## Trust zones
1. **LLM** — untrusted for facts and authority. Can only pick tools.
2. **Agent process** — trusted to run code, *not* trusted as the sole enforcer (config C models its compromise: the executor key can call the vault directly).
3. **MandateVault** — the enforcer. Constrains the executor key regardless of what the agent process does.
4. **Owner key** — the only authority that can create budget, change mandate, withdraw.

## Monorepo layout
```
contracts/            Foundry (Dev A)          src/ test/ script/
packages/core/        TS pure library (Dev B)  types, optimizer, policy, ledger, state machines, audit, abi/, MockChainPort
apps/agent/           Node server (Dev B)      orchestrator, tools, ViemChainPort, llm/, api/
apps/web/             Vite + React (Dev B)
eval/                 harness + fixtures + worked_example.py (shared; Dev B drives, Dev A supports chain side)
deployments/          <chainId>.json (Dev A)
evidence/             tx hashes, screenshots, eval outputs (generated; commit summaries only)
docs/                 PRD, specs, security, research, submission
scripts/              preflight, verify-all, check-secrets, dev-anvil, package-submission
```

## Tech choices (decided; see DECISIONS.md D-001…)
Foundry · Node 22 + pnpm workspaces · TypeScript strict · viem · zod · vitest · Fastify (or Express) · Vite + React · one deployable server that also serves `apps/web/dist` (single public URL).

## Configurations used in the ablation (same code, different wiring)
| Cfg | Planner | Orchestrator | Enforcement |
|---|---|---|---|
| A | per-position threshold rule | none (script) | permissive vault mandate (no meaningful on-chain limits) |
| B | global optimizer | none (fixed loop) | on-chain gate |
| C | global optimizer | LLM agent | **off-chain per-plan check only** (`policy.ts` on each plan independently, no cumulative ledger), permissive on-chain mandate |
| D | global optimizer | LLM agent | **on-chain persistent gate** (the product) |
C and A are deliberately weaker by construction; the C-vs-D comparison is an **ablation of design choices**, not a competitive benchmark, and must be reported that way.
