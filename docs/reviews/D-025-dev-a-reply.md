# D-025 — Dev A reply

Reviewer: Dev A. Base: `765fc18` (after `git pull --ff-only origin main`). Decision: **accept D-025 in principle**; no Solidity struct, ABI, error-name or check-order change. This review is read-only; no Dev B work was reverted.

## a. Mandate/Action fields, errors, check order — PASS

- `Mandate`: `docs/spec/INTERFACES.md:26-33` lists `id, validFrom, validUntil, maxTotalSpendUsd, maxPerActionUsd, minLiquidReserveUsd, maxSlippageBps, maxPriceAgeSec, maxPriceDeviationBps, allowedActions, allowBorrow, allowedTargets, lockedTokens` — same names and order as `docs/spec/CONTRACTS.md:61-75`.
- `Action`: `docs/spec/INTERFACES.md:51-55` lists `mandateId, nonce, actionType, target, poolId, tokenIn, tokenOut, amount, minAmountOut, quotedPriceUsd8, deadline` — same names and order as `docs/spec/CONTRACTS.md:90-102`.
- Errors: `docs/spec/INTERFACES.md:12-17` is the same 21-name union as `docs/spec/CONTRACTS.md:169`; `packages/core/src/types.ts:6-27` matches it exactly.
- Check order: `packages/core/src/policy.ts:97-178` has `// #1` through `// #15` in the same order as `docs/spec/CONTRACTS.md:125-139`.
- No stale or renamed field/error/order line found.

## b. `PolicyContext.pools` — PASS

`docs/spec/INTERFACES.md:108`:

```ts
pools: Record<number, { collateralToken: Address; debtToken: Address }>;
```

`packages/core/src/types.ts:133` is identical. `contracts/src/LendingSim.sol:32` exposes `mapping(uint8 => Pool) public pools;`; the first two `Pool` fields are `address collateralToken; address debtToken;` (`LendingSim.sol:17-18`). Pools are `0 = mWETH/mUSDC`, `1 = mWSTETH/mUSDC` (`docs/spec/CONTRACTS.md:29-30`; tests: `contracts/test/LendingSim.t.sol:28-29`). The context intentionally carries only the two token addresses the vault reads from the getter; the other four getter fields are not needed.

## c. `checkPostConditions` — PASS

`packages/core/src/policy.ts:189-193`:

```ts
if (after.liquidReserveUsd8 < ctx.mandate.minLiquidReserveUsd) {
  return { ok: false, error: 'PostConditionFailed' };
}
if (lendingAction(ctx.action) && after.healthFactor < before.healthFactor) {
  return { ok: false, error: 'PostConditionFailed' };
}
```

`lendingAction` is `REPAY | SUPPLY_COLLATERAL | BORROW` only (`policy.ts:68-70`), so SWAP is excluded from the HF comparison. The reserve check runs for every action. `packages/core/test/policy.test.ts:170-209` covers the reserve revert, the HF revert, the equal-HF boundary, and SWAP ignoring HF.

## d. Commit 5844466 reflected — PASS, no stale lines; §8 has no prose

`grep` over `docs/spec/` finds the correct text only in `CONTRACTS.md`:

- `CONTRACTS.md:84`: standard EIP-712, each address padded to 32 bytes, explicitly “Do **not** use `abi.encodePacked(address[])`”.
- `CONTRACTS.md:117`: event names `VaultPaused`/`VaultUnpaused`; no `Paused`/`Unpaused` events.

`INTERFACES.md` has **no** `abi.encodePacked` line and **no** `Paused`/`Unpaused` event line. Its §8 (`INTERFACES.md:157-173`) contains only the viem domain/types, so there is nothing stale to correct. It also does not explicitly restate the array-hashing rule or the event names; that is a documentation gap, not a contradiction. CONTRACTS §2.5 remains authoritative for both.

## e. Wrong-role target — FAIL / needs role metadata

`PolicyContext` has `caller`, `executor`, `tokenDecimals`, `pools` only (`INTERFACES.md:104-109`; `types.ts:129-134`). It has no `lendingSim` or `swapTarget` address.

- Check #9 only tests `allowedTargets` membership (`policy.ts:120-121`).
- Check #11's price set calls `poolOf(ctx, action.poolId)` for every non-SWAP action (`policy.ts:72-82`), so a REPAY/SUPPLY/BORROW at a MockSwap address with a valid `poolId` passes the pure policy if its prices are fresh. A SWAP at the LendingSim address likewise passes #9/#15 because `PolicyContext` cannot tell the roles apart.
- `MockChainPort` does have `lendingSim` and `swapTarget` (`packages/core/src/mock-chain-port.ts:46-47`) and checks them during tentative effects (`:383-384`, `:420-421`), but it returns `Unknown` with raw `UnknownLendingTargetOrPool` / `UnknownSwapTarget`, not `TargetNotAllowed`.

Conclusion: the pure TS mirror **needs** role metadata (at minimum `lendingSim` and `swapTarget`, or a `targetRoles` map) to mirror the on-chain wrong-role rule, and those failures should map to `TargetNotAllowed`. The vault side will implement the lending-action half by mapping a failed `LendingSim.pools(uint8)` read to `TargetNotAllowed` (Step 1c). A SWAP at a LendingSim target will fail at the vault-built target call with the whole tx rolled back; it is not currently a named `TargetNotAllowed` unless a role check is added.
