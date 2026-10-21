# Execution Evidence — MarginPilot

Date: 2026-10-21 · Default demo: **SIMULATED** · Real-EVM proof: **local anvil, chain 31338** ·
Public testnet: **not deployed yet** (requires a funded testnet account and RPC from the human).

This file separates three kinds of evidence:

1. **REAL EVM, LOCAL ANVIL** — transactions mined by a local anvil chain. The hashes resolve on that
   chain's JSON-RPC while it runs; there is no public explorer. This proves the adapter, signing,
   vault enforcement and receipt handling against real EVM bytecode, but it is **not** a public
   testnet and must not be labelled `TESTNET`.
2. **SIMULATED** — in-memory `MockChainPort`; hashes are synthetic and deliberately not listed here.
3. **NOT RUN** — public-testnet deployment and public explorer links.

No hash or address in this file was invented. The local-anvil hashes below are copied from
[`evidence/anvil-e2e-20261021T060254Z.json`](../../evidence/anvil-e2e-20261021T060254Z.json).

## 1. Real-EVM local-anvil run (ANVIL)

Command: `bash scripts/e2e-anvil.sh` (fresh anvil on `127.0.0.1:8547`, chain `31338`; deploys and
seeds the simulator, starts the agent in explicit chain mode, shocks the oracle, refreshes price
timestamps, installs an owner-signed EIP-712 mandate, runs the rescue, writes the JSON evidence).

| Item | Value |
|---|---|
| Chain id | `31338` (local anvil; not a public testnet) |
| Vault | `0x0165878A594ca255338adfa4d48449f69242Eb8F` |
| Owner (EIP-712 signer) | `0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266` |
| Executor | `0x70997970C51812dc3A010C7d01b50e0d17dc79C8` |
| Mandate | id `1`, installed by `setMandateWithSig` |
| Mandate tx | `0x62dcec561944d41feaa58c6478eed968d8e86d7f88b16e0aeaef9fd68a30b8ad` |
| Action 0 (REPAY pool 0) | `0x85136af6b11f657f05ae59d324593fa9de89529ec544a47d123aca3ce47d8366` |
| Action 1 (REPAY pool 1) | `0x82088d70621d00cd312f9a2974613f7fae398e73520f6ee578dcfba56baf5225` |
| Oracle shock tx 0 | `0xeff730a5f403a7ec38c2c9842285e3629ff9cff871b90aea3857fd48ec07cdbb` |
| Oracle shock tx 1 | `0x1a3071f92832e1f688f7ac1482750b94da68eaef0aae3afdd08fd8778555f22e` |
| Price refresh (mUSDC / mWETH / mWSTETH) | `0xc73f81b5…`, `0x9f89a08a…`, `0x5066b914…` (full hashes in the JSON) |
| Run | `run-mvhph1yl-1`, state `COMPLETED`, two ledger entries `mined` |
| Spend | `$86.57` + `$163.59` = `$250.16` of the `$260` cap (96.21%; gas excluded, reported separately) |
| Health factors | pool 0: `0.942857…` → `1.005002…`; pool 1: `1.051428…` → `1.116670…` |

The hashes are local-anvil receipts: they are real EVM transactions but cannot resolve on a public
explorer. The UI badge for this mode is `ANVIL`, never `TESTNET`.

### Wallet signing

The server-side owner key path is exercised by the anvil E2E. The browser-wallet path is implemented
as prepare → `eth_signTypedData_v4` → relay, with server-side recovery against the deployment owner;
it is covered by unit/API tests (`apps/agent/test/runtime.test.ts`,
`apps/agent/test/api.test.ts`). A MetaMask extension run has not been recorded.

## 2. Public-testnet deployment (NOT RUN)

There is **no public-testnet deployment** in this repository and therefore **no explorer-resolvable
transaction hash**. Public-testnet broadcast is blocked on:

- a funded testnet deployer/owner account and a public RPC configured in `.env`;
- a Foundry keystore or hardware signer (the deploy wrapper refuses `--private-key`);
- an explicit human-present go-ahead.

The guarded path is prepared:

```bash
# .env: CHAIN_MODE=testnet, CHAIN_ID=<testnet>, RPC_URL=<public RPC>,
#       EXPLORER_BASE_URL=<explorer>, OWNER_ADDRESS=<owner EOA>,
#       EXECUTOR_ADDRESS=<executor EOA>
bash scripts/deploy-testnet.sh
CHAIN_MODE=testnet pnpm --filter @marginpilot/agent prices:refresh
bash scripts/start-testnet.sh testnet
```

