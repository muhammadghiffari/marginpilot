# D-025 — Dev A interface review / PR note

Owner-approved seam clarification for B-05/B-06. Please review INTERFACES §5 alongside CONTRACTS §2.5.

- `checkAction` keeps five arguments and adds explicit caller/executor, decimals and pool-token metadata.
- Checks #1–#15 run before target effects; pure `checkPostConditions` runs #16 after tentative effects.
- Mock failures roll back balances, positions, spend and nonce. Viem wiring must supply trusted metadata and fresh post-reads.
- No Solidity struct, ABI, check order, error name or ChainPort change.
- B-05 will include a case for each ordered check and boundary-positive coverage; B-06 will cover atomic rollback.

Validation before this commit: `bash scripts/verify-all.sh` (results recorded in commit workflow). Remote PR publication is tracked separately; this file is the review handoff, not evidence of Dev A approval.
