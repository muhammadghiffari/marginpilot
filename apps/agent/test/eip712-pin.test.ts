import type { Mandate } from '@marginpilot/core';
import { hashTypedData } from 'viem';
import { describe, expect, test } from 'vitest';

import { mandateTypedData } from '../src/runtime.js';

/**
 * Cross-language pin: contracts/test/MandateVault.t.sol (test_T09d_PinnedDigestMatchesViem)
 * asserts the same constant, computed there with an independent abi.encode implementation
 * of the vault's typehashes. If either side changes a field width or name, one test fails.
 */
export const PINNED_VAULT = '0x5FbDB2315678afecb367f032d93F642f64180aa3' as const;
export const PINNED_CHAIN_ID = 31_337;
export const PINNED_DEADLINE = 5_000n;
export const PINNED_MANDATE: Mandate = {
  id: 1n,
  validFrom: 1_000n,
  validUntil: 87_400n,
  maxTotalSpendUsd: 26_000_000_000n,
  maxPerActionUsd: 26_000_000_000n,
  minLiquidReserveUsd: 10_000_000_000n,
  maxSlippageBps: 100,
  maxPriceAgeSec: 600,
  maxPriceDeviationBps: 300,
  allowedActions: 3,
  allowBorrow: false,
  allowedTargets: ['0x0000000000000000000000000000000000001234'],
  lockedTokens: ['0x000000000000000000000000000000000000beef'],
} as Mandate;
const PINNED_DIGEST = '0x31049e159cab0336ab85ade84e2a6a411cf83cb1df5d9f57aa4186dbc4ee9886';

describe('EIP-712 digest pin', () => {
  test('viem digest of mandateTypedData equals the pinned vault digest', () => {
    const digest = hashTypedData(mandateTypedData(PINNED_CHAIN_ID, PINNED_VAULT, PINNED_MANDATE, PINNED_DEADLINE));
    expect(digest).toBe(PINNED_DIGEST);
  });
});
