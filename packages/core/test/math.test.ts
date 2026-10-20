import { describe, expect, test } from 'vitest';

import {
  MAX_UINT256,
  healthFactorWad,
  mulDivCeil,
  mulDivFloor,
  tokenCeil,
  usd8Ceil,
} from '../src/index.js';

describe('usd8 valuation with explicit decimals', () => {
  test('values 6-decimal and 18-decimal amounts identically at equal unit prices', () => {
    expect(usd8Ceil(100_000_000n, 6, 100_000_000n)).toBe(10_000_000_000n);
    expect(usd8Ceil(50_000_000_000_000_000n, 18, 200_000_000_000n)).toBe(10_000_000_000n);
  });

  test('rounds spend up, never down', () => {
    expect(mulDivFloor(3n, 10n, 1_000_000n)).toBe(0n);
    expect(mulDivCeil(3n, 10n, 1_000_000n)).toBe(1n);
    expect(usd8Ceil(1n, 6, 1n)).toBe(1n);
  });

  test('converts usd8 spend back to raw token units rounding up', () => {
    expect(tokenCeil(10_000_000_000n, 6, 100_000_000n)).toBe(100_000_000n);
    expect(tokenCeil(10_000_000_000n, 18, 200_000_000_000n)).toBe(50_000_000_000_000_000n);
    expect(tokenCeil(1n, 6, 300_000_000n)).toBe(1n);
  });

  test('rounding direction differs visibly by decimals', () => {
    expect(usd8Ceil(1n, 6, 100_000_000n)).toBe(100n);
    expect(usd8Ceil(1n, 18, 100_000_000n)).toBe(1n);
    expect(mulDivCeil(1n, 1n, 3n)).toBe(1n);
    expect(mulDivFloor(1n, 1n, 3n)).toBe(0n);
  });

  test('rejects non-positive denominators and invalid decimals', () => {
    expect(() => mulDivFloor(1n, 1n, 0n)).toThrow(/denominator/i);
    expect(() => usd8Ceil(1n, -1, 1n)).toThrow(/decimals/i);
    expect(() => usd8Ceil(1n, 256, 1n)).toThrow(/decimals/i);
  });
});

describe('health factor in wad (CONTRACTS §2.3, OPTIMIZER §6)', () => {
  test('reproduces the pinned fixture HF values exactly', () => {
    const poolA = {
      collateral: 1_000_000_000_000_000_000n,
      collateralDecimals: 18,
      collateralPriceUsd8: 160_000_000_000n,
      ltBps: 8250,
      debt: 1_400_000_000n,
      debtDecimals: 6,
      debtPriceUsd8: 100_000_000n,
    };
    const poolB = {
      collateral: 2_000_000_000_000_000_000n,
      collateralDecimals: 18,
      collateralPriceUsd8: 184_000_000_000n,
      ltBps: 8000,
      debt: 2_800_000_000n,
      debtDecimals: 6,
      debtPriceUsd8: 100_000_000n,
    };
    expect(healthFactorWad(poolA)).toBe(942_857_142_857_142_857n);
    expect(healthFactorWad(poolB)).toBe(1_051_428_571_428_571_428n);
    expect(Number(healthFactorWad(poolA)) / 1e18).toBeCloseTo(0.942857, 6);
    expect(Number(healthFactorWad(poolB)) / 1e18).toBeCloseTo(1.051429, 6);
  });

  test('returns max uint256 for a debt-free position', () => {
    expect(
      healthFactorWad({
        collateral: 1n,
        collateralDecimals: 18,
        collateralPriceUsd8: 1n,
        ltBps: 8250,
        debt: 0n,
        debtDecimals: 6,
        debtPriceUsd8: 1n,
      }),
    ).toBe(MAX_UINT256);
  });

  test('handles a 6-decimal collateral against an 18-decimal debt', () => {
    const hf = healthFactorWad({
      collateral: 1_000_000n,
      collateralDecimals: 6,
      collateralPriceUsd8: 2_000_000_000n,
      ltBps: 5000,
      debt: 1_000_000_000_000_000_000n,
      debtDecimals: 18,
      debtPriceUsd8: 1_000_000_000n,
    });
    expect(hf).toBe(1_000_000_000_000_000_000n);
  });
});
