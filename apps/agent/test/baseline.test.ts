import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { expect, test } from 'vitest';

import {
  DEMO_BASELINE_POSITIONS,
  DEMO_BASELINE_PRICES_USD8,
  DEMO_BASELINE_RESERVE_MUSDC,
} from '../src/chain/baseline.js';

const root = resolve(import.meta.dirname, '../../..');
const fixture = JSON.parse(readFileSync(resolve(root, 'eval/fixtures/base.json'), 'utf8')) as {
  prices: Record<string, { priceUsd8: string }>;
  positions: Record<string, { collateral: string; debt: string }>;
};
const deploy = readFileSync(resolve(root, 'contracts/script/Deploy.s.sol'), 'utf8');

test('reset baseline equals the committed fixture', () => {
  for (const symbol of ['mUSDC', 'mWETH', 'mWSTETH'] as const) {
    expect(DEMO_BASELINE_PRICES_USD8[symbol].toString()).toBe(fixture.prices[symbol]?.priceUsd8);
  }
  expect(DEMO_BASELINE_POSITIONS[0].collateral.toString()).toBe(fixture.positions.pool0?.collateral);
  expect(DEMO_BASELINE_POSITIONS[0].debt.toString()).toBe(fixture.positions.pool0?.debt);
  expect(DEMO_BASELINE_POSITIONS[1].collateral.toString()).toBe(fixture.positions.pool1?.collateral);
  expect(DEMO_BASELINE_POSITIONS[1].debt.toString()).toBe(fixture.positions.pool1?.debt);
});

test('reset baseline equals the Deploy.s.sol constants', () => {
  expect(deploy).toContain('VAULT_RESERVE = 400e6');
  expect(DEMO_BASELINE_RESERVE_MUSDC).toBe(400_000_000n);
  expect(deploy).toContain('POOL0_DEBT = 1_400e6');
  expect(deploy).toContain('POOL1_DEBT = 2_800e6');
  expect(deploy).toContain('WETH_PRICE = 2_000e8');
  expect(deploy).toContain('WSTETH_PRICE = 2_300e8');
});
