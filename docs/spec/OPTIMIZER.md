# OPTIMIZER — rescue planner spec (owner: Dev B, `packages/core/src/optimizer.ts`)

**This is not the novelty.** With ≤5 positions the allocation problem is a small multiple-choice knapsack; exhaustive search is exact and cheap. It must be deterministic, pure, and tested against `eval/worked_example.py`. The LLM never computes any number in this file.

## 1. Inputs
`positions[]`, `prices`, `mandate` (remaining budget = `maxTotalSpendUsd - spentUsd`), vault `balances`, `params`:
| param | default | meaning |
|---|---|---|
| `stressPct` | 10% | further collateral drop used by the stress term |
| `lambda` | 0.5 | weight of the stress term; **interpreted as the probability that the stress shock happens** (so expected loss is a real expectation under that assumption) |
| `hfSafeEps` | 1.005 | "safe" means HF ≥ 1.005 (avoids float-equality edge at exactly 1.0) |
| `hfTarget` | 1.10 | user-visible target level |
| `centRounding` | 0.01 USDC | repay amounts are rounded **up** to cents |

`spendable = min(mandateRemaining, liquidReserve - minLiquidReserve)`, all in USD; only reserve-token (mUSDC) repays are planned in P0. SWAP/SUPPLY planning is P1 (not needed for the core scenarios; the adversary tests exercise them directly).

## 2. Loss model (explicit assumptions)
Single-step fixed-spread liquidation, no interest:
- `HF(p, debt, m) = collateralUnits * price * m * lt / debt`, with price multiplier `m` (1.0 now, `1 - stressPct` stress).
- `loss(p, debt, m) = closeFactor * debt * liqBonus` if `HF < 1`, else `0` (the bonus transferred to the liquidator, USD).
- `expectedLoss(p, repay) = loss(p, D-repay, 1) + lambda * loss(p, D-repay, 1-stressPct)`.
It mirrors `LendingSim.liquidate`, so the evaluation can compare model loss with the realized `bonusUsd8` from `Liquidated` events.

## 3. Candidate levels per position
`none` (0) · `safe-now` (min repay for HF ≥ `hfSafeEps` at m=1) · `safe-stress` (min repay for HF ≥ `hfSafeEps` at m=1-stressPct) · `target` (min repay for HF ≥ `hfTarget`). De-duplicate equal amounts (keep first name in that order), drop levels whose amount exceeds the position's debt.

## 4. Search and tie-breaks
Enumerate the Cartesian product (≤ 4^n, n ≤ 5). Feasible iff total ≤ `spendable`. Choose the minimum by the tuple `(round(expectedLoss, 6), round(totalSpend, 2), levelNames lexicographic)`. Deterministic: same input ⇒ byte-identical plan.
If no position can change its loss within budget → `Plan.actions = []`, `haltReason = BUDGET_INSUFFICIENT` with the cheapest useful amount. Positions left at level `none` while a better level was infeasible go to `unsavedPools`.

## 5. Plan → Actions
Each chosen repay becomes `Action{ REPAY, target: LendingSim, poolId, tokenIn: mUSDC, amount, quotedPriceUsd8: oracle price at planning, deadline: now + 120s, nonce: vault.actionNonce + i }` (nonces consecutive; if one action is rejected the whole remaining plan is discarded and re-planned — no skipping nonces).

## 6. Pinned fixture (unit test **must** reproduce; independent hand-check in `eval/worked_example.py`)
Prices after shock: mWETH 1600, mWSTETH 1840, mUSDC 1.00. Pool A: 1.0 mWETH collateral, debt 1400 mUSDC (lt 0.825, bonus 5%). Pool B: 2.0 mWSTETH, debt 2800 (lt 0.80, bonus 7%). Close factor 0.5. Reserve 400, minReserve 100, budget 260 ⇒ `spendable = 260`.
- HF now: A = 0.942857 (liquidatable), B = 1.051429.
- Levels: A `[0 none, 86.57 safe-now, 200.00 target, 217.92 safe-stress]`; B `[0 none, 123.64 target, 163.59 safe-stress]`.
- **Global optimum:** A = 86.57, B = 163.59, spend 250.16, expectedLoss ≈ 16.4179.
- **Local threshold automation** (trigger HF<1.05, repay to HF 1.10, ascending HF): A = 200.00, B = 0 (B's HF 1.0514 is above the trigger), expectedLoss = 64.00.

> This fixture was **constructed** to show a case where the two differ. It validates the code; it is **not** evidence that global allocation wins in general. Evidence = EVALUATION Part 1 (seeded random scenarios, where ties and baseline wins must also be reported).

## 7. Required tests
Fixture above; determinism (shuffled position order ⇒ same plan); rounding up never under-repays; budget exhausted ⇒ `unsavedPools`; zero-debt position ignored; property test: chosen plan's expected loss ≤ every other feasible combination (brute-force cross-check on random inputs); decimals handled (USDC 6 dec in, usd8 out).
