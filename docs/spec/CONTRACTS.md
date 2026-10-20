# CONTRACTS — on-chain spec (owner: Dev A)

Solidity ^0.8.24, Foundry. Everything here is a **test/demo market**. The enforcement layer (`MandateVault`) is the real contribution; the lending market is a self-deployed simulator so price shocks are controllable and reproducible.

> Single source of truth for names. If you rename anything, update `docs/spec/INTERFACES.md`, tests and `docs/security/ADVERSARIAL-TESTS.md` in the same PR.

## 1. Conventions
- USD values: `usd8` = USD × 1e8 (Chainlink style). Health factor: `wad` = 1e18 means HF 1.0. Fractions in bps (10000 = 100%).
- Tokens: `mUSDC` 6 decimals, `mWETH` 18, `mWSTETH` 18. **Decimals must be handled explicitly; there is a mandatory test for a 6-dec vs 18-dec valuation.**
- No interest accrual, no oracle manipulation resistance, no upgradeability. Say so in `KNOWN-RISKS.md`.

## 2. Contracts

### 2.1 `MockERC20(name, symbol, decimals)`
Standard ERC20 + `mint(address to, uint256 amount)` open to the deployer/admin only (testnet faucet via script).

### 2.2 `MockOracle`
```
setPrice(address token, uint256 priceUsd8)                       // admin; updatedAt = block.timestamp
setPriceAt(address token, uint256 priceUsd8, uint256 updatedAt)  // admin; for stale-price scenarios
getPrice(address token) view returns (uint256 priceUsd8, uint256 updatedAt)
```
Reverts `UnknownToken(token)` if never set.

### 2.3 `LendingSim`
Pools (set by admin at deploy):
| poolId | collateral | debt | ltBps | liqBonusBps | closeFactorBps |
|---|---|---|---|---|---|
| 0 | mWETH | mUSDC | 8250 | 500 | 5000 |
| 1 | mWSTETH | mUSDC | 8000 | 700 | 5000 |

```
supply(uint8 pool, uint256 amount)          // msg.sender collateral +amount (pulls token)
borrow(uint8 pool, uint256 amount)          // reverts if HF after < 1e18
repay(uint8 pool, uint256 amount)           // msg.sender debt -min(amount, debt)
healthFactor(uint8 pool, address user) view returns (uint256 wad)   // type(uint256).max if debt==0
positionOf(uint8 pool, address user) view returns (uint256 collateral, uint256 debt)
liquidate(uint8 pool, address user, uint256 repayAmount) returns (uint256 collateralSeized)
setPoolPaused(uint8 pool, bool paused)      // admin; repay/supply/borrow revert PoolPaused (failure injection, scenario S4)
pools(uint8 pool) view returns (address collateralToken, address debtToken, uint32 ltBps, uint32 liqBonusBps, uint32 closeFactorBps, bool paused)
```
Math (all via oracle prices; document rounding direction in code comments):
- `HF = collateralUsd * ltBps / 10000 / debtUsd` (as wad). Liquidatable iff `HF < 1e18`.
- `liquidate`: requires `HF < 1e18` and `repayAmount <= debt * closeFactorBps / 10000`. `repayUsd = repayAmount * debtPrice`; `seizeUsd = repayUsd * (10000 + liqBonusBps) / 10000`; collateral seized = `seizeUsd / collateralPrice` (capped at user collateral). Liquidator pays `repayAmount` of debt token.
- Event `Liquidated(uint8 pool, address user, address liquidator, uint256 repayAmount, uint256 collateralSeized, uint256 bonusUsd8)` where `bonusUsd8 = repayUsd * liqBonusBps / 10000` — **the realized-loss metric in the evaluation reads this field**.

### 2.4 `MockSwap`
```
swap(address tokenIn, address tokenOut, uint256 amountIn, uint256 minAmountOut) returns (uint256 amountOut)
```
Oracle-priced, fixed fee `feeBps = 30`, holds its own liquidity (seeded by script), reverts `SlippageExceeded` if `amountOut < minAmountOut`. `setBroken(bool)` admin: makes `swap` revert (failure injection).

