# Real Chain Adapter Implementation Plan

> **For agentic workers:** Execute the tasks in order. Each task ends with focused tests and a commit.

**Goal:** Replace the mock-only demo path with a real EVM path so the agent can install an owner-signed mandate and execute rescue actions against a deployed `MandateVault`, first on anvil and then on the configured testnet.

**Architecture:** Keep `MockChainPort` as the deterministic oracle. Add `ViemChainPort` in the agent package for reads, simulation, submission, receipts and owner/executor writes. Generalize the runtime so simulated and chain modes share one API. The deployment record becomes the single source of chain metadata (vault, owner, executor, oracle, explorer). The UI derives SIMULATED / ANVIL / TESTNET labels and explorer links from `/api/state` instead of hardcoding `true`.

**Tech Stack:** TypeScript strict, viem 2.38, Fastify, zod, Vitest, Foundry/anvil.

---

## File map

- `packages/core/src/chain-port.ts` — add optional `MandateWriter` / `DemoControls` capabilities and `getNextMandateId`.
- `packages/core/src/mock-chain-port.ts` — implement the optional capabilities for differential tests.
- `apps/agent/src/chain/viem-port.ts` — new real adapter (reads, simulate, submit, getTx, pause, demo setters, mandate write, error decoding).
- `apps/agent/src/chain/factory.ts` — construct the adapter from validated config; no silent fallback.
- `apps/agent/src/mandate/registry.ts` — parse vault/oracle/owner/executor/explorer and return full deployment metadata.
- `apps/agent/src/runtime.ts` — new unified runtime (compile, confirm, state, shock, inject, pause, signer selection).
- `apps/agent/src/config.ts` — new strict env config; loads `.env` without logging values.
- `apps/agent/src/server.ts` — load env, validate, build runtime/server.
- `apps/agent/src/api/server.ts` — dynamic state metadata, wallet-mode confirm, demo-control gating.
- `apps/web/src/api.ts` / `apps/web/src/app.tsx` — dynamic labels, token symbols, explorer links.
- `scripts/e2e-anvil.sh` — fresh anvil + deploy + real adapter rescue with receipts.
- `scripts/deploy-testnet.sh` / `apps/agent/src/cli/refresh-prices.ts` — testnet operations without key logging.
- Tests: `apps/agent/test/viem-port.test.ts`, `runtime.test.ts`, `config.test.ts`; update `api.test.ts`; `apps/web/test/*`.

## Task 1 — Capability interfaces and registry metadata

1. Add failing tests for loading a deployment with `vault`, `oracle`, `owner`, `executor`, `explorerBase`.
2. Extend `TokenRegistry` with `targets.vault`, `targets.oracle`, optional identity fields; keep `LOCAL_TEST_REGISTRY` valid.
3. Add optional `MandateWriter` and `DemoControls` methods to `ChainPort`; implement on `MockChainPort`.
4. Run core + agent tests; commit.

## Task 2 — ViemChainPort

1. Write tests for pure mappings: `Action` → contract tuple, mandate → tuple, error decoding (target errors → `Unknown`), and tx receipt mapping.
2. Implement reads with `createPublicClient` and ABI files.
3. Implement `simulate` with `simulateContract` as the executor; fail closed on decode failure.
4. Implement `submit` with `writeContract` + receipt wait; timeout returns `unknown` and never resends; mined revert decodes via replay at the parent block.
5. Implement `getTx`, `pause`, `demoSetPrice`, `demoSetPoolPaused`, `demoSetSwapBroken`, `setMandateWithSig`, `getNextMandateId`.
6. Unit tests green; commit.

## Task 3 — Unified runtime and signer selection

1. Write failing tests: demo confirm uses the deployed vault domain; chain confirm calls `setMandateWithSig`; no key fails closed; wallet signature path submits; owner/executor mismatch is rejected.
2. Extract signing types/domain and implement `AgentRuntime` with injected `ChainPort`.
3. Keep `DemoRuntime` as a thin simulated-mode factory so existing tests keep their contract.
4. Implement `shock`, `inject`, `pause` through the port; require an owner signer for admin writes.
5. Tests green; commit.

## Task 4 — Config, server and API

1. Write failing config tests: demo default; chain mode requires RPC/chain id/deployment/executor; deployer key accepted as owner only when its address equals deployment owner; malformed keys rejected without echoing them.
2. Implement `loadConfig` + `.env` loading (`process.loadEnvFile`, guarded).
3. Wire factory/server; `/api/state` returns `mode`, `simulated`, `chainId`, `vault`, `owner`, `executor`, `explorerBase`, `tokens`.
4. Implement wallet-mode confirm (`ownerMode: 'wallet'`, `signature`).
5. Keep demo endpoints available only when `demoMode`; in chain mode this requires explicit `ALLOW_DEMO_CONTROLS=true`.
6. API tests green; commit.

## Task 5 — Web console

1. Update API schemas and tests for dynamic `simulated` and chain metadata.
2. Replace hardcoded SIMULATED labels with mode badge (`SIMULATED`, `ANVIL`, `TESTNET`), real token symbols from state, explorer tx links only when a base URL exists, and honest footer.
3. Sign button/notice reflect mode; scenario lab states what it mutates.
4. Web tests + typecheck green; commit.

## Task 6 — Anvil end-to-end proof

1. Add `scripts/e2e-anvil.sh`: start anvil, deploy with the public anvil test keys, start the agent in chain mode, compile + confirm + run via HTTP, assert mined receipts and two `ActionExecuted` events, write evidence JSON.
2. Run it and capture real hashes in `docs/submission/EXECUTION-EVIDENCE.md` (only if receipts exist).
3. Commit.

## Task 7 — Testnet operations

1. Add `scripts/deploy-testnet.sh` with chain-id/RPC checks and keystore-or-env signer selection; never echo keys.
2. Add `scripts/refresh-prices.ts` to re-stamp oracle prices before a demo.
3. Run `scripts/verify-all.sh`, `scripts/check-secrets.sh`; update `STATUS.md`, `DECISIONS.md`, `README.md`, `KNOWN-RISKS.md`.
4. Commit. Broadcast only with the human present and a funded key.
