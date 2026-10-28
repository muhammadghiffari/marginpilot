import type { Mandate } from '@marginpilot/core';
import { describe, expect, test } from 'vitest';

import { Cooldown, demoEnvelopeViolations, originAllowed } from '../src/api/guards.js';

const LENDING = '0x00000000000000000000000000000000000000b1';
const SWAP = '0x00000000000000000000000000000000000000b2';
const base: Mandate = {
  id: 1n, validFrom: 1_000n, validUntil: 87_400n,
  maxTotalSpendUsd: 26_000_000_000n, maxPerActionUsd: 26_000_000_000n, minLiquidReserveUsd: 10_000_000_000n,
  maxSlippageBps: 100, maxPriceAgeSec: 600, maxPriceDeviationBps: 300,
  allowedActions: 3, allowBorrow: false, allowedTargets: [LENDING], lockedTokens: [],
} as Mandate;

describe('demo envelope', () => {
  test('accepts the default $260 repay mandate', () => {
    expect(demoEnvelopeViolations(base, [LENDING, SWAP])).toEqual([]);
  });
  test.each([
    ['cap', { maxTotalSpendUsd: 26_000_000_001n }],
    ['per action', { maxPerActionUsd: 26_000_000_001n }],
    ['borrow', { allowBorrow: true }],
    ['swap', { allowedActions: 7 }],
    ['no action', { allowedActions: 0 }],
    ['window', { validUntil: 1_000n + 8n * 24n * 3_600n }],
    ['inverted window', { validUntil: 1_000n }],
    ['slippage', { maxSlippageBps: 301 }],
    ['unknown target', { allowedTargets: ['0x00000000000000000000000000000000000000ff'] }],
    ['empty targets', { allowedTargets: [] }],
  ] as [string, Partial<Mandate>][])('rejects %s', (_name, patch) => {
    expect(demoEnvelopeViolations({ ...base, ...patch } as Mandate, [LENDING, SWAP]).length).toBeGreaterThan(0);
  });
});

describe('origin check', () => {
  const none = new Set<string>();
  test('allows no Origin, same host, and listed origins', () => {
    expect(originAllowed(undefined, 'demo.example', none)).toBe(true);
    expect(originAllowed('https://demo.example', 'demo.example', none)).toBe(true);
    expect(originAllowed('https://other.example', 'demo.example', new Set(['https://other.example']))).toBe(true);
  });
  test('rejects a foreign or malformed Origin', () => {
    expect(originAllowed('https://evil.example', 'demo.example', none)).toBe(false);
    expect(originAllowed('null', 'demo.example', none)).toBe(false);
  });
});

describe('cooldown', () => {
  test('blocks until the interval has passed', () => {
    let now = 10_000;
    const cooldown = new Cooldown(5_000, () => now);
    expect(cooldown.remainingMs()).toBe(0);
    cooldown.mark();
    now += 1_000;
    expect(cooldown.remainingMs()).toBe(4_000);
    now += 4_000;
    expect(cooldown.remainingMs()).toBe(0);
  });
});