### 2.5 `MandateVault` (the product)
Non-custodial: funds sit in the vault; **owner can always withdraw** (`ownerWithdraw`). The agent only holds the `executor` hot key.

```
constructor(address owner, address executor, address oracle, address reserveToken /* mUSDC */)
```

#### Mandate (signed by the owner)
```
struct Mandate {
  uint64  id;                    // must equal nextMandateId when set (monotonic => replay protection)
  uint64  validFrom;             // unix seconds
  uint64  validUntil;
  uint128 maxTotalSpendUsd;      // usd8, CUMULATIVE per mandate id, never reset by the agent
  uint128 maxPerActionUsd;       // usd8
  uint128 minLiquidReserveUsd;   // usd8, reserveToken balance value must stay >= this after each action
  uint32  maxSlippageBps;
  uint32  maxPriceAgeSec;
  uint32  maxPriceDeviationBps;  // |oraclePrice - action.quotedPriceUsd8| / quoted
  uint8   allowedActions;        // bit0 REPAY, bit1 SUPPLY_COLLATERAL, bit2 SWAP
  bool    allowBorrow;           // BORROW requires this true
  address[] allowedTargets;      // LendingSim, MockSwap
  address[] lockedTokens;        // may not be tokenIn of REPAY or SWAP ("do not sell my ETH")
}
```
EIP-712 domain: `name="MarginPilotVault"`, `version="1"`, `chainId`, `verifyingContract=<vault>`.
Type definitions (must match `INTERFACES.md` §8 field for field):
```
Mandate(uint64 id,uint64 validFrom,uint64 validUntil,uint128 maxTotalSpendUsd,uint128 maxPerActionUsd,uint128 minLiquidReserveUsd,uint32 maxSlippageBps,uint32 maxPriceAgeSec,uint32 maxPriceDeviationBps,uint8 allowedActions,bool allowBorrow,address[] allowedTargets,address[] lockedTokens)
SetMandate(Mandate mandate,uint256 deadline)
```
`MANDATE_TYPEHASH = keccak256("Mandate(...)")`. `SET_MANDATE_TYPEHASH` is the EIP-712 type hash of the primary type, so it includes the referenced `Mandate` type string: `keccak256("SetMandate(Mandate mandate,uint256 deadline)Mandate(uint64 id,uint64 validFrom,uint64 validUntil,uint128 maxTotalSpendUsd,uint128 maxPerActionUsd,uint128 minLiquidReserveUsd,uint32 maxSlippageBps,uint32 maxPriceAgeSec,uint32 maxPriceDeviationBps,uint8 allowedActions,bool allowBorrow,address[] allowedTargets,address[] lockedTokens)")` (that concatenation is EIP-712 `encodeType`, not two separate hashes).
Arrays are hashed per **standard EIP-712**: each `address` is padded to 32 bytes, the padded elements are concatenated, then `keccak256` is applied. Do **not** use `abi.encodePacked(address[])`, which emits 20-byte elements and does not match viem.

#### Action (submitted by the executor)
```
enum ActionType { REPAY, SUPPLY_COLLATERAL, SWAP, BORROW }   // 0,1,2,3

struct Action {
  uint64  mandateId;
  uint64  nonce;            // must equal actionNonce
  ActionType actionType;
  address target;           // LendingSim or MockSwap
  uint8   poolId;           // lending actions only
  address tokenIn;          // token leaving the vault (REPAY: debt token, SUPPLY: collateral token, SWAP: input)
  address tokenOut;         // SWAP only, else address(0)
  uint256 amount;           // tokenIn raw units
  uint256 minAmountOut;     // SWAP only
  uint256 quotedPriceUsd8;  // price of tokenIn the planner assumed
  uint64  deadline;         // unix seconds
}
```

