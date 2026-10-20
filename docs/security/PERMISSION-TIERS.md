# PERMISSION TIERS (our design; not an official standard)

| Tier | Name | What the agent may do | Enforced by |
|---|---|---|---|
| L0 | Read-only | read positions, prices, vault state, audit | no key needed; `ChainPort` read methods |
| L1 | Plan & simulate | compute plans, `simulate` actions (`eth_call`), explain | code path has no submit; vault untouched |
| L2 | Bounded execution | submit plan actions within the **owner-signed mandate** | `MandateVault.execute` checks #1–#16 |
| L3 | Owner decision required | anything outside the mandate: more budget, new target, unlock asset, extend expiry, unpause | agent → `HALTED_NEEDS_OWNER`; only owner signature/transaction proceeds |

Rules
1. The agent cannot raise its own tier: no tool creates or edits a mandate; the vault accepts mandate changes only from the owner (direct or EIP-712 signature).
2. Stopping is always allowed: executor and owner may `pause()`; only the owner may `unpause()`.
3. Uncertain state (stale data, conflicting data, unknown tx status) ⇒ fail closed: wait or L3, never "try anyway".
4. The UI shows the current tier and why (e.g. "L3: budget short by $X").
5. Demo-owner mode (server-signed) is labelled in the UI; wallet mode is the real owner flow.

Where it appears in the submission: Security Self-Assessment §Permission tiers; UI badge; `ADVERSARIAL-TESTS.md` T10, T11, T16.
