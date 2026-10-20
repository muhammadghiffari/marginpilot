# DEV-A sync review — 2026-10-20

Synced `origin/main` at `9d19d70` (A-04.1) into `main` and the feature branch. Compared `contracts/` with `packages/core/src/types.ts`, `policy.ts`, `mock-chain-port.ts` and `docs/spec/{CONTRACTS,INTERFACES}.md`.

Validation: `forge test -vv` → **32 passed, 0 failed** (the full Foundry suite); `pnpm -r typecheck` green. The TS-side differential fix in this review adds 2 tests.

## Findings by severity

### High — `MandateVault` is only the A-04.1 skeleton

`contracts/src/MandateVault.sol:35-84` implements owner/executor, pause, executor changes and `ownerWithdraw` only. It has no `Mandate` or `Action` structs, no `setMandate` / `setMandateWithSig` / `revokeMandate` / `execute`, no mandate/action views and no mandate/action events. Therefore the following cannot be cross-checked yet and A-07/B-08 cannot start:

- struct field names, order and Solidity types vs `types.ts`
- EIP-712 domain, typehash and signature recovery vs `INTERFACES.md` §8
- `execute` check order #1–#16 vs `policy.ts` and `MockChainPort`
- D-023 price-set coverage and D-025 `tokenDecimals` / pool metadata usage
- ABI export for `ViemChainPort`

Proposed change: complete A-04 per `CONTRACTS.md` §2.5, then export the ABI. Exact proposed contract file: `contracts/src/MandateVault.sol` (add structs, EIP-712, mandate lifecycle, `execute`, views and events).

### High — A-07 artifacts are absent

Missing at this sync:

- `contracts/script/Deploy.s.sol`
- `scripts/deploy.sh` (there is no `scripts/deploy*` file)
- `deployments/<chainId>.json` (only `deployments/README.md`)
- `eval/fixtures/base.json`
- `packages/core/src/abi/` (directory does not exist)
- `ViemChainPort` itself

B-08 is blocked until A-04 and A-07 produce the ABIs, deployment addresses and base fixture. Proposed change: create the A-07 deploy script and export `MandateVault`, `LendingSim`, `MockSwap`, `MockERC20` and `MockOracle` ABIs with `forge inspect … abi --json` on every contract change.

### Medium — EIP-712 spec line is malformed and has no Solidity counterpart

`docs/spec/CONTRACTS.md:81` contains the `Mandate(...)` typehash twice in the `SetMandate(...)` line instead of one clean `SetMandate(Mandate mandate,uint256 deadline)` string. No Solidity EIP-712 implementation exists yet, so the domain (`name="MarginPilotVault"`, `version="1"`) and hashes cannot be verified. Proposed change: fix line 81 to the single valid `SetMandate` typehash (or split the two strings onto separate lines), then implement `EIP712("MarginPilotVault", "1")` in `MandateVault.sol` exactly as in `INTERFACES.md` §8.

### Medium — target-contract errors are not representable in `ErrorName`

`MandateVault` declares exactly the 21 `ErrorName` values (`contracts/src/MandateVault.sol:13-33`), which matches `packages/core/src/types.ts:6-27`. However the target contracts add errors outside that union:

- `contracts/src/LendingSim.sol:9-14`: `NotAdmin`, `InvalidPool`, `PoolPaused`, `BorrowTooMuch`, `NotLiquidatable`, `CloseFactorExceeded`
- `contracts/src/MockSwap.sol:9-11`: `NotAdmin`, `SwapBroken`, `SlippageExceeded` (`SlippageExceeded` is in the union; the other two are not)
- `contracts/src/MockERC20.sol:6-8` and `contracts/src/MockOracle.sol:6-7`

`MockChainPort` currently maps target failures such as `PoolPaused` to `Unknown` with a raw reason. ViemChainPort must do the same or the shared `ErrorName`/spec needs a documented mapping. Proposed decision: keep `Unknown` plus a redacted `raw` for target errors, and never widen the on-chain `execute` error set implicitly.

### Medium — D-023 and D-025 are implemented only on the TypeScript side

`policy.ts` already applies the D-023 price set for lending actions and consumes `PolicyContext` (`packages/core/src/policy.ts:72-81, 89-96`). `MandateVault.sol` has no `execute`, so there is no contract-side check #11 or #16 to compare. Once A-04 lands, the vault must read fresh pool collateral/debt prices and fresh post-action HF, not trust caller-supplied snapshots. No contract change is possible until the execute path exists.

### Low — LendingSim numbers match, but the Foundry test is approximate

`contracts/src/LendingSim.sol:90-97` uses the same integer formula as `packages/core/src/health.ts:13-24`. At the shock prices the exact values are:

- pool 0: `942857142857142857`
- pool 1: `1051428571428571428`

These match `packages/core/test/fixtures.ts` and `eval/worked_example.py`. The liquidation fixture `459375000000000000` also matches the event/balance test. `contracts/test/LendingSim.t.sol:76-77` uses `assertApproxEqAbs(..., 1e12)`; proposed change: add exact `assertEq` assertions (keep the approximate ones if desired) so the cross-language pin cannot drift inside the tolerance.

### Fixed in this sync — MockChainPort SWAP did not mirror MockSwap

`MockChainPort` credited oracle-priced output without MockSwap’s 30 bps fee and did not enforce `minAmountOut`. Fixed with red→green tests in commit `7cac091`:

- output now uses the same two-step floor math as `MockSwap`: `amountInUsd8` → `outUsd8` at 9,970 bps → raw output
- a target-level `minAmountOut` failure returns `SlippageExceeded`

## What B-08 needs from Dev A

1. A completed `MandateVault` ABI (mandate/action structs, set/revoke/execute, views, events).
2. Exported ABIs in `packages/core/src/abi/`.
3. `deployments/<chainId>.json` with all contract addresses and block numbers.
4. `eval/fixtures/base.json` with the base prices, positions, reserve and locked mWETH.
5. A deterministic deploy script that produces the same base state on anvil.

Until those exist, ViemChainPort cannot be implemented or integration-tested.