#### Functions
```
setMandate(Mandate m)                                   // onlyOwner
setMandateWithSig(Mandate m, uint256 deadline, bytes sig) // anyone relays; recovers signer == owner (ECDSA, EOA only)
revokeMandate()                                         // onlyOwner
pause()                                                 // owner OR executor (stopping is always the safe direction)
unpause()                                               // owner only
setExecutor(address)                                    // onlyOwner
ownerWithdraw(address token, uint256 amount, address to)// onlyOwner, works even when paused / no mandate
execute(Action a) returns (uint256 valueUsd8)           // onlyExecutor
views: owner, executor, paused, nextMandateId, activeMandateId, mandate(), spentUsd(mandateId), actionNonce, liquidReserveUsd8()
```
> Event names are `VaultPaused`/`VaultUnpaused`; there are no events named `Paused`/`Unpaused`. Solidity rejects an event and a custom error with the same name (`error Paused` is required by the check table), so the events are deliberately prefixed (D-022, verified by compiling with solc 0.8.24).

Events: `MandateSet(uint64 id, bytes32 mandateHash)`, `MandateRevoked(uint64 id)`, `VaultPaused(address by)`, `VaultUnpaused(address by)`, `ExecutorChanged(address)`, `ActionExecuted(uint64 mandateId, uint64 nonce, uint8 actionType, address target, address tokenIn, uint256 amount, uint256 valueUsd8, uint256 spentUsd8After)`.
Setting a new mandate sets `activeMandateId = id`, `nextMandateId = id + 1`, and starts a fresh `spentUsd(id) = 0`. **Only an owner signature can create a fresh budget.**

#### `execute` check order (tests rely on this order — do not reorder)
| # | Check | Custom error |
|---|---|---|
| 1 | `msg.sender == executor` | `NotExecutor` |
| 2 | `!paused` | `Paused` |
| 3 | a mandate is active (not revoked, id > 0) | `MandateInactive` |
| 4 | `a.mandateId == activeMandateId && a.nonce == actionNonce` | `StaleAction` |
| 5 | `block.timestamp <= a.deadline` | `DeadlineExpired` |
| 6 | `validFrom <= now <= validUntil` | `MandateExpired` |
| 7 | `a.amount > 0` | `ZeroAmount` |
| 8 | BORROW and `!allowBorrow` → `BorrowForbidden`; else action bit not set → `ActionNotAllowed` | as stated |
| 9 | `a.target ∈ allowedTargets` | `TargetNotAllowed` |
| 10 | (REPAY or SWAP) and `a.tokenIn ∈ lockedTokens` | `AssetLocked` |
| 11 | oracle age of **every token in the action's price set** `<= maxPriceAgeSec`. Price set = `tokenIn`; plus `tokenOut` for SWAP; plus the pool's collateral and debt tokens for lending actions (REPAY/SUPPLY_COLLATERAL/BORROW), because check #16 reads their prices through `LendingSim.healthFactor`; plus the vault's **reserve token for every action**, because check #16 values the liquid reserve with it (D-023, D-031). A price the oracle does not know is treated as stale | `StalePrice` |
| 12 | `|price - quoted| * 10000 <= maxPriceDeviationBps * quoted`, where `price` is the oracle price of `tokenIn` only (`quotedPriceUsd8` quotes `tokenIn`; for REPAY that is mUSDC) | `PriceDeviation` |
| 13 | `valueUsd8 <= maxPerActionUsd` (BORROW counts 0) | `PerActionCapExceeded` |
| 14 | `spentUsd + valueUsd8 <= maxTotalSpendUsd` | `BudgetExceeded` |
| 15 | SWAP: `minAmountOut >= fairOut * (10000 - maxSlippageBps) / 10000` where `fairOut` comes from oracle prices | `SlippageExceeded` |
| — | effects: `actionNonce++`, `spentUsd += valueUsd8`; record HF before (lending actions); approve exact `amount`; call target; reset approval to 0 | |
| 16 | after: `liquidReserveUsd8() >= minLiquidReserveUsd`; lending actions: `HF after >= HF before` | `PostConditionFailed` |

