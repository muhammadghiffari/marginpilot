import { describe, expect, test } from 'vitest';

import {
  MockChainPort,
  type Action,
  type Mandate,
  type MockChainConfig,
} from '../src/index.js';
import {
  FIXTURE_NOW,
  TEST_ADDRESSES,
  fixtureMandate,
  fixtureMarket,
  fixturePositions,
  fixturePrices,
  fixtureVault,
} from './fixtures.js';

const executor = '0x00000000000000000000000000000000000000e1' as const;
const owner = '0x00000000000000000000000000000000000000e3' as const;

const repayAction: Action = {
  mandateId: 1n,
  nonce: 7n,
  actionType: 'REPAY',
  target: TEST_ADDRESSES.lending,
  poolId: 0,
  tokenIn: TEST_ADDRESSES.mUSDC,
  tokenOut: null,
  amount: 86_570_000n,
  minAmountOut: 0n,
  quotedPriceUsd8: 100_000_000n,
  deadline: FIXTURE_NOW + 120n,
};

function config(overrides: Partial<MockChainConfig> = {}): MockChainConfig {
  return {
    owner,
    executor,
    mandate: fixtureMandate,
    positions: fixturePositions,
    prices: fixturePrices,
    vault: fixtureVault,
    tokenDecimals: fixtureMarket.tokenDecimals,
    reserveToken: TEST_ADDRESSES.mUSDC,
    lendingSim: TEST_ADDRESSES.lending,
    swapTarget: TEST_ADDRESSES.lending,
    demoEnabled: true,
    ...overrides,
  };
}

describe('MockChainPort atomic execution', () => {
  test('simulate does not mutate; submit mines one REPAY and emits its event', async () => {
    const chain = new MockChainPort(config());
    const before = await chain.getVault();

    const simulation = await chain.simulate(repayAction);
    expect(simulation).toEqual({ ok: true, valueUsd8: 8_657_000_000n });
    expect(await chain.getVault()).toEqual(before);

    const result = await chain.submit(repayAction);
    expect(result.status).toBe('mined');
    if (result.status !== 'mined') throw new Error('expected mined');
    expect(chain.stats).toMatchObject({ simulations: 2, submissions: 1 });

    const vault = await chain.getVault();
    expect(vault.actionNonce).toBe(8n);
    expect(vault.spentUsd8).toBe(8_657_000_000n);
    expect(vault.liquidReserveUsd8).toBe(31_343_000_000n);
    expect(vault.blockNumber).toBe(before.blockNumber + 1n);
    const positions = await chain.getPositions();
    expect(positions[0]?.debt).toBe(1_313_430_000n);
    expect(positions[1]?.debt).toBe(2_800_000_000n);

    const [event] = chain.getActionEvents();
    expect(event).toMatchObject({
      txHash: result.txHash,
      nonce: 7n,
      amount: 86_570_000n,
      valueUsd8: 8_657_000_000n,
      spentUsd8After: 8_657_000_000n,
    });
    expect(await chain.getTx(result.txHash)).toMatchObject({ status: 'mined', success: true });
  });

  test('rolls back balances, positions, spend and nonce when post-conditions fail', async () => {
    const wideMandate: Mandate = {
      ...fixtureMandate,
      maxTotalSpendUsd: 40_000_000_000n,
      maxPerActionUsd: 40_000_000_000n,
    };
    const chain = new MockChainPort(config({ mandate: wideMandate }));
    const beforeVault = await chain.getVault();
    const beforePositions = await chain.getPositions();
    const result = await chain.submit({ ...repayAction, amount: 350_000_000n });
    expect(result).toMatchObject({ status: 'reverted', error: 'PostConditionFailed' });
    expect(await chain.getVault()).toEqual(beforeVault);
    expect(await chain.getPositions()).toEqual(beforePositions);
    expect(chain.getActionEvents()).toEqual([]);
  });

  test('simulate rejects a stale nonce and submit sends nothing', async () => {
    const chain = new MockChainPort(config());
    const stale: Action = { ...repayAction, nonce: 6n };
    expect(await chain.simulate(stale)).toEqual({ ok: false, error: 'StaleAction' });
    const result = await chain.submit(stale);
    expect(result).toMatchObject({ status: 'reverted', error: 'StaleAction' });
    expect(chain.getActionEvents()).toEqual([]);
    expect((await chain.getVault()).actionNonce).toBe(7n);
  });

  test('a mined duplicate returns the original result and never executes twice', async () => {
    const chain = new MockChainPort(config());
    const first = await chain.submit(repayAction);
    const second = await chain.submit(repayAction);
    expect(second).toEqual(first);
    expect((await chain.getVault()).actionNonce).toBe(8n);
    expect(chain.getActionEvents()).toHaveLength(1);
  });
});

