import type {
  Mandate,
  PositionSnapshot,
  PriceSnapshot,
  VaultSnapshot,
} from '../src/types.js';

export const TEST_ADDRESSES = {
  mUSDC: '0x00000000000000000000000000000000000000a1',
  mWETH: '0x00000000000000000000000000000000000000a2',
  mWSTETH: '0x00000000000000000000000000000000000000a3',
  lending: '0x00000000000000000000000000000000000000b1',
  vault: '0x00000000000000000000000000000000000000b2',
  swap: '0x00000000000000000000000000000000000000b3',
} as const;

export const FIXTURE_NOW = 1_700_000_000n;
export const FIXTURE_BLOCK = 100n;

export const fixturePositions: PositionSnapshot[] = [
  {
    poolId: 0,
    collateralToken: TEST_ADDRESSES.mWETH,
    debtToken: TEST_ADDRESSES.mUSDC,
    collateral: 1_000_000_000_000_000_000n,
    debt: 1_400_000_000n,
    healthFactor: 942_857_142_857_142_857n,
    ltBps: 8250,
    liqBonusBps: 500,
    closeFactorBps: 5000,
  },
  {
    poolId: 1,
    collateralToken: TEST_ADDRESSES.mWSTETH,
    debtToken: TEST_ADDRESSES.mUSDC,
    collateral: 2_000_000_000_000_000_000n,
    debt: 2_800_000_000n,
    healthFactor: 1_051_428_571_428_571_428n,
    ltBps: 8000,
    liqBonusBps: 700,
    closeFactorBps: 5000,
  },
];

export const fixturePrices: PriceSnapshot[] = [
  { token: TEST_ADDRESSES.mUSDC, priceUsd8: 100_000_000n, updatedAt: FIXTURE_NOW },
  { token: TEST_ADDRESSES.mWETH, priceUsd8: 160_000_000_000n, updatedAt: FIXTURE_NOW },
  { token: TEST_ADDRESSES.mWSTETH, priceUsd8: 184_000_000_000n, updatedAt: FIXTURE_NOW },
];

export const fixtureMandate: Mandate = {
  id: 1n,
  validFrom: FIXTURE_NOW - 1_000n,
  validUntil: FIXTURE_NOW + 86_400n,
  maxTotalSpendUsd: 26_000_000_000n,
  maxPerActionUsd: 26_000_000_000n,
  minLiquidReserveUsd: 10_000_000_000n,
  maxSlippageBps: 100,
  maxPriceAgeSec: 600,
  maxPriceDeviationBps: 300,
  allowedActions: 3,
  allowBorrow: false,
  allowedTargets: [TEST_ADDRESSES.lending],
  lockedTokens: [TEST_ADDRESSES.mWETH],
};

export const fixtureVault: VaultSnapshot = {
  blockNumber: FIXTURE_BLOCK,
  blockTimestamp: FIXTURE_NOW,
  paused: false,
  activeMandateId: 1n,
  actionNonce: 7n,
  spentUsd8: 0n,
  liquidReserveUsd8: 40_000_000_000n,
  balances: { [TEST_ADDRESSES.mUSDC]: 400_000_000n },
};

export const fixtureMarket = {
  reserveToken: TEST_ADDRESSES.mUSDC,
  lendingSim: TEST_ADDRESSES.lending,
  tokenDecimals: {
    [TEST_ADDRESSES.mUSDC]: 6,
    [TEST_ADDRESSES.mWETH]: 18,
    [TEST_ADDRESSES.mWSTETH]: 18,
  } as Record<`0x${string}`, number>,
  now: FIXTURE_NOW,
};
