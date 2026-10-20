# Message to Dev A — 2026-10-20

A-04.3 checks #1–#15 match the TypeScript mirror and the D-023 price set. Still missing: `execute` effects (nonce increment, `spentUsd`, exact approval/call/reset), check #16 with `liquidReserveUsd8()`, the `ActionExecuted` event, and the final ABI export.

Priority change: finish A-04.4, then do A-07 **immediately** — `contracts/script/Deploy.s.sol`, `scripts/deploy.sh`, `deployments/<chainId>.json`, `eval/fixtures/base.json`, and ABIs in `packages/core/src/abi/` — **before** A-05/A-06/A-08. B-08 and the real testnet tx hashes are blocked on A-07.

If time is short, drop SWAP from P0. Keep REPAY/SUPPLY_COLLATERAL/BORROW and the two-pool rescue path.

Review: `docs/reviews/DEV-A-sync.md` on `main`.
