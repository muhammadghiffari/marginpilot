#!/usr/bin/env python3
"""
Worked example for the MarginPilot rescue optimizer (reference implementation, NOT production code).

Purpose
  1. Pin the loss model and optimizer semantics so TypeScript (packages/core) can be
     unit-tested against these exact numbers.
  2. Show WHY a global allocation can differ from per-position threshold automation.

Honesty note
  The fixture below is CONSTRUCTED to be a case where the two approaches differ.
  It is a unit-test fixture, not evidence that global allocation wins in general.
  Real evidence comes from the seeded randomized study in docs/eval/EVALUATION-PLAN.md (Part 1).

Run:  python3 eval/worked_example.py          (prints a table; exits non-zero if an assertion fails)
"""
from dataclasses import dataclass
from itertools import product
from math import ceil

CENT = 100  # amounts are rounded UP to whole cents of USDC


@dataclass(frozen=True)
class Pool:
    name: str
    lt: float          # liquidation threshold (0.825 == 8250 bps)
    bonus: float       # liquidation bonus (0.05 == 500 bps)
    close_factor: float
    collateral_units: float
    collateral_price: float
    debt_usdc: float   # USDC price fixed at 1.0


A = Pool("A (mWETH/mUSDC)", 0.825, 0.05, 0.5, 1.0, 1600.0, 1400.0)
B = Pool("B (mWSTETH/mUSDC)", 0.800, 0.07, 0.5, 2.0, 1840.0, 2800.0)

STRESS = 0.10      # further collateral price drop used by the stress term
LAMBDA = 0.5       # weight of the stress term in expected loss
HF_SAFE_EPS = 1.005  # "just safe" = HF >= 1.005 (avoids float-equality edge at exactly 1.0)
HF_TARGET = 1.10
BUDGET = 260.0     # mandate.maxTotalSpend - already spent
RESERVE = 400.0    # liquid USDC in vault
MIN_RESERVE = 100.0
SPENDABLE = min(BUDGET, RESERVE - MIN_RESERVE)


def hf(p: Pool, debt: float, price_mult: float = 1.0) -> float:
    if debt <= 0:
        return float("inf")
    return p.collateral_units * p.collateral_price * price_mult * p.lt / debt


def loss_if_liquidated(p: Pool, debt: float, price_mult: float) -> float:
    return p.close_factor * debt * p.bonus if hf(p, debt, price_mult) < 1.0 else 0.0


def expected_loss(p: Pool, repay: float) -> float:
    d = p.debt_usdc - repay
    return loss_if_liquidated(p, d, 1.0) + LAMBDA * loss_if_liquidated(p, d, 1.0 - STRESS)


def repay_to_reach(p: Pool, hf_goal: float, price_mult: float = 1.0) -> float:
    """Smallest repay (rounded up to a cent) such that HF at price_mult >= hf_goal."""
    max_debt = p.collateral_units * p.collateral_price * price_mult * p.lt / hf_goal
    r = max(0.0, p.debt_usdc - max_debt)
    return ceil(r * CENT - 1e-9) / CENT


def candidate_levels(p: Pool):
    levels = {
        "none": 0.0,
        "safe-now": repay_to_reach(p, HF_SAFE_EPS, 1.0),
        "safe-stress": repay_to_reach(p, HF_SAFE_EPS, 1.0 - STRESS),
        "target": repay_to_reach(p, HF_TARGET, 1.0),
    }
    out = {}
    for k, v in levels.items():           # de-duplicate equal amounts, keep first name
        out.setdefault(round(v, 2), k)
    return sorted(((v, k) for v, k in out.items()))


def global_optimum():
    best = None
    for (ra, na), (rb, nb) in product(candidate_levels(A), candidate_levels(B)):
        if ra + rb > SPENDABLE + 1e-9:
            continue
        el = expected_loss(A, ra) + expected_loss(B, rb)
        key = (round(el, 6), round(ra + rb, 2), na, nb)  # deterministic tie-break: loss, spend, names
        if best is None or key < best[0]:
            best = (key, ra, rb, na, nb, el)
    return best


def local_threshold_baseline(trigger=1.05):
    """Per-position automation: if HF < trigger repay up to HF_TARGET, in ascending-HF order,
    limited by what is still spendable. No view of other positions."""
    remaining = SPENDABLE
    repay = {A.name: 0.0, B.name: 0.0}
    for p in sorted((A, B), key=lambda q: hf(q, q.debt_usdc)):
        if hf(p, p.debt_usdc) < trigger:
            need = repay_to_reach(p, HF_TARGET)
            r = min(need, remaining)
            repay[p.name] = r
            remaining -= r
    return repay


if __name__ == "__main__":
    print("State before any action")
    for p in (A, B):
        print(f"  {p.name}: HF={hf(p, p.debt_usdc):.4f}  "
              f"loss_now={loss_if_liquidated(p, p.debt_usdc, 1.0):.2f}  "
              f"loss_stress={loss_if_liquidated(p, p.debt_usdc, 1.0 - STRESS):.2f}")
    print(f"Spendable = min(budget {BUDGET}, reserve {RESERVE} - min_reserve {MIN_RESERVE}) = {SPENDABLE}")
    print("\nCandidate repay levels (USDC)")
    for p in (A, B):
        print(f"  {p.name}: {candidate_levels(p)}")

    loc = local_threshold_baseline()
    el_loc = expected_loss(A, loc[A.name]) + expected_loss(B, loc[B.name])
    key, ra, rb, na, nb, el_opt = global_optimum()

    print("\nLocal threshold automation (trigger HF<1.05, repay to HF 1.10)")
    print(f"  repay A={loc[A.name]:.2f}  B={loc[B.name]:.2f}  spend={sum(loc.values()):.2f}  expected_loss={el_loc:.2f}")
    print("Global exhaustive optimizer")
    print(f"  repay A={ra:.2f} ({na})  B={rb:.2f} ({nb})  spend={ra + rb:.2f}  expected_loss={el_opt:.2f}")

    # Pinned expectations for the TypeScript unit test (see docs/spec/OPTIMIZER.md)
    assert abs(hf(A, A.debt_usdc) - 0.942857) < 1e-5
    assert abs(hf(B, B.debt_usdc) - 1.051429) < 1e-5
    # Hand-checked: A safe-now = 1600*0.825/1.005 -> max debt 1313.43 -> repay 86.57
    #               B safe-stress = 2*1840*0.9*0.8/1.005 -> max debt 2636.41 -> repay 163.59
    #               A safe-stress = 217.92, B target = 123.64 (all rounded UP to cents)
    assert candidate_levels(A) == [(0.0, 'none'), (86.57, 'safe-now'), (200.0, 'target'), (217.92, 'safe-stress')]
    assert candidate_levels(B) == [(0.0, 'none'), (123.64, 'target'), (163.59, 'safe-stress')]
    assert (ra, rb) == (86.57, 163.59), (ra, rb)
    assert abs((ra + rb) - 250.16) < 1e-9
    assert abs(el_opt - 16.4179) < 1e-3, el_opt          # 0.5 * (0.5 * 1313.43 * 0.05)
    assert loc[A.name] == 200.0 and loc[B.name] == 0.0, loc
    assert abs(el_loc - 64.0) < 1e-9, el_loc             # A: 0.5*(0.5*1200*0.05)=15 ; B none: 0.5*98=49
    print("\nOK: pinned numbers match.")
