# Execution Evidence — MarginPilot

Date: 2026-10-21 · Default demo: **SIMULATED** · Real-EVM proof: **local anvil 31338 and
Ethereum Sepolia 11155111**. The lending market on both chains is **SIMULATED**, not Aave or
another real lending protocol.

This file separates three kinds of evidence:

1. **REAL EVM, LOCAL ANVIL** — transactions mined by a local anvil chain. The hashes resolve on that
   chain's JSON-RPC while it runs; there is no public explorer. This proves the adapter, signing,
   vault enforcement and receipt handling against real EVM bytecode, but it is **not** a public
   testnet and must not be labelled `TESTNET`.
2. **SIMULATED** — in-memory `MockChainPort`; hashes are synthetic and deliberately not listed here.
3. **REAL EVM, PUBLIC TESTNET** — contract deployment and two owner-mandated REPAY transactions
   mined on Ethereum Sepolia, independently checked through a second public RPC.

No hash or address in this file was invented. The local rescue/mandate/shock hashes below are copied from
[`evidence/anvil-e2e-20261021T060254Z.json`](../../evidence/anvil-e2e-20261021T060254Z.json); the
three price-refresh hashes are from that run's console output (the JSON stores the rescue ledger, not
the refresh transactions).

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
| Price refresh (mUSDC / mWETH / mWSTETH) | `0xc73f81b5…`, `0x9f89a08a…`, `0x5066b914…` (console output; not stored in the JSON) |
| Run | `run-mvhph1yl-1`, state `COMPLETED`, two ledger entries `mined` |
| Spend | `$86.57` + `$163.59` = `$250.16` of the `$260` cap (96.21%; gas excluded, reported separately) |
| Health factors | pool 0: `0.942857…` → `1.005002…`; pool 1: `1.051428…` → `1.116670…` |

The hashes are local-anvil receipts: they are real EVM transactions but cannot resolve on a public
explorer. The UI badge for this mode is `ANVIL`, never `TESTNET`.

### Wallet signing

