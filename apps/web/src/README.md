# apps/web/src

**Purpose:** Vite + React single-page UI: chat, mandate card + sign, plan card, live state, ledger/tx list, audit drawer, scenario lab (`DEMO_MODE` only).
**Owner:** Dev B
**Tasks:** B-11; B-15 (wallet-mode signing)
**Spec:** `docs/spec/UI-SPEC.md`, `docs/spec/INTERFACES.md` §10.

Numbers are rendered from structured payloads only, never from LLM text. Must be usable at 390px.

## Run

```bash
pnpm --filter @marginpilot/web build      # writes apps/web/dist (gitignored)
DEMO_MODE=true pnpm --filter @marginpilot/agent start   # serves API + dist at one URL
```

For UI-only development, `pnpm --filter @marginpilot/web dev` proxies `/api` to
`127.0.0.1:8787`.

## Honest limits

- Every badge says **SIMULATED**: the lending market and hashes come from
  `MockChainPort`; no transaction is sent to a public network and hashes never
  link to an explorer.
- Demo signing exists only when `DEMO_MODE=true` and
  `DEMO_OWNER_PRIVATE_KEY` is configured. Without the key the UI shows the
  configured error path and the preloaded simulated mandate can still be run.
- The LLM provider is the deterministic `ScriptedLlm`; wallet signing is B-15
  and the testnet adapter is B-08, both pending their dependencies.
- `browser_demo.py` is an optional Playwright smoke check, not part of
  `pnpm test`.
