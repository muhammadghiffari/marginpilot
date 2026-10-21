# Deck outline — MarginPilot (≤ 10 minutes)

FinTechathon 2026 · Topic F · International Track. Every slide names its source. Numbers are the
generated Part 1 output (`eval/results/2026-10-20T09-44-04-427Z/`) and Part 2 SIMULATED output
(`eval/results/2026-10-20T14-11-32-655Z/`). Sepolia proof is separate from these SIMULATED studies.

| # | Time | Slide | Content | Source |
|---|---|---|---|---|
| 1 | 0:00–0:30 | Title & thesis | "An agent may act; only the owner's mandate may authorize." Team, Topic F, one-line product. | `README.md`; `docs/prd/PRD.md` §1 |
| 2 | 0:30–1:15 | Problem | Several positions compete for one stablecoin balance; a hot-key bot or unconstrained LLM is the wrong trust model. | `docs/prd/PRD.md` §2; `docs/spec/ARCHITECTURE.md` trust zones |
| 3 | 1:15–2:00 | Three trust zones + permission tiers | LLM (untrusted) → agent process (not sole enforcer) → vault (enforcer). L0–L3 table; agent cannot raise its own tier. | `docs/spec/ARCHITECTURE.md`; `docs/security/PERMISSION-TIERS.md` |
| 4 | 2:00–2:50 | Mandate & 16 checks | EIP-712 struct, expiry, cumulative budget, locks, freshness/deviation, slippage, post-conditions. Show the check-order table and one revert. | `docs/spec/CONTRACTS.md` §execute; `contracts/src/MandateVault.sol` |
| 5 | 2:50–3:40 | Agent loop | Fixed tools only; plan bound to block/id/nonce; simulate before submit; replan only with remaining budget; unknown tx → `getTx`, never resend; halt on stale/conflict. | `docs/spec/AGENT-DESIGN.md` §2; `apps/agent/src/orchestrator.ts` |
| 6 | 3:40–5:10 | **Live demo** (two variants) | **Public testnet**: open the served console on Sepolia — the `TESTNET` badge links the vault, the Deployment card links every contract, shock the market, sign the mandate, run the rescue, and the ledger links each mined action to Etherscan. **Fallback (SIMULATED)**: the same page preloaded with a mandate → Run rescue → plan with two REPAYs. Say "SIMULATED lending market" out loud; the protocol is our own simulator. | `evidence/sepolia-ui-e2e-20261021.json`; `docs/submission/screenshots/testnet-sepolia-desktop.png`; `apps/web/test/browser_testnet.py`; `apps/agent/test/orchestrator.test.ts` S1 |
| 7 | 5:10–6:10 | Break it | Scenario lab: stale oracle → `STALE_OR_CONFLICTING_DATA` halt, zero transactions; a second run after the first halts with "Budget insufficient" because the cumulative cap is not reset. Show the config C vs D SWAP ablation: permissive wiring mines, mandate wiring returns `ActionNotAllowed` / `AssetLocked`. | `docs/spec/SCENARIOS.md` S5/S7/S9; `orchestrator.test.ts` S7/T15; `docs/submission/screenshots/console-halt-stale-oracle.png`, `console-halt-budget-exhausted.png` |
| 8 | 6:10–7:10 | Evaluation Part 1 | 500 seeded constructed two-pool cases. Realized loss B−A mean −$13.9234, 95% CI [−$17.6227, −$10.3966], W/T/L 118/158/224. Say why B still loses 224 cases (discrete levels vs A's partial target). Part 2 is SIMULATED on MockChainPort: 28 runs, config D 0 violations and 7/7 acceptance; Part 3 not run. | `eval/results/2026-10-20T09-44-04-427Z/summary.md`; `eval/results/2026-10-20T14-11-32-655Z/summary.md`; `docs/eval/EVALUATION-PLAN.md` |
| 9 | 7:10–8:10 | Security status | T01–T18: passes, partials (T08/T12), not run (T13/T14). 328 passing tests (144 Foundry incl. the adversarial suite); 7 scenarios × 1 run plus 28 SIMULATED ablation runs; unaudited; no formal verification; a browser-driven Sepolia rescue finished `COMPLETED` with two real REPAYs on a simulated market. | `docs/submission/SECURITY-SELF-ASSESSMENT.md` §4 and §4.1; `evidence/sepolia-ui-e2e-20261021.json`; `scripts/verify-all.sh` output |
| 10 | 8:10–8:50 | Honest limits | The Sepolia run proves real transactions, not real DeFi positions; the lending market is a simulator. Public S2/S7 and the kill switch were not broadcast; the browser-wallet extension path is unit-tested only; the live LLM call is unverified; a guarded explicit-gas deploy script is still missing. | `docs/submission/EXECUTION-EVIDENCE.md`; `docs/security/KNOWN-RISKS.md`; `STATUS.md` |
| 11 | 8:50–9:30 | What judges can verify now | Clone, eight commands, `pnpm -r test`, `scripts/verify-all.sh`, generated summary; point to the three submission documents. | `README.md`; `docs/submission/*` |
| 12 | 9:30–10:00 | Close / Q&A | Restate the boundary: the vault, not the model, enforces spend. Distinguish public transaction proof from the simulated lending market. | `docs/research/NOVELTY-AND-PRIOR-ART.md` Q&A prep |

## Delivery notes

- Budget 9:30 of content; do not overrun into the 10:00 limit.
- The Sepolia variant is a **real** transaction demo: every link in the console resolves on
  Etherscan. The *lending market* is still simulated — say so plainly, and do not imply a real
  protocol, real funds or a rescue of real positions.
- The only live *failure* to demonstrate is **simulated**: stale oracle halt and the SWAP ablation.
- If the local server fails, use the B-11 screenshots and the generated `summary.md`; state that the
  demo is simulated.
- Do not claim "first", "novel", "secure", "guaranteed", or "rescued real positions".
