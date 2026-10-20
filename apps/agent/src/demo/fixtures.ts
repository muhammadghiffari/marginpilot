import type {
  Mandate,
  MockChainConfig,
  PositionSnapshot,
  PriceSnapshot,
  VaultSnapshot,
} from '@marginpilot/core';

import { LOCAL_TEST_REGISTRY, type TokenRegistry } from '../mandate/registry.js';

/** SIMULATED fixtures for the public demo. Mirrors SCENARIOS.md base state. */
export const DEMO_OWNER = '0x00000000000000000000000000000000000000e3' as const;
export const DEMO_EXECUTOR = '0x00000000000000000000000000000000000000e1' as const;
export const DEMO_VAULT = '0x00000000000000000000000000000000000000b2' as const;
export const DEMO_NOW = 1_700_000_000n;
export const DEMO_BLOCK = 100n;

export function demoMandate(registry: TokenRegistry = LOCAL_TEST_REGISTRY): Mandate {
  return {
    id: 1n,
    validFrom: DEMO_NOW - 1_000n,
    validUntil: DEMO_NOW + 86_400n,
    maxTotalSpendUsd: 26_000_000_000n,
    maxPerActionUsd: 26_000_000_000n,
    minLiquidReserveUsd: 10_000_000_000n,
    maxSlippageBps: 100,
    maxPriceAgeSec: 600,
    maxPriceDeviationBps: 300,
    allowedActions: 3,
    allowBorrow: false,
    allowedTargets: [registry.targets.lending],
    lockedTokens: [registry.tokens.mWETH],
  };
}

export function demoPositions(registry: TokenRegistry = LOCAL_TEST_REGISTRY): PositionSnapshot[] {
  return [
    {
      poolId: 0,
      collateralToken: registry.tokens.mWETH,
      debtToken: registry.tokens.mUSDC,
      collateral: 1_000_000_000_000_000_000n,
      debt: 1_400_000_000n,
      healthFactor: 942_857_142_857_142_857n,
      ltBps: 8_250,
      liqBonusBps: 500,
      closeFactorBps: 5_000,
    },
    {
      poolId: 1,
      collateralToken: registry.tokens.mWSTETH,
      debtToken: registry.tokens.mUSDC,
      collateral: 2_000_000_000_000_000_000n,
      debt: 2_800_000_000n,
      healthFactor: 1_051_428_571_428_571_428n,
      ltBps: 8_000,
      liqBonusBps: 700,
      closeFactorBps: 5_000,
    },
  ];
}

export function demoPrices(registry: TokenRegistry = LOCAL_TEST_REGISTRY): PriceSnapshot[] {
  return [
    { token: registry.tokens.mUSDC, priceUsd8: 100_000_000n, updatedAt: DEMO_NOW },
    { token: registry.tokens.mWETH, priceUsd8: 160_000_000_000n, updatedAt: DEMO_NOW },
    { token: registry.tokens.mWSTETH, priceUsd8: 184_000_000_000n, updatedAt: DEMO_NOW },
  ];
}

export function demoVault(registry: TokenRegistry = LOCAL_TEST_REGISTRY): VaultSnapshot {
  return {
    blockNumber: DEMO_BLOCK,
    blockTimestamp: DEMO_NOW,
    paused: false,
    activeMandateId: 1n,
    actionNonce: 7n,
    spentUsd8: 0n,
    liquidReserveUsd8: 40_000_000_000n,
    balances: {
      [registry.tokens.mUSDC]: 400_000_000n,
      [registry.tokens.mWETH]: 500_000_000_000_000_000n,
    },
  };
}

export function demoTokenDecimals(registry: TokenRegistry = LOCAL_TEST_REGISTRY): Record<string, number> {
  return {
    [registry.tokens.mUSDC]: 6,
    [registry.tokens.mWETH]: 18,
    [registry.tokens.mWSTETH]: 18,
  };
}

export function demoChainConfig(registry: TokenRegistry = LOCAL_TEST_REGISTRY): MockChainConfig {
  return {
    owner: DEMO_OWNER,
    executor: DEMO_EXECUTOR,
    mandate: demoMandate(registry),
    positions: demoPositions(registry),
    prices: demoPrices(registry),
    vault: demoVault(registry),
    tokenDecimals: demoTokenDecimals(registry),
    reserveToken: registry.tokens.mUSDC,
    lendingSim: registry.targets.lending,
    swapTarget: registry.targets.swap,
    demoEnabled: true,
    chainId: registry.chainId,
  };
}