The server-side owner key path is exercised by the anvil E2E and by the Sepolia runs. The
browser-wallet path (prepare → `eth_signTypedData_v4` → relay, with server-side recovery against
the deployment owner) is implemented and covered by unit/API tests
(`apps/agent/test/runtime.test.ts`, `apps/agent/test/api.test.ts`) and was exercised **in a real
browser** against the Sepolia deployment with a stub EIP-1193 signer: mandate **#7** was signed
through the page and mined ([0xe8946541ad85df68a638f62f56916e629e8b73bb50413c7595e15447d84b3961](https://sepolia.etherscan.io/tx/0xe8946541ad85df68a638f62f56916e629e8b73bb50413c7595e15447d84b3961)),
which proves the page's prepare → sign → relay plumbing.

A **real MetaMask extension** run is still not recorded. One attempt in this environment was
rejected with `InvalidOwnerSignature` — the signature did not recover to the deployment owner. The
server now answers with the address that actually signed, so the console shows
“Signed by 0x…, but the deployment owner is 0x…”, and the most likely cause (the wallet signing
with a different account than the one the page requested) is visible instead of guessable.

## 2. Ethereum Sepolia runs (TESTNET; simulator market)

Two public-chain deployments were used, both with the same owner/executor EOAs and both recorded
here. The lending market is our own **simulator** in both cases; only the transactions are real.

### 2a. Browser-driven run on the current deployment (primary proof)

Source of truth: [`evidence/sepolia-ui-e2e-20261022.json`](../../evidence/sepolia-ui-e2e-20261022.json)
(the latest, fixed-agent run) and the earlier
[`evidence/sepolia-ui-e2e-20261021.json`](../../evidence/sepolia-ui-e2e-20261021.json)
and [`deployments/11155111.json`](../../deployments/11155111.json). All **27** receipt summaries in
the JSON were re-read from `https://sepolia.drpc.org` after the broadcasts went out through a
different public RPC; every one has `status: 0x1`. The two REPAY receipts each contain one
`ActionExecuted` log and the mandate receipt contains one `MandateSet` log.

The whole flow was driven **from the console in a browser** (Playwright against the served page):
shock the market with the owner controls → draft the mandate → sign it with the server owner key →
run the rescue.

| Item | Public-chain evidence |
|---|---|
| Vault (enforcer) | [`0xd7FC116f1acaE8cE017114aD7E41F132a998743C`](https://sepolia.etherscan.io/address/0xd7FC116f1acaE8cE017114aD7E41F132a998743C), deployment [receipt](https://sepolia.etherscan.io/tx/0xfbcd9ea5e9cc14daa3bd32695a9779e1fc708b37bc7afeeb12cfe6899c792cea) |
| Owner / executor | `0xdcf89b628aaee7b4C91Ce3d594049E596Dd9c85C` / `0xe219FB396253ba14cD59a91D7C5B163Fd04BbD28` |
| Market reset to the SCENARIOS base state | [mUSDC](https://sepolia.etherscan.io/tx/0xd6fe905b524855328b04bd8ce16eb30056ba185ff9298420dae658913a46b8fa), [mWETH](https://sepolia.etherscan.io/tx/0x0420f9008d7876550a1677fe04a71697b4ad96160564caeae1f76d6288e7f839), [mWSTETH](https://sepolia.etherscan.io/tx/0xf5c2bf4b1d883328d569c81bad30b654e3e47ef6be94910a46fc7011e82902dc), [positions](https://sepolia.etherscan.io/tx/0xd03ecf612d10ebd3745658fc06891afde5baa8da8a9b29e2c6791e985c4783ec) / [positions](https://sepolia.etherscan.io/tx/0x1b6fdd9a6cc3d96f8d47564697c9ecdb119c2209efca44b90b1efa756b741604) |
| UI shock buttons (−20 % on both pools) | [mWETH](https://sepolia.etherscan.io/tx/0x7f15e63cfddb8343d92d017717ee252796e4fc85426e8f5da082a9a3ab54fa79), [mWSTETH](https://sepolia.etherscan.io/tx/0xe9df8e223af79fb175884c231189ab1ca8d7015c163677637d185348fe7ed7b7) |
| Oracle re-stamp (on-chain admin key) | [mUSDC](https://sepolia.etherscan.io/tx/0x23eddb83938bd8eef3c548f32ffeb40d435e156c25a96ce0fbd95284ba9e286e), [mWETH](https://sepolia.etherscan.io/tx/0x5157c713e9c4698c033dacbd236f9636031c3dde003a200b1da05dd283b9a2f5), [mWSTETH](https://sepolia.etherscan.io/tx/0x8be25b6ef17174264aeb2e7a807d8e15b4f0b7b42c6c24c91a9715ae17bd0c7e) |
| Owner-signed mandate #13 | [setMandateWithSig receipt](https://sepolia.etherscan.io/tx/0xe70ba8018e05028f8d91b757a165bcd35b8df823eb95bb0fdadaa9cbfcf2f5a8) |
| REPAY pool 0 | [receipt](https://sepolia.etherscan.io/tx/0x756b52c8f4292c6ef918331d84fa710a31616cf8955faa588eabd82634016e04), `$86.57` |
| REPAY pool 1 | [receipt](https://sepolia.etherscan.io/tx/0xadb2d86c3906fe9a8ec4d5f108732866817160e545becc0ac8078830d5df5fb9), `$163.59` |
| Run | `run-mvihf91d-1`, state **`COMPLETED`**, two ledger entries `mined` with the correct spend ($86.57 and $163.59), audit chain verified |
| On-chain budget and nonce | `spentUsd(13) = 25016000000` USD8 = **$250.16 of $260**; `actionNonce() = 8` |
| Health factors after shocks → after both actions | pool 0: `0.942857… → 1.005002…`; pool 1: `1.051428… → 1.116670…` |

Screenshots of that browser session are in
[`docs/submission/screenshots/testnet-sepolia-desktop.png`](screenshots/testnet-sepolia-desktop.png)
and [`…-mobile.png`](screenshots/testnet-sepolia-mobile.png) (390 px, no horizontal overflow). The
console shows the `TESTNET` badge linking to the vault, a **Deployment** card with explorer links
for all seven contracts, the owner-signed mandate transaction, and every mined action linking to
Etherscan.

Two honest caveats from that session:

1. The **first** browser attempt halted with `HALTED_NEEDS_OWNER` and reason `StalePrice`: the
   market reset had stamped the mUSDC price more than the mandate's 600 s freshness window earlier.
   No transaction was broadcast (the ledger entry shows `$0.00` spend and no hash), the oracle was
   re-stamped by its on-chain admin, and the next attempt completed. The fail-closed path worked.
2. The simulated market was reset to the SCENARIOS base state through the **admin-only simulator
   helpers** (`setPrice`, `seedPosition`, `mint`) before the run — the same state a fresh deployment
   starts from. The reset transactions are listed above.

An earlier rehearsal run on the same deployment is also in the 2026-10-21 JSON (`rehearsal_*`
receipts): mandate #1 and two REPAY actions, both mined, but reported `COMPLETED_PARTIAL` because
the run stopped at the two-block plan-age limit. The agent now replans instead of stopping, which
is why the recorded browser run finishes in one pass.

**Two read-consistency bugs were found and fixed while running this on a public RPC.** A public
RPC load-balances over nodes with different sync heights, so a snapshot assembled from separate
"latest" calls can mix a fresh head with a lagging node's state. That produced (a) a ledger row
that showed `$0.00` for a `$163.59` action and a post-condition check judged against a stale
health factor, and (b) a planner that read the previous mandate's spend and refused to act on a
budget that was still free. The agent now reads every snapshot at one explicit block, re-reads
until a mined action is visible in the state, and **fails closed** if the mandate it read does not
match the vault's active mandate. Regression tests:
`apps/agent/test/orchestrator.test.ts` ("a stale post-action read is retried, never recorded as a
$0 spend", "a mandate that does not match the active mandate on chain fails closed").

### 2b. First API-driven run on the earlier deployment

Source of truth: [`evidence/sepolia-e2e-20261021.json`](../../evidence/sepolia-e2e-20261021.json) and
the archived record [`deployments/11155111-run1.json`](../../deployments/11155111-run1.json). All 15
receipt summaries were fetched from `https://sepolia.drpc.org`; each has `status: 0x1`.

| Item | Public-chain evidence |
|---|---|
| Vault | [`0x2014c1F2f3175f46f9b2158fe68510Dc3F05fFA1`](https://sepolia.etherscan.io/address/0x2014c1F2f3175f46f9b2158fe68510Dc3F05fFA1), deployment [receipt](https://sepolia.etherscan.io/tx/0x839337f711ac2110e5963fd32d7328fbb081f6e3d3364204b770c7be604d3436) |
| Oracle shocks | [mWETH](https://sepolia.etherscan.io/tx/0x8293309987708e48ce0c3af629b3cbcbf68ac65fb93059ab53d8e9b29a9b30b6), [mWSTETH](https://sepolia.etherscan.io/tx/0x99a5d2e8430a120694228605ede8e8953aa55e0ed2391577b63aafd55ae8d228) |
| Owner-signed mandate #1 | [setMandateWithSig receipt](https://sepolia.etherscan.io/tx/0xa01bc76d034806cb9f93b924278ee49d2509f3ad21b8ea64e2a61548b0222e1d) |
| REPAY pool 0 | [receipt](https://sepolia.etherscan.io/tx/0x72abb3c8c2aa09cd3a01fcc5b83354c8d6e5576450d1d4881ca3d7fa5de640c2), `$86.57` |
| REPAY pool 1 | [receipt](https://sepolia.etherscan.io/tx/0xe43f22d952ee1b8f72c0fbc3d9e205578ebff82c6a1fd44fe49ae779caca103a), `$163.59` |
| Runs | `run-mvhvo8xg-1` and `run-mvhvtky7-2`, both `COMPLETED_PARTIAL`; spend `$250.16` of `$260` |

Run 1 mined the first action and then **refused** its second action when the plan aged three blocks
(limit: two); it never resubmitted the first transaction. Run 2 replanned against the updated nonce
and mined the second action. Both reported `COMPLETED_PARTIAL` because pool 0 stayed below the
planner's stricter stress target with only `$9.84` of budget left. The replan-on-stale behaviour
described in §2a was added afterwards and is what the browser run in §2a exercises.

`bash scripts/verify-sepolia-bytecode.sh` independently matched the exact compiled creation input
and successful on-chain receipt for **all seven contracts** of the §2b deployment against
`https://sepolia.drpc.org`. The six simulator contracts of that deployment use the pinned
`sepolia_simulator_20261021` Foundry profile; the vault uses the smaller default via-IR profile.

### 2c. How the deployments were made (and what still fails)

The `scripts/deploy-testnet.sh` Forge path **did not** produce either deployment. Two Forge
broadcast attempts ran out of gas; the original vault bytecode also exceeded the observed
16,777,216 gas-per-transaction execution ceiling on this Sepolia network. The successful
deployments used a temporary Foundry-compatible encrypted keystore (no raw key on the command line),
explicit per-transaction `cast send` gas limits for the simulator contracts, and a smaller vault
compiled with `via_ir = true`, `optimizer_runs = 1`. Do not rerun `deploy-testnet.sh` expecting
these addresses or a successful Sepolia deployment; it now fails closed for chain `11155111`
before any RPC or broadcast. A reusable guarded explicit-gas deploy wrapper is still missing.

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
| T07 | — | contract-level target-revert atomicity passes in Foundry; anvil and Sepolia E2Es mined successful actions. No injected target failure was run on a public testnet | public success hashes above; no public failure injection | Sepolia links above | local ANVIL / public TESTNET |
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
| `testnet-sepolia-desktop.png` | **Public testnet**: the same console against the Sepolia deployment — `TESTNET · sepolia.etherscan.io` badge, mandate #2 active with its signed transaction, plan with two REPAYs (HF 0.943 → 1.005, 1.051 → 1.117), spend $250.16 of $260, `Deployment` card with explorer links for all seven contracts, ledger with two MINED actions linking to Etherscan |
| `testnet-sepolia-mobile.png` | The same Sepolia session at 390px: no horizontal overflow, all regions stacked |

`TODO(human)`: the optional ≤5-minute demo video is not attached yet. The public-testnet
screenshots above are attached.

## 5. What is still missing

1. Public-testnet S2/S7, the injected target-failure and kill-switch scenarios have **not** been
   exercised; the four real REPAY transactions above are the only on-chain rescue actions evidenced.
2. Automate the explicit-gas deployment path; Forge's current gas estimates are inadequate on this
   Sepolia network. The local `.env` still points at anvil; public settings were supplied through
   an ignored, temporary shell config file.
3. Record the optional ≤5-minute demo video; the Sepolia UI walkthrough itself is captured in the
   two screenshots and reproducible with `apps/web/test/browser_testnet.py`.
4. Keep the labels honest: `ANVIL` locally, `TESTNET` only for Sepolia, and **SIMULATED lending
   market** in both modes. The browser-wallet extension path is still unit/API-tested only.
