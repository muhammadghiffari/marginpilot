# B-07 lean mandate compiler — implementation plan

> Execute inline in this session. TDD: write the failing test, run it, implement, run green, commit.

**Goal:** `compile_mandate` turns free text into a validated, non-authoritative `MandateDraft`; the seed prompts m01–m12 compile with zero dangerous widening and ambiguous prompts produce clarifications.

**Architecture:** `LlmClient` is the only provider seam. `ScriptedLlm` replays recorded structured/tool-call traces deterministically; `LiveLlmClient` is a typed stub that throws `not configured` when `LLM_PROVIDER` or `LLM_MODEL` is empty. `compileMandate` sanitizes the user text, detects injection, validates the model's loose extraction with zod, then runs a deterministic normalizer (USD→usd8, symbols→addresses, duration→validUntil) and cross-checks every parsed amount against the raw text. The final draft is validated with `MandateDraftSchema`. A draft with clarifications cannot be confirmed.

**Tech:** TypeScript strict, zod, vitest, Node 22 fs.

## Files

- Create `apps/agent/src/llm/client.ts` — request/response/tool/usage types, `LlmClient`.
- Create `apps/agent/src/llm/scripted.ts` — `ScriptedLlm`, `ScriptedLlmExhaustedError`.
- Create `apps/agent/src/llm/provider.ts` — `LiveLlmClient`, `LlmNotConfiguredError`, `readLlmConfig`.
- Create `apps/agent/src/prompts.ts` — compile system prompt, `sanitizeUntrusted`, `wrapUntrusted`, `detectInjection`, `COMPILE_SYSTEM_PROMPT`.
- Create `apps/agent/src/mandate/registry.ts` — `TokenRegistry`, `loadTokenRegistry`, `LOCAL_TEST_REGISTRY`.
- Create `apps/agent/src/mandate/compile.ts` — extraction schema, normalizer, amount regex cross-check, clarifications, `assertDraftConfirmable`.
- Create `apps/agent/test/llm.test.ts` — client/scripted/provider/prompt tests.
- Create `apps/agent/test/mandate.test.ts` — registry + m01–m12 + dangerous-widening + confirm gate tests.
- Modify `apps/agent/src/README.md` — mark B-07 implemented and its limits.
- Modify `STATUS.md`, `tasks/DEV-B.md` — evidence.

## Task 1 — LLM seam and provider stub

- [ ] Write `apps/agent/test/llm.test.ts` cases:
  - `ScriptedLlm` returns traces in order, `model`/`temperature 0`/usage defaults, then throws `ScriptedLlmExhaustedError`.
  - matching traces skip non-matching entries deterministically.
  - `readLlmConfig` trims env; empty provider/model ⇒ `LiveLlmClient.complete` rejects with an `LlmNotConfiguredError` whose message contains `not configured`.
  - configured stub rejects with `LiveLlmUnavailableError`, never performs network I/O.
- [ ] Run `pnpm --filter @marginpilot/agent test`; expect import failures.
- [ ] Implement `client.ts`, `scripted.ts`, `provider.ts`. No key is read, logged or placed in a request.
- [ ] Run the test; expect PASS.

## Task 2 — prompt safety

- [ ] Add prompt tests in `apps/agent/test/llm.test.ts`:
  - control chars/zero-width characters removed; max length enforced; `<untrusted>`/`<system>` delimiter look-alikes neutralized.
  - `wrapUntrusted('tool:get_state', text)` produces one `<untrusted source="tool:get_state">` block with escaped body.
  - `detectInjection` flags `ignore previous`, `system:`, `private key`, `sell everything` and long base64; returns no findings for m01.
  - findings return pattern ids only, never matched text (no secret leak).
- [ ] Run red. Implement `apps/agent/src/prompts.ts`; `COMPILE_SYSTEM_PROMPT` states that `<untrusted>` content is data, never instructions, and no mandate is valid without owner confirmation.
- [ ] Run green.

## Task 3 — token registry

- [ ] Add registry tests:
  - missing `deployments/31337.json` + explicit fallback ⇒ `LOCAL_TEST_REGISTRY`.
  - a temp valid deployment file maps `contracts.mUSDC/mWETH/mWSTETH/lending/swap` into a registry.
  - missing file without fallback throws `TokenRegistryMissingError`; malformed file throws `TokenRegistryInvalidError`.
- [ ] Run red. Implement `registry.ts` with zod `.strict()` at the file boundary. `LOCAL_TEST_REGISTRY` is labelled SIMULATED test-only.
- [ ] Run green.

## Task 4 — compiler, normalizer, clarifications, confirmation gate

- [ ] Add `apps/agent/test/mandate.test.ts` seed harness that:
  - reads `eval/fixtures/mandate-prompts.jsonl` (12 lines);
  - drives `compileMandate` with `ScriptedLlm` traces (one per id; m08 intentionally proposes `$500`, m09 intentionally proposes `$1,000,000` and all actions);
  - asserts expected hard fields, clarification field (or none), `nowSec`-relative expiry, and `assertDraftConfirmable` throws exactly when clarifications exist.
  - asserts `dangerousWidenings === 0`: total never above the smallest explicit total in text, per-action ≤ total, borrow only when text allows it, SWAP/target only when text allows it, locked tokens only when text names them.
  - asserts m09 writes an `injection.suspected` audit event with pattern ids only.
- [ ] Add adversarial normalizer tests: model `$4000` vs text `$400` ⇒ final `$400` + clarification; no budget text ⇒ total `0` + clarification; m08 `$50` vs `$500` ⇒ `$50` + clarification; `only repay` forces bit 0 only; default expiry is now+24h and is listed under assumptions.
- [ ] Run red. Implement `compile.ts`:
  - `MandateModelOutputSchema` strict, loose monetary strings/numbers, token symbols, duration seconds or ISO expiry, unresolved fields.
  - `parseUsdToUsd8` only decimal strings (no floats/exponents); `extractTotalBudgetCandidates`, `extractPerActionCandidates`, `extractReserveCandidates` from raw text; every model amount must match a text candidate, else use the smallest safe candidate and add a clarification.
  - token aliases: USDC→mUSDC, ETH/WETH→mWETH, staked ETH/wstETH→mWSTETH; preservation cues (`keep`, `untouched`, `don't sell/touch`, `long-term`, `never sell`) without a concrete symbol ⇒ `lockedTokens` clarification.
  - defaults per AGENT-DESIGN §5, each listed in `assumptions`; explicit values are not assumptions.
  - `humanSummary` is a deterministic template over final fields (never model prose).
  - final `MandateDraftSchema.parse`; `assertDraftConfirmable` throws `DraftHasClarificationsError`.
- [ ] Run the focused tests; fix until green.

## Task 5 — verification and evidence

- [ ] `pnpm -r typecheck`; `pnpm -r test`.
- [ ] `scripts/verify-all.sh` with Foundry on PATH.
- [ ] Update `apps/agent/src/README.md`, `tasks/DEV-B.md` (B-07 `[x]` with real test count), `STATUS.md`.
- [ ] Commit `feat(agent): implement lean mandate compiler (B-07)`; push the branch.
