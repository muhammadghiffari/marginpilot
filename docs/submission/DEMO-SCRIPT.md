# DEMO SCRIPT (5 minutes; adapt to the allowed format)

1. **(0:00) Hook** — "Agents with wallets are risky; we let one act, but the limits live on-chain."
2. **(0:20) Instruction** — type: "Protect my loans. Spend at most $260, never touch my ETH, keep $100 in reserve." Show clarification behavior once with an ambiguous prompt first (optional).
3. **(1:00) Mandate card** — point out assumptions the agent filled; sign & activate. Show tx hash.
4. **(1:30) Shock** — Scenario lab: −20% prices. Positions turn red.
5. **(2:00) Plan & explanation** — two actions, why, what's *not* done, remaining budget.
6. **(2:30) Execute** — live; HF bars improve; budget bar moves; tx links.
7. **(3:15) Replan (S3)** — second shock mid-run → agent replans, budget continues from remaining, not reset.
8. **(3:45) Break it (S7/T15)** — script uses the executor key to sell the locked ETH → revert `AssetLocked`/`ActionNotAllowed` shown on-chain; same attack against the off-chain-only config succeeds (ablation).
9. **(4:20) Evidence** — eval table (loss, violations, false completion), known risks slide.
10. **(4:50) Close** — what's real vs simulated; what we did not claim.
Backup: pre-recorded run + evidence page if the LLM/RPC fails.