Wrong-role target (D-030): a lending action (REPAY/SUPPLY_COLLATERAL/BORROW) at an allowed target that does not expose `LendingSim.pools(uint8)` is rejected with `TargetNotAllowed`; the pool-token read at the start of #11 maps any failure to that error, so it follows #10. A SWAP at an allowed target that exposes `LendingSim.pools(uint8)` is rejected with `TargetNotAllowed` immediately after #9, before #10 (D-032); `MockSwap` exposes no such probe, so a SWAP at the swap target passes the role check.

Revert of the whole tx (including a failed target call) leaves nonce and spend unchanged — the ledger never records spend for a reverted action.

#### Hard rules for the implementer
- Reentrancy guard on `execute`. Exact-amount approvals only, reset to 0 after the call.
- No `delegatecall`, no arbitrary `call` data: the vault builds the target calldata itself from `actionType`. **The executor can never pass raw calldata.**
- Gas is paid by the executor EOA and is **not** part of the on-chain budget. The off-chain ledger tracks it (see `INTERFACES.md`).
- `valueUsd8 = amount * price / 10**decimals(tokenIn)`; round **up** for spend accounting.

## 3. Deployment (`contracts/script/Deploy.s.sol`)
1. Deploy 3 tokens, oracle, LendingSim (+ pools), MockSwap, MandateVault(owner, executor, oracle, mUSDC).
2. Set initial prices: mUSDC 1.00, mWETH 2,000, mWSTETH 2,300.
3. Seed: LendingSim and MockSwap liquidity; mint test tokens to the vault; create the two demo positions from the `eval/fixtures/` scenario base (before the shock).
4. Write `deployments/<chainId>.json` (schema in `INTERFACES.md` §Deployments) including addresses, block numbers and deployer. **Never commit private keys.**
5. Optional: verify sources on the block explorer.

## 4. Required tests (`contracts/test/`) — see `ADVERSARIAL-TESTS.md` for IDs
- One Foundry test per `execute` check #1–#16 (each reverts with the exact custom error, and a "just inside the limit" positive case).
- Cumulative budget across ≥3 actions; replan-style sequence cannot exceed `maxTotalSpendUsd`.
- Mandate replay: old signature after `setMandateWithSig` → `BadNonce`; expired deadline → `SignatureExpired`; wrong signer → `BadSignature`; signature from another chain/vault domain fails.
- Pause by executor works; unpause by executor reverts `NotOwner`; `ownerWithdraw` works while paused.
- Freshness covers the whole price set: REPAY on pool 0 with a stale mWETH price (collateral) but a fresh mUSDC price reverts `StalePrice`; the same action on pool 1 is unaffected.
- Reserve price: a SWAP between two non-reserve tokens with a stale or missing mUSDC price reverts `StalePrice`; a missing token price is `StalePrice`, not `UnknownToken`.
- Wrong-role targets: a SWAP at the LendingSim address reverts `TargetNotAllowed` before `AssetLocked`; a lending action at the MockSwap address reverts `TargetNotAllowed`.
- Decimals: 100 mUSDC (6 dec) and 0.05 mWETH (18 dec) produce the expected `usd8`.
- Liquidation math vs `eval/worked_example.py` numbers (A: HF 0.942857, B: HF 1.051429 at the shock prices).
- Fuzz: for random valid actions, `spentUsd` is monotonic and never exceeds `maxTotalSpendUsd`.
- Cross-language: a mandate signed by viem in `packages/core` verifies in `MandateVault` (integration test; Dev A and Dev B pair on this one).

Custom errors defined (exact names): `NotOwner, NotExecutor, Paused, MandateInactive, MandateExpired, StaleAction, DeadlineExpired, ZeroAmount, ActionNotAllowed, BorrowForbidden, TargetNotAllowed, AssetLocked, StalePrice, PriceDeviation, PerActionCapExceeded, BudgetExceeded, SlippageExceeded, PostConditionFailed, BadSignature, BadNonce, SignatureExpired`.