describe('MockChainPort SWAP mirrors MockSwap', () => {
  const swapMandate: Mandate = {
    ...fixtureMandate,
    allowedActions: 7,
    allowedTargets: [TEST_ADDRESSES.lending, TEST_ADDRESSES.swap],
  };
  const swapAction: Action = {
    ...repayAction,
    actionType: 'SWAP',
    target: TEST_ADDRESSES.swap,
    tokenIn: TEST_ADDRESSES.mUSDC,
    tokenOut: TEST_ADDRESSES.mWETH,
    amount: 100_000_000n,
    minAmountOut: 62_312_500_000_000_000n,
    quotedPriceUsd8: 100_000_000n,
  };

  test('charges the 30 bps fee', async () => {
    const chain = new MockChainPort(config({ mandate: swapMandate, swapTarget: TEST_ADDRESSES.swap }));
    const result = await chain.submit(swapAction);

    expect(result.status).toBe('mined');
    const vault = await chain.getVault();
    expect(vault.balances[TEST_ADDRESSES.mWETH]).toBe(62_312_500_000_000_000n);
    expect(vault.spentUsd8).toBe(10_000_000_000n);
  });

  test('enforces minAmountOut at the target', async () => {
    const chain = new MockChainPort(config({ mandate: swapMandate, swapTarget: TEST_ADDRESSES.swap }));
    const result = await chain.submit({ ...swapAction, minAmountOut: 62_312_500_000_000_001n });

    expect(result).toMatchObject({ status: 'reverted', error: 'SlippageExceeded' });
    expect((await chain.getVault()).balances[TEST_ADDRESSES.mWETH]).toBeUndefined();
  });
});

describe('MockChainPort UNKNOWN reconciliation', () => {
  test('returns UNKNOWN after mining, never resubmits, and exposes the mined tx', async () => {
    const chain = new MockChainPort(config({ unknownSubmitOnce: true }));
    const first = await chain.submit(repayAction);
    expect(first.status).toBe('unknown');
    if (first.status !== 'unknown') throw new Error('expected unknown');
    const afterFirst = await chain.getVault();
    expect(afterFirst.actionNonce).toBe(8n);

    const second = await chain.submit(repayAction);
    expect(second).toEqual(first);
    expect(await chain.getVault()).toEqual(afterFirst);
    expect(chain.getActionEvents()).toHaveLength(1);
    expect(chain.stats.submissions).toBe(1);
    expect(await chain.getTx(first.txHash)).toMatchObject({ status: 'mined', success: true });
  });

  test('getTx is not_found for an unknown hash', async () => {
    const chain = new MockChainPort(config());
    expect(await chain.getTx(`0x${'9'.repeat(64)}`)).toEqual({ status: 'not_found' });
  });
});

describe('MockChainPort pause and demo controls', () => {
  test('pause mines a tx and makes simulate fail closed with Paused', async () => {
    const chain = new MockChainPort(config());
    const txHash = await chain.pause();
    expect((await chain.getVault()).paused).toBe(true);
    expect(await chain.simulate(repayAction)).toEqual({ ok: false, error: 'Paused' });
    expect(await chain.getTx(txHash)).toMatchObject({ status: 'mined', success: true });
  });

  test('demo controls are disabled unless explicitly enabled', async () => {
    const chain = new MockChainPort(config({ demoEnabled: false }));
    await expect(chain.demoSetPrice(TEST_ADDRESSES.mWETH, 1_000_000_000_000n)).rejects.toThrow(/demo-only/i);
    await expect(chain.demoSetPoolPaused(0, true)).rejects.toThrow(/demo-only/i);
  });

  test('demoSetPrice updates the oracle timestamp and demoSetPoolPaused blocks the pool', async () => {
    const chain = new MockChainPort(config());
    await chain.demoSetPrice(TEST_ADDRESSES.mWETH, 1_000_000_000_000n);
    const [price] = await chain.getPrices([TEST_ADDRESSES.mWETH]);
    expect(price?.priceUsd8).toBe(1_000_000_000_000n);
    expect(price?.updatedAt).toBe(FIXTURE_NOW + 12n);

    await chain.demoSetPoolPaused(0, true);
    expect(await chain.simulate(repayAction)).toMatchObject({
      ok: false,
      error: 'Unknown',
      raw: 'PoolPaused',
    });
    const result = await chain.submit(repayAction);
    expect(result).toMatchObject({ status: 'reverted', error: 'Unknown' });
    expect(chain.getActionEvents()).toEqual([]);
  });
});
