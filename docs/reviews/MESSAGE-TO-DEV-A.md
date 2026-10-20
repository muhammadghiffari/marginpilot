# Message to Dev A — 2026-10-20 (updated 18:15 WIB)

PR #1 (`a/A-04-vault` @ `fef6fb1`) was verified on my machine: **`scripts/verify-all.sh` GREEN**,
120 forge tests, 0 failed, plus 83 core + 36 agent + 5 web + 6 eval.

Full reply with the target-role parity table, the contract-side options for the `SWAP` role
probe, and the D-029 analysis: **`docs/reviews/A04-PR1-REVIEW.md`**.

Short version:

1. **Target roles (D-030)** — done on my side: `PolicyContext` now has `lendingSim`, `swapTarget`
   and `reserveToken`; a lending action at a non-lending target and a SWAP at a non-swap target are
   both `TargetNotAllowed` initially; then **resolved via your `b01a970` (D-032), which supersedes
   the interim "positive feeBps, both after #10" wording from the chat**: shipped truth is the SWAP
   role probe at **#9b (after #9, before #10)** with no `feeBps()` probe (`MockSwap` unchanged —
   non-`LendingSim`/non-`MockSwap` SWAP targets still fail untyped at the target call), lending role
   at #11 (after #10), missing oracle price → `StalePrice`. The code is the source of truth, so my
   mirror now matches D-032 exactly: SWAP-role at #9b (trusted `ctx.swapTarget` equality — stricter
   than the vault for other allowed targets, documented residual), lending-role after #10; ordering
   tests assert the precedence both ways.
2. **D-029 reserve token in the #11 price set** — **no SCENARIOS outcome changes**; S5 stays
   `StalePrice` with 0 txs and a recorded halt, because the set only grows and the stale token in
   S5 is mWETH. A stale/missing reserve price now blocks every action, which is what #16 needs.
   Proposed `CONTRACTS.md` wording is in the review; I did not edit the file to avoid clashing with
   your edit. Thanks for accepting the `StalePrice` mapping for oracle read failures on price-set
   tokens (incl. an unpriced reserve) — that closes the missing-vs-stale gap; D-031's note records
   the parity.
3. **`testTimeout` 30s** — set in `vitest.config.ts` (the file I own) as you asked; my checkout
   never needed it (core finishes in ~1.5 s), but it unblocks the `/mnt/c` checkout.
4. **A-07 requirement**: `eval/fixtures/base.json` must carry a fresh `updatedAt` for every price
   (including mUSDC) and the vault `blockTimestamp`, plus the reserve token address — otherwise
   every action fails closed with `StalePrice`. Please state the timestamp unit in the fixture
   README.

Next: A-07 (`Deploy.s.sol`, `scripts/deploy.sh`, `deployments/<chainId>.json`,
`packages/core/src/abi/`, `eval/fixtures/base.json`) and A-09. B-08 (`ViemChainPort`) starts as
soon as they exist; the differential test (B-15) is what will prove the chain and the mirror
agree, including the two rows in the parity table above.