`deploy-testnet.sh` refuses mainnet chain ids and local chain ids, refuses `--private-key`, requires
`SENDER` (a funded EOA), a Foundry account/hardware signer in `EXTRA_FORGE_ARGS`, owner ≠ executor,
and EOAs for both roles. The agent refuses mainnet ids, verifies the RPC chain id, and checks that
every deployment address has code before serving.

## 3. Simulated scenario evidence (SIMULATED)

All scenarios in this section use the deterministic `ScriptedLlm` and `MockChainPort`; each was run
on 2026-10-20. Results are from `apps/agent/test/orchestrator.test.ts` and the named tests. “Result”
is the asserted outcome, not a claim about a public chain.

| Scenario | Step | Action / result | Tx hash | Explorer link | Real/Simulated |
|---|---|---|---|---|---|
| S1 | 1 | observe both pools; plan two REPAY actions; simulate + submit both; both HFs ≥ 1.005; report matches chain | none | none | SIMULATED |
| S2 | 1 | scarce $150 budget; spend ≤ $150; `COMPLETED_PARTIAL`; names the unsaved pool | none | none | SIMULATED |
| S3 | 1–2 | price moves after action 1; replans with **remaining** budget (not reset); completes within cap | none | none | SIMULATED |
| S4 | 1 | mid-plan target failure; `simulate` fails; no tx; ledger 0 spend; halted with report | none | none | SIMULATED |
| S5 | 1 | stale oracle; `StalePrice` blocks execution; zero transactions; halt recorded | none | none | SIMULATED |
| S7 / T15 | 1 | config D direct SWAP rejected: `ActionNotAllowed`; SWAP-allowed-but-locked variant: `AssetLocked`; permissive config C mines (ablation) | none | none | SIMULATED |
| S9 | 1–2 | kill switch after action 1; no action after pause; report remainder | none | none | SIMULATED |
| T07 | — | contract-level target-revert atomicity passes in Foundry; local-anvil E2E mines two successful actions. No injected target failure was run on a public testnet | anvil hashes above are successful actions only | none | local ANVIL / public NOT RUN |
| T08/T12 | — | end-to-end injected note vs control plan **not run**; only sanitizer/tripwire unit tests | none | none | not run |

Part 2 (B-12, D-034) ran 28 SIMULATED runs (configs A–D × S1–S5, S7/T15, S9) on `MockChainPort` with
`ScriptedLlm`; results:
[`eval/results/2026-10-20T14-11-32-655Z/summary.md`](../../eval/results/2026-10-20T14-11-32-655Z/summary.md).
Config D: 0 hard-constraint violations, 7/7 acceptance passes. The 12 recorded violations all sit in
the deliberately weak A/C configs. These are model metrics, not on-chain tx hashes.

For the forbidden-SWAP row the expected and observed error names are exactly `ActionNotAllowed`
(action bit off) and `AssetLocked` (token locked), asserted in
`S7/T15 config D rejects direct SWAP; permissive C wiring mines (SIMULATED ablation)`.

## 4. Screenshots / recordings

Captured from the served SIMULATED demo on 2026-10-20 (`docs/submission/screenshots/`):

| File | What it shows |
|---|---|
| `console-desktop-1440.png` | Completed rescue run: plan with two REPAY actions, HF 0.943 → 1.005 and 1.051 → 1.117, cumulative spend $250.16 of $260 (96.21%), two SIMULATED ledger entries marked MINED |
| `console-mobile-390.png` | The same console at 390px: no horizontal overflow, all three regions stacked |
| `console-halt-budget-exhausted.png` | A second run after the first: `HALTED_NEEDS_OWNER — Budget insufficient: $113.43 needed, $9.84 available`, plan with 0 actions, no new ledger entry |
| `console-halt-stale-oracle.png` | Fresh state with a stale oracle price: `HALTED_NEEDS_OWNER — STALE_OR_CONFLICTING_DATA: simulation rejected: StalePrice`, no transaction sent |

`TODO(human)`: the optional ≤5-minute demo video and the public-testnet screenshots are not attached
yet.

## 5. What is still missing

1. A funded public-testnet deployer/owner and RPC; run `scripts/deploy-testnet.sh` with the human
   present.
2. Re-run S1/S2/S7 (and the kill switch) against that deployment with `scripts/start-testnet.sh`,
   then replace the “NOT RUN” row above with explorer-resolvable hashes.
3. Keep the labels honest: `ANVIL` for the local run, `TESTNET` only after the public broadcast.
4. Do not reuse the SIMULATED rows as public-testnet evidence.
