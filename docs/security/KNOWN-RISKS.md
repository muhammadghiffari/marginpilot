# KNOWN RISKS (honest list; extend with anything you discover while building)

Rules: be specific; state the impact and the mitigation actually implemented; state what is **not** handled. Judges reward candor more than claims.

| # | Risk | Impact | Mitigation implemented | Not handled / remaining |
|---|---|---|---|---|
| R1 | Contracts unaudited, written in a day | funds loss on mainnet use | testnet only; Foundry tests + fuzz; adversarial suite | no formal verification, no external audit — **do not use with real funds** |
| R2 | Simulated lending market and admin-set oracle | results don't transfer to real protocols | self-deployed sim documented as a simulation; loss model mirrors sim | real protocol interest, partial liquidations, oracle lag, MEV not modeled |
| R3 | Executor is a hot key on a server | key leak lets attacker act within mandate | gate limits damage to the mandate; pause/revoke; funds withdrawable by owner | attacker can still spend up to the remaining budget on allowed actions |
| R4 | Demo-owner key lives on the server | server compromise lets attacker set mandates | testnet only; labelled; wallet mode available (P1) | not suitable for production custody |
| R5 | Gas not counted in on-chain budget | spend slightly above stated "budget" in total cost | tracked off-chain per run and reported separately | no on-chain gas accounting |
| R6 | USD valuation depends on oracle | wrong/stale price mis-sizes limits | freshness and deviation checks; fail closed | oracle compromise out of scope |
| R7 | LLM variance and third-party dependency | inconsistent plan text/choices; provider downtime | numbers from code, gate independent, `ScriptedLlm` for tests, pass^k report | provider outage stops live demo (fallback: recorded run in evidence) |
| R8 | Prompt/memory injection | model might be nudged to odd choices | untrusted delimiting, tool allow-list, plan binding, on-chain gate | model-level robustness is not guaranteed; we rely on the gate |
| R9 | Single chain, single protocol, 2 pools | narrow generality | explicit scope | no multi-chain, no real Aave |
| R10 | Public demo abuse | cost burn, spam | rate limits, provider usage cap, demo-only controls | determined DoS not handled |
| R11 | EOA-only signature verification | no ERC-1271 smart-account owners | documented | contract-wallet owners unsupported |
| R12 | Evaluation uses constructed scenarios | may favor our design | seeded randomized study reports ties/losses; baselines defined before running | external benchmark absent |
| R13 | Simulator admin can seed arbitrary positions (`seedPosition`, admin-only, deploy-time, mock-only; D-033), set prices and pause pools | a compromised deployer key can fabricate the demo market state | `LendingSim` is explicitly a simulator (D-002); local/testnet only; the vault's mandate and check #16 remain the enforced layer | not a real lending protocol; do not use with real funds |
| R14 | Role probe only identifies the lending simulator | a SWAP at an allowed but non-swap target fails untyped (D-029 `Unknown`) instead of `TargetNotAllowed`; a lending action at a non-`LendingSim` target is named | the mandate's owner-signed `allowedTargets` bounds targets; wrong-role calls revert atomically (no spend, no approval left); the vault probes `LendingSim.pools` for lending actions and for SWAPs at a pool-answering target | a SWAP at a random non-`LendingSim`/non-`MockSwap` target cannot be positively identified because `swapTarget` is not in the mandate; it fails at the target call and the TS layer records `Unknown`; the TS mirror is stricter |

Add rows as you find issues. Link each to a test or a code reference where possible.
