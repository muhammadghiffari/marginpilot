# Execution Evidence — MarginPilot

Network: **SIMULATED (`MockChainPort`)** · Explorer: **none** · Commit: `99ecd55` · Date: 2026-10-20

The repository at this commit has no public-testnet deployment. Every row below is **SIMULATED**
and has no explorer link. Hashes shown by the demo UI are synthetic and change per run; they are
deliberately not copied here because they would not resolve on an explorer. No hash in this file was
invented.

## Deployment

| Contract | Address | Deploy tx | Verified source? |
|---|---|---|---|
| MandateVault (simulated fixture) | `0x00000000000000000000000000000000000000b2` | none — in-memory `MockChainPort` fixture | n/a |
| LendingSim (simulated fixture) | `0x00000000000000000000000000000000000000b1` | none — in-memory fixture | n/a |
| MockSwap (simulated fixture) | `0x00000000000000000000000000000000000000b3` | none — in-memory fixture | n/a |
| mUSDC / mWETH / mWSTETH (simulated tokens) | `…a1` / `…a2` / `…a3` | none — in-memory fixture | n/a |

`TODO(Dev A)`: A-07 must supply `contracts/script/Deploy.s.sol`, `scripts/deploy.sh`,
`deployments/<chainId>.json`, `packages/core/src/abi/` and `eval/fixtures/base.json`. Rows for the
real testnet deployment, deploy tx and verified source are blocked until then, followed by A-09
(anvil runner) and B-08 (`ViemChainPort`).

## Mandate

| Event | Tx hash | Block | Notes (mandate id, owner signer) |
|---|---|---|---|
| SIMULATED mandate installed in demo fixture | none | 100 (mock) | mandate #1, preloaded; no owner signature event on a chain |
| SIMULATED EIP-712 signature path exercised | none | 100 (mock) | API test `confirm fails closed with clarifications, then signs and installs a simulated mandate`; server-side demo signer, no broadcast |
| `TODO(Dev A)` real `MandateSet` event | `TODO(Dev A)` | `TODO(Dev A)` | requires A-07 deployment + owner signature |

## Scenario runs

All scenarios use the deterministic `ScriptedLlm` and `MockChainPort`; each was run once on
2026-10-20. Results are from `apps/agent/test/orchestrator.test.ts` (12 tests) and the named tests
below. "Result" is the asserted outcome, not a claim about a public chain.

| Scenario | Step | Action / result | Tx hash | Explorer link | Real/Simulated |
|---|---|---|---|---|---|
| S1 | 1 | observe both pools; plan two REPAY actions; simulate + submit both; both HFs ≥ 1.005; report matches chain | none | none | SIMULATED |
| S2 | 1 | scarce $150 budget; spend ≤ $150; `COMPLETED_PARTIAL`; names the unsaved pool | none | none | SIMULATED |
| S3 | 1–2 | price moves after action 1; replans with **remaining** budget (not reset); completes within cap | none | none | SIMULATED |
| S4 | 1 | mid-plan target failure; `simulate` fails; no tx; ledger 0 spend; halted with report | none | none | SIMULATED |
| S5 | 1 | stale oracle; `StalePrice` blocks execution; zero transactions; halt recorded | none | none | SIMULATED |
| S7 / T15 | 1 | config D direct SWAP rejected: `ActionNotAllowed`; SWAP-allowed-but-locked variant: `AssetLocked`; permissive config C mines (ablation) | none | none | SIMULATED |
| S9 | 1–2 | kill switch after action 1; no action after pause; report remainder | none | none | SIMULATED |
| T07 | — | on-chain target-revert atomicity **not run**: needs A-04.4 effects + check #16 (branch `dec5aae`, not merged) | none | none | not run |
| T08/T12 | — | end-to-end injected note vs control plan **not run**; only sanitizer/tripwire unit tests | none | none | not run |

For the forbidden-SWAP row the expected and observed error names are exactly `ActionNotAllowed`
(action bit off) and `AssetLocked` (token locked), asserted in
`S7/T15 config D rejects direct SWAP; permissive C wiring mines (SIMULATED ablation)`.

## Screenshots / recordings

Captured from the served SIMULATED demo on 2026-10-20 (`docs/submission/screenshots/`):

| File | What it shows |
|---|---|
| `console-desktop-1440.png` | Completed rescue run: plan with two REPAY actions, HF 0.943 → 1.005 and 1.051 → 1.117, cumulative spend $250.16 of $260 (96.21%), two SIMULATED ledger entries marked MINED |
| `console-mobile-390.png` | The same console at 390px: no horizontal overflow, all three regions stacked |
| `console-halt-budget-exhausted.png` | A second run after the first: `HALTED_NEEDS_OWNER — Budget insufficient: $113.43 needed, $9.84 available`, plan with 0 actions, no new ledger entry (the cumulative cap is not reset between runs) |
| `console-halt-stale-oracle.png` | Fresh state with a stale oracle price: `HALTED_NEEDS_OWNER — STALE_OR_CONFLICTING_DATA: simulation rejected: StalePrice`, no transaction sent |

`TODO(human)`: the optional ≤5-minute demo video and final public-URL screenshots are not attached
yet.

## What must change before this can be called real

1. A-07 deployment artifacts and a funded testnet deployer/executor.
2. B-08 `ViemChainPort` with simulate-before-submit and unknown-hash reconciliation.
3. A-09 anvil scenario runner and the real-hash evidence script.
4. Re-run the same scenarios with REAL labels; every row keeps either an explorer-resolvable hash or
   an explicit "not run". Do not reuse the simulated rows as real evidence.
