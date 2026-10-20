# DEV-A sync review — 2026-10-20

Synced `origin/main` at `264cf63` (A-04.3) into `main` and the feature branch. Compared `contracts/` with `packages/core/src/types.ts`, `policy.ts`, `mock-chain-port.ts` and `docs/spec/{CONTRACTS,INTERFACES}.md`.

Validation: `forge test -vv` → **98 passed, 0 failed**; `pnpm -r typecheck` green; core tests **83 passed** after the TS fix below. The EIP-712 literals in the Foundry tests were independently reproduced with viem (`hashTypedData`): both non-empty-array and empty-array digests match exactly.

## Findings by severity

### High — A-04 still lacks effects and check #16

`contracts/src/MandateVault.sol` now has the `Mandate` and `Action` structs (`:39-74`), `ActionType` (`:55-60`), the EIP-712 domain/typehashes (`:76-81, :102-104`), `actionNonce` (`:91`), `revokeMandate` (`:166-173`), `mandate()`, and `execute` checks #1–#15 in the CONTRACTS order (`:176-235`). The struct field names, order and Solidity types match `packages/core/src/types.ts:29-43, 81-93`; `tokenOut = address(0)` is the on-chain form of the off-chain `null`.

The following are still missing from `contracts/src/MandateVault.sol`:

- `execute` effects: nonce increment, `spentUsd` update, exact approvals, target call, approval reset (`CONTRACTS.md:139`)
- check #16 / `PostConditionFailed` and `liquidReserveUsd8()`
- `ActionExecuted` event and the `MandateRevoked`/`ActionExecuted` ABI surface for the UI
- ABI export and deployment artifacts (A-07)

`execute` currently returns `valueUsd8` after the checks and changes no state. A-07/B-08 remain blocked. Proposed change: finish A-04.4 per `CONTRACTS.md` §2.5, then export the ABI.

### High — A-07 artifacts are absent

Missing at this sync:

- `contracts/script/Deploy.s.sol`
- `scripts/deploy.sh` (there is no `scripts/deploy*` file)
- `deployments/<chainId>.json` (only `deployments/README.md`)
- `eval/fixtures/base.json`
- `packages/core/src/abi/` (directory does not exist)
- `ViemChainPort` itself

B-08 is blocked until A-04 and A-07 produce the ABIs, deployment addresses and base fixture. Proposed change: create the A-07 deploy script and export `MandateVault`, `LendingSim`, `MockSwap`, `MockERC20` and `MockOracle` ABIs with `forge inspect … abi --json` on every contract change.

### Medium — target-contract errors are not representable in `ErrorName`

`MandateVault` declares exactly the 21 `ErrorName` values (`contracts/src/MandateVault.sol:15-35`), which matches `packages/core/src/types.ts:6-27`. The target contracts add errors outside that union:

- `contracts/src/LendingSim.sol:9-14`: `NotAdmin`, `InvalidPool`, `PoolPaused`, `BorrowTooMuch`, `NotLiquidatable`, `CloseFactorExceeded`
- `contracts/src/MockSwap.sol:9-11`: `NotAdmin`, `SwapBroken`, `SlippageExceeded` (`SlippageExceeded` is in the union; the other two are not)
- `contracts/src/MockERC20.sol:6-8` and `contracts/src/MockOracle.sol:6-7`

`MockChainPort` maps target failures such as `PoolPaused` to `Unknown` with a raw reason. ViemChainPort must do the same, or the shared `ErrorName`/spec needs a documented mapping. Proposed decision: keep `Unknown` plus a redacted `raw` for target errors and do not widen the vault's `execute` error set implicitly.

### Verified — A-04.3 checks #1–#15 match the TypeScript mirror

`contracts/src/MandateVault.sol:176-235` implements checks #1–#15 in the exact CONTRACTS order, and `packages/core/src/policy.ts:89-181` returns the same errors in the same order. Spot checks:

- #8 BORROW/`allowedActions` bit handling is identical.
- #11 uses the D-023 price set: `tokenIn`, plus `tokenOut` for SWAP, plus the pool's collateral and debt tokens for lending actions (`_priceSet`, `:292-305`).
- #12 compares `tokenIn` only; #13 values BORROW at 0; #14 reads `spentUsd[a.mandateId]`; #15 uses the same single-floor `fairOut` math.
- D-025 data: the vault reads `MockERC20(token).decimals()` and `LendingSim(target).pools(poolId)` directly, while TS uses `PolicyContext`; ViemChainPort must populate the context from these same sources.

No new TypeScript-side mismatch was found in A-04.3. The prior SWAP fee/`minAmountOut` mock fix remains the only TS correction in this sync.

### Medium — D-023 price set is present; #16 is still unavailable on-chain

Check #11 now covers the full D-023 price set. Check #16 is still absent because effects are not implemented, so the vault cannot yet verify `liquidReserveUsd8` or post-action HF. The off-chain `checkPostConditions` (`policy.ts:184-196`) remains the only executable #16 mirror until A-04.4.

### Low — LendingSim numbers match, but the Foundry test is approximate

`contracts/src/LendingSim.sol:90-97` uses the same integer formula as `packages/core/src/health.ts:13-24`. At the shock prices the exact values are:

- pool 0: `942857142857142857`
- pool 1: `1051428571428571428`

These match `packages/core/test/fixtures.ts` and `eval/worked_example.py`. The liquidation fixture `459375000000000000` also matches the event/balance test. `contracts/test/LendingSim.t.sol:76-77` uses `assertApproxEqAbs(..., 1e12)`; proposed change: add exact `assertEq` assertions (keep the approximate ones if desired) so the cross-language pin cannot drift inside the tolerance.

### Verified — EIP-712 matches the shared spec

`CONTRACTS.md` now states the standard EIP-712 array encoding and the full `SetMandate` `encodeType`. `MandateVault` uses `EIP712("MarginPilotVault", "1")` and the `Mandate`/`SetMandate` field order from `INTERFACES.md` §8. The Foundry test literals `0xdd69…4eef` and `0xc136…e28b` were reproduced independently with viem for chain id 31337 and the test verifying contract.

### Fixed in this sync — MockChainPort SWAP did not mirror MockSwap

`MockChainPort` credited oracle-priced output without MockSwap's 30 bps fee and did not enforce `minAmountOut`. Fixed with red→green tests in commit `7cac091`:

- output now uses the same two-step floor math as `MockSwap`: `amountInUsd8` → `outUsd8` at 9,970 bps → raw output
- a target-level `minAmountOut` failure returns `SlippageExceeded`

## What B-08 needs from Dev A

1. A completed `MandateVault` ABI: `execute` effects/check #16, `liquidReserveUsd8()`, `ActionExecuted`, and the final `MandateRevoked` surface.
2. Exported ABIs in `packages/core/src/abi/`.
3. `deployments/<chainId>.json` with all contract addresses and block numbers.
4. `eval/fixtures/base.json` with the base prices, positions, reserve and locked mWETH.
5. A deterministic deploy script that produces the same base state on anvil.

Until those exist, ViemChainPort cannot be implemented or integration-tested.
