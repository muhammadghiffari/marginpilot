# THREAT MODEL

Security is a baseline for **all** topics; judges grade what actually runs. This file defines assets, attackers, trust boundaries and which defense covers which threat. Every row maps to tests in `ADVERSARIAL-TESTS.md`.

## Assets
Vault funds (test tokens), the mandate (owner intent), the executor key, the demo-owner key, the LLM API key, the audit log, the public demo's availability and cost.

## Attackers
| ID | Attacker | Capability |
|---|---|---|
| X1 | Malicious/confused LLM output | arbitrary text/tool-call choices inside the tool set |
| X2 | Injection author | controls token names, notes/memory, API/indexer responses the agent reads |
| X3 | Compromised agent process / leaked executor key | can call `MandateVault.execute` directly with any `Action` |
| X4 | Replay/relay attacker | re-submits old signatures or old actions |
| X5 | Public-demo abuser | spams endpoints, burns LLM budget, tries to read env |
| X6 | Price/state adversary | stale or conflicting data, price moves between plan and execution |
Out of scope: compromise of the **owner** key, malicious RPC providers beyond stale-data checks, oracle manipulation on a real market (our oracle is admin-set), contract bugs not covered by tests (disclosed in `KNOWN-RISKS.md`).

## Defense layers (outermost = weakest guarantee)
1. **Prompt/tool design** (advisory): untrusted-data delimiting, tripwire logging.
2. **Tool allow-list & plan binding** (code): the model can only execute actions that exist in the latest optimizer plan; no raw calldata; stale plans rejected.
3. **Off-chain policy mirror** (code, fail fast): `policy.ts` mirrors the vault checks.
4. **On-chain gate** (enforced): `MandateVault.execute` — cumulative budget, per-action cap, allow-list of targets/actions, locked tokens, freshness, deviation, slippage, post-conditions, pause. **This is the layer that holds even when 1–3 fail.**
5. **Owner control**: only owner signature creates budget; `pause`, `revokeMandate`, `ownerWithdraw`.

## Threat → defense → test
(`layer N` = the defense layer numbered above; unrelated to the permission tiers L0–L3.)

| Threat | Defense | Tests |
|---|---|---|
| X1/X2: agent tries to sell locked ETH | layer 4 `AssetLocked` / `ActionNotAllowed` | T01, T08 |
| X1: replans exceed cumulative budget | layer 4 cumulative ledger `BudgetExceeded`; layer 3 mirror | T02 |
| X1: agent borrows more | layer 4 `BorrowForbidden` | T03 |
| X3: call to a contract outside allow-list | layer 4 `TargetNotAllowed` | T04 |
| X6: stale oracle | layer 4 `StalePrice` | T05 |
| X6: price moved since plan | layer 4 `PriceDeviation` + replan | T05b (S3) |
| X6: slippage | layer 4 `SlippageExceeded` | T06 |
| Failed tx still "counted" | revert semantics + ledger reconciliation | T07 |
| X2: instruction injection in tool/notes | layers 1-2 + 4 | T08, T12 |
| X4: replay of old mandate signature | EIP-712 + monotonic id | T09 |
| X4: replay of old action | `StaleAction` (nonce/mandate id) | T09b |
| Owner tightening/loosening without signature | `NotOwner`/`BadSignature` | T10 |
| Emergency stop | `pause` | T11 |
| X6: provider vs chain conflict | read chain, log discrepancy | T14 |
| Inconsistent agent across runs | pass^k study; gate independent of it | T13 |
| X3: executor key bypasses agent guard | layer 4 | T04, T15 |
| X3: unpause by executor | `NotOwner` | T16 |
| X5: secret exfiltration via prompt | secrets never in context; redaction | T17 |
| X5: spam / cost burn | rate limits, provider cap | T18 |

## Permission tiers (documented in `PERMISSION-TIERS.md`, implemented in code)
L0 read-only · L1 plan & simulate · L2 bounded execution (on-chain mandate) · L3 owner decision required (new mandate, higher budget, out-of-policy). The agent can never raise its own tier.

## Residual risk (summarized; full list in `KNOWN-RISKS.md`)
Contracts unaudited; mock oracle/lending are not representative of real protocol risks; liquidations modeled single-step without interest; gas not in on-chain budget; executor key is a hot key (mitigated by gate, not eliminated); LLM provider is a third-party dependency; demo-owner mode signs on the server (testnet only).
