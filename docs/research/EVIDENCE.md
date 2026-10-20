# EVIDENCE — sources, what they support, verification status

Status key: **V-read** = abstract/metadata read during this project's research (existence + abstract checked); **V-search** = found via search, not re-read; **U** = cited from earlier notes, not re-verified (verify before quoting). Before putting any source in the submission, open it and confirm the claim. Never cite a number you have not seen on the page.

| # | Source | Supports | Status | Caveat |
|---|---|---|---|---|
| 1 | Qin, Zhou, Gamito, Jovanovic, Gervais. *An Empirical Study of DeFi Liquidations: Incentives, Risks, and Instabilities.* ACM IMC 2021. arXiv:2106.06389 | Liquidations transfer value from borrowers; fixed-spread design can over-liquidate | V-search | Data is from 2020–21 markets |
| 2 | Spadea & Seneviratne. *From Risk to Rescue: An Agentic Survival Analysis Framework for Liquidation Prevention.* arXiv:2604.14583 (16 Apr 2026) | Closest prior art: agent that predicts liquidation risk (Cox/XGBoost), simulates counterfactual interventions on an Aave v3 simulator, finds minimum capital; 4,882 high-risk profiles; reports zero worsening rate | **V-read (abstract)** | Preprint; single-user intervention, not shared-budget allocation across positions (our reading of the abstract) |
| 3 | *Real AI Agents with Fake Memories: Fatal Context Manipulation Attacks on Web3 Agents.* arXiv:2503.16248 (FC 2026 preproceedings) | Memory/context injection against Web3 agents persists across sessions | V-search | Read the paper for exact results before citing numbers |
| 4 | Yao, Shinn, Razavi, Narasimhan. *τ-bench.* ICLR 2025. arXiv:2406.12045 | Tool-using agents are inconsistent across repeated trials (pass^k) | V-search | Retail/airline domains, models of that time |
| 5 | *PACE: Policy-Attested Contract Execution for Safe AI Agents in DeFi.* arXiv:2608.17220 | Transaction-level policy attestation; sandbox benchmark | V-search | Preprint; sandbox results only |
| 6 | *Execution Is the New Attack Surface…* arXiv:2603.10092 | Execution-layer invariants (budget/slippage/allow-list) for agentic trading | U (summary only) | Read before relying |
| 7 | *SoK: Decentralized Agent Economic Infrastructure.* arXiv:2610.01756 | "Guarantee closure": guarantees from one workflow stage must bind later stages | V-search | Broad SoK, not about wallets specifically |
| 8 | *Toxic Liquidation Spirals.* arXiv:2212.07306 | Aave v2 bad debt episode (Nov 2022) | V-search | Re-check the USD figure on the page |
| 9 | DeXposure. arXiv:2511.22314 | Inter-protocol credit exposure dataset | V-search | Ecosystem-level context only; don't present as proof wallets fail |
| 10 | ERC-7715, ERC-8196 (and related ERC drafts) | Wallet permission / policy-bound execution standards exist | V-search | **Status of ERC-8196 reported inconsistently (Draft vs Final); check eips.ethereum.org** |
| 11 | Rescue.ETH (ETHGlobal showcase) | Rule-based cross-chain Aave rescue keeper exists | V-search | Hackathon project |
| 12 | Chainlink CCIP Liquidation Protector (repo) | Cross-chain liquidation protection demo exists | U | Educational repo per its own notes |
| 13 | DeFi Saver; Aave V4 position managers (official docs) | Per-position automation and delegated operations are commercial | U | Read docs; features change |
| 14 | OWASP Top 10 for LLM Applications — Excessive Agency | Risk category for over-privileged agents | U | |
| 15 | Kaya (2024), *Impact of late payments on SMEs' access to finance*, Economic Modelling 141:106896 | Only needed if team switches to Topic E | V-search | |

## Verification tasks (assign to the human who has time; 30 min)
1. Open sources #2, #3, #5, #6, #10, #12, #13 and write one verified sentence each into `docs/submission/TECH-DOC-TEMPLATE.md` §Related work.
2. Confirm ERC-8196 status on the official EIP page.
3. Replace every `U` with `V-read` or remove the citation.
