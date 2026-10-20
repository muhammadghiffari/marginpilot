# UI-SPEC (owner: Dev B, `apps/web`)

Goal: a judge opens the public URL and, **without reading docs**, sees an agent understand an instruction, act within limits, and explain itself. Judges grade "innovation & interaction" on feel; keep it clean and fast, not fancy.

## Layout (single page, 3 columns on desktop, stacked on mobile)
1. **Left — Conversation.** Chat box with example chips ("Protect my loans. Max $260. Don't touch my ETH. Keep $100 in reserve."). Streaming agent messages (SSE). Clarifying questions appear as buttons/inputs.
2. **Center — Mandate & Plan.**
   - *Mandate card:* human-readable bullets (budget, locked assets, allowed actions, expiry, reserve) + "Assumptions we filled in" list + collapsible raw JSON + **Sign & Activate** (demo owner / wallet). Disabled while `clarifications` exist.
   - *Plan card:* per-action rows (pool, amount, HF before→after expected, spend), "Not done & why", residual risk, remaining budget.
3. **Right — Live state.** Positions (HF gauge before/after, color bands <1, 1–1.1, >1.1), **budget bar** (spent / cap / remaining, from the on-chain ledger), state-machine timeline (Run + Action), tx list with explorer links, audit-log drawer (hash-chain index, copy/export).

## Demo controls (visible only when `DEMO_MODE=true`, in a collapsed "Scenario lab" panel)
Price shock buttons (−10%/−20% mWETH, mWSTETH), "Make oracle stale", "Pause lending pool 1" (failure injection), "Poison a note", "Pause vault (kill switch)". Each maps to `/api/demo/*` and is labeled as a *simulation control*.

## Must-have behaviors
- Never show a number the agent computed in prose unless it came from structured facts (grounding rule). UI renders numbers from structured payloads, not from LLM text.
- Every executed action row has a real tx hash link (`explorerBase` from `deployments/<chainId>.json`); simulated/mocked data is badged **SIMULATED**.
- A `HALTED_NEEDS_OWNER` state shows the reason and the exact owner decision needed (e.g. "Budget short by $X — sign a new mandate").
- Error states are explained in plain language with the contract error name in small text (`BudgetExceeded`, `AssetLocked`…).
- Loading/streaming states; no blank screens; works at 390px width.
- Footer: network name, vault address, "Testnet demo · simulated lending market · not financial advice".

## Out of scope for P0
Auth/accounts, multi-user isolation, charts of history, i18n. If `ownerMode="wallet"` is not ready, ship demo-owner mode only and say so in the UI.
