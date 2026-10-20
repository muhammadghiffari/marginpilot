# NOVELTY & PRIOR ART

## What already exists (do not claim)
Liquidation prediction/prevention agents (arXiv:2604.14583) · rule-based rescue keepers (Rescue.ETH, DeFi Saver, Chainlink demo) · wallet permission standards and policy-bound execution (ERC-7715/8196, PACE) · execution-layer budget/slippage invariants (arXiv:2603.10092) · attestation of agent actions (ERC drafts).

## What we test (narrow, falsifiable)
1. **Persistence:** an owner-signed, on-chain, cumulative budget plus asset locks that survive replanning and a compromised executor key, vs an off-chain per-plan check (ablation C vs D).
2. **Shared-budget allocation** across competing positions with a stated loss model, vs independent thresholds (Part 1; may tie).
3. **Where the LLM adds value:** NL mandate compile with clarification, orchestration/replanning, grounded explanations (Part 3) — not allocation math.

## Safe wording
"We evaluate whether ... reduces violations/loss in N reported scenarios compared with baselines X, Y." 
Forbidden: first, unsolved, novel-to-the-world, 100% secure, guarantees.

## Unknowns to state openly
Whether some other project combines all elements; whether results transfer to real protocols; whether the LLM adds numeric value over the deterministic pipeline (we expect it does not for allocation).

## Judge Q&A prep
- *"Isn't this just a spending limit?"* Show S3 (replan, budget not reset) and T15 (executor key bypass blocked on-chain vs allowed in config C).
- *"Why an LLM at all?"* NL→mandate, clarification, tool orchestration under changing state, explanation; allocation is deterministic on purpose.
- *"Is the market real?"* No: simulated lending, real enforcement and real transactions on a public testnet. Stated everywhere.
- *"Why not Aave?"* Cannot drive real positions to liquidation on demand; reproducibility.
