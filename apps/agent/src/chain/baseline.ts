import type { Address, MarketBaseline } from '@marginpilot/core';

/** Mirrors contracts/script/Deploy.s.sol and eval/fixtures/base.json (a test fails if they drift). */
export const DEMO_BASELINE_PRICES_USD8 = { mUSDC: 100_000_000n, mWETH: 200_000_000_000n, mWSTETH: 230_000_000_000n } as const;
export const DEMO_BASELINE_POSITIONS = [
  { poolId: 0, collateral: 1_000_000_000_000_000_000n, debt: 1_400_000_000n },
  { poolId: 1, collateral: 2_000_000_000_000_000_000n, debt: 2_800_000_000n },
] as const;
export const DEMO_BASELINE_RESERVE_MUSDC = 400_000_000n;

export function demoBaseline(tokens: { mUSDC: Address; mWETH: Address; mWSTETH: Address }): MarketBaseline {
  return {
    prices: [
      { token: tokens.mUSDC, priceUsd8: DEMO_BASELINE_PRICES_USD8.mUSDC },
      { token: tokens.mWETH, priceUsd8: DEMO_BASELINE_PRICES_USD8.mWETH },
      { token: tokens.mWSTETH, priceUsd8: DEMO_BASELINE_PRICES_USD8.mWSTETH },
    ],
    positions: DEMO_BASELINE_POSITIONS.map((position) => ({ ...position })),
    reserve: { token: tokens.mUSDC, amount: DEMO_BASELINE_RESERVE_MUSDC },
  };
}
