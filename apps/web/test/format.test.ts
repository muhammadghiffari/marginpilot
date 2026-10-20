import { describe, expect, test } from 'vitest';
import { budgetUsedPercent, formatHealth, formatUsd8, healthBand } from '../src/format.js';

describe('structured value formatting', () => {
  test('formats usd8 exactly without floating-point money math', () => {
    expect(formatUsd8(26_000_000_000n)).toBe('$260.00');
    expect(formatUsd8(123_456_789n)).toBe('$1.23');
    expect(formatUsd8(-1_200_000_000n)).toBe('-$12.00');
  });

  test('shows health and clamps budget progress', () => {
    expect(formatHealth(942_857_142_857_142_857n)).toBe('0.943');
    expect(healthBand(942_857_142_857_142_857n)).toBe('risk');
    expect(healthBand(1_050_000_000_000_000_000n)).toBe('caution');
    expect(healthBand(1_110_000_000_000_000_000n)).toBe('safe');
    expect(budgetUsedPercent(13_000_000_000n, 26_000_000_000n)).toBe(50);
    expect(budgetUsedPercent(0n, 0n)).toBe(0);
    expect(budgetUsedPercent(30n, 10n)).toBe(100);
  });
});
