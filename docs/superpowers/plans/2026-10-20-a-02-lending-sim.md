# A-02 LendingSim Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development or superpowers:executing-plans. Steps use checkbox (`- [ ]`) syntax.

**Goal:** A two-pool lending simulator whose health factors match the worked example and whose liquidation event exposes realized loss.

**Architecture:** One contract, admin-configured pools, per-pool per-user collateral/debt, oracle-valued HF in wad. `liquidate` transfers debt in and collateral out and emits `Liquidated`.

**Tech Stack:** Solidity 0.8.24, Foundry, `MockERC20`/`MockOracle` from A-01.

**Spec:** `docs/spec/CONTRACTS.md` §2.3, §4; `eval/worked_example.py`; `docs/spec/SCENARIOS.md` base state; `tasks/DEV-A.md` A-02.

## Global Constraints

- Pools: 0 = mWETH/mUSDC (8250, 500, 5000); 1 = mWSTETH/mUSDC (8000, 700, 5000).
- Prices: mUSDC 1e8, mWETH 2000e8 before shock, mWSTETH 2300e8; shock 1600e8 / 1840e8.
- Positions: pool 0 = 1.0 mWETH / 1400 mUSDC; pool 1 = 2.0 mWSTETH / 2800 mUSDC.
- HF is wad, `type(uint256).max` when debt is 0; liquidatable iff HF < 1e18.
- `setPoolPaused` blocks `supply`/`borrow`/`repay` only (not `liquidate`).
- No interest accrual; admin-controlled oracle (D-002).

## Review Focus

- Decimal scaling must use `10 ** uint256(decimals)`; a `uint8` scale silently breaks 18-dec tokens.
- Borrow at HF exactly 1e18 is allowed; one unit more reverts.
- `repay` pulls `min(amount, debt)`, never overcharges.
- `liquidate` caps seized collateral at the user's balance and emits `bonusUsd8` from `repayUsd`, not from seized value.

---

### Task 1: `LendingSim` + tests

**Files:**
- Create: `contracts/src/LendingSim.sol`
- Create: `contracts/test/LendingSim.t.sol`

**Interfaces:**
- Produces: `LendingSim(address oracle)`, `setPool(uint8,address,address,uint32,uint32,uint32)`, `pools(uint8)` getter, `supply(uint8,uint256)`, `borrow(uint8,uint256)`, `repay(uint8,uint256)`, `healthFactor(uint8,address)`, `positionOf(uint8,address)`, `liquidate(uint8,address,uint256)`, `setPoolPaused(uint8,bool)`; errors `NotAdmin`, `InvalidPool(uint8)`, `PoolPaused(uint8)`, `BorrowTooMuch`, `NotLiquidatable`, `CloseFactorExceeded`; event `Liquidated(uint8 indexed pool, address indexed user, address indexed liquidator, uint256 repayAmount, uint256 collateralSeized, uint256 bonusUsd8)`.

- [ ] **Step 1: Write failing tests** in `contracts/test/LendingSim.t.sol`: shock HF `0.942857e18`/`1.051429e18` (tolerance 1e12), zero-debt max, borrow at exactly HF 1 allowed then `BorrowTooMuch`, repay caps at debt, paused pool reverts supply/borrow/repay, liquidate event `(700e6, 459375000000000000, 35e8)`, `NotLiquidatable`, `CloseFactorExceeded`, liquidate still works while paused.
- [ ] **Step 2: Run** `cd contracts && forge test --match-contract LendingSim -vv`; expect build failure.
- [ ] **Step 3: Implement** `LendingSim.sol` per the interfaces; seed the simulator with mUSDC in tests before borrowing.
- [ ] **Step 4: Run** the same command; expect all tests PASS.
- [ ] **Step 5: Commit** `feat(contracts): add LendingSim (A-02)`.
