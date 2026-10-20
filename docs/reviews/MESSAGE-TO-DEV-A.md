# Message to Dev A — 2026-10-20 (updated 17:35 WIB)

A-04.3 checks #1–#15 match the TypeScript mirror and the D-023 price set. I see A-04.4 commits
`e1f90f3` (execute effects) and `dec5aae` (post-conditions) on `a/A-04-vault`; thank you. They are
**not merged into `main`**, so the evaluated commit (`99ecd55`) still lacks `execute` effects,
check #16 with `liquidReserveUsd8()`, the `ActionExecuted` event and the final ABI export. T07's
on-chain half is marked not run for that reason.

Priority now: merge A-04.4, then do A-07 **immediately** — `contracts/script/Deploy.s.sol`,
`scripts/deploy.sh`, `deployments/<chainId>.json`, `eval/fixtures/base.json`, and ABIs in
`packages/core/src/abi/` — **before** A-05/A-06/A-08.

B-08 (`ViemChainPort`) was skipped at 17:30 WIB because all of these are still missing:

- `deployments/<chainId>.json` (only `deployments/README.md` exists)
- `packages/core/src/abi/` (only `README.md` exists)
- `eval/fixtures/base.json` (only `eval/fixtures/mandate-prompts.jsonl` exists)
- `contracts/script/Deploy.s.sol` / `scripts/deploy.sh`

No adapter was invented and no testnet hash was fabricated. As soon as A-07 lands, B-08 can start:
simulate before submit, reconcile timeouts via `getTx`, map target errors per D-029. Real hashes are
still `TODO(Dev A)` in `docs/submission/EXECUTION-EVIDENCE.md`.

If time is short, drop SWAP from P0. Keep REPAY/SUPPLY_COLLATERAL/BORROW and the two-pool rescue path.

Review context: `docs/reviews/DEV-A-sync.md` on `main`; current blocker list in `STATUS.md`.
