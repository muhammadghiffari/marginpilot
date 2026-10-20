import { describe, expect, test } from 'vitest';

import {
  checkAction,
  checkPostConditions,
  type Action,
  type Mandate,
  type PolicyContext,
  type PostConditionSnapshot,
  type PriceSnapshot,
} from '../src/index.js';
import {
  FIXTURE_NOW,
  TEST_ADDRESSES,
  fixtureMandate,
  fixturePrices,
  fixtureVault,
} from './fixtures.js';

const executor = '0x00000000000000000000000000000000000000e1' as const;
const stranger = '0x00000000000000000000000000000000000000e2' as const;
const swapTarget = '0x00000000000000000000000000000000000000b3' as const;

const context: PolicyContext = {
  caller: executor,
  executor,
  tokenDecimals: {
    [TEST_ADDRESSES.mUSDC]: 6,
    [TEST_ADDRESSES.mWETH]: 18,
    [TEST_ADDRESSES.mWSTETH]: 18,
  },
  pools: {
    0: { collateralToken: TEST_ADDRESSES.mWETH, debtToken: TEST_ADDRESSES.mUSDC },
    1: { collateralToken: TEST_ADDRESSES.mWSTETH, debtToken: TEST_ADDRESSES.mUSDC },
  },
  reserveToken: TEST_ADDRESSES.mUSDC,
  lendingSim: TEST_ADDRESSES.lending,
  swapTarget,
};

const baseAction: Action = {
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

const baseMandate: Mandate = { ...fixtureMandate, allowedTargets: [TEST_ADDRESSES.lending, swapTarget] };

function policy(
  mandate: Mandate | null = baseMandate,
  vault = fixtureVault,
  prices: PriceSnapshot[] = fixturePrices,
  action: Action = baseAction,
  now = FIXTURE_NOW,
  ctx: PolicyContext = context,
) {
  return checkAction(mandate, vault, prices, action, now, ctx);
}

describe('checkAction #1-#6 identity, pause, mandate and freshness windows', () => {
  test('#1 rejects a non-executor caller before every other check', () => {
    expect(policy(baseMandate, { ...fixtureVault, paused: true }, fixturePrices, baseAction, FIXTURE_NOW, { ...context, caller: stranger })).toEqual({ ok: false, error: 'NotExecutor' });
  });

  test('#2 rejects while the vault is paused', () => {
    expect(policy(baseMandate, { ...fixtureVault, paused: true })).toEqual({ ok: false, error: 'Paused' });
  });

  test('#3 rejects when no mandate is active', () => {
    expect(policy(null, { ...fixtureVault, activeMandateId: 0n })).toEqual({ ok: false, error: 'MandateInactive' });
  });

  test('#4 rejects a stale mandate id or action nonce', () => {
    expect(policy(baseMandate, fixtureVault, fixturePrices, { ...baseAction, mandateId: 2n })).toEqual({ ok: false, error: 'StaleAction' });
    expect(policy(baseMandate, fixtureVault, fixturePrices, { ...baseAction, nonce: 6n })).toEqual({ ok: false, error: 'StaleAction' });
  });

  test('#5 accepts deadline == now and rejects one second late', () => {
    expect(policy(baseMandate, fixtureVault, fixturePrices, { ...baseAction, deadline: FIXTURE_NOW })).toMatchObject({ ok: true });
    expect(policy(baseMandate, fixtureVault, fixturePrices, { ...baseAction, deadline: FIXTURE_NOW - 1n })).toEqual({ ok: false, error: 'DeadlineExpired' });
  });

  test('#6 rejects before validFrom and after validUntil', () => {
    expect(policy({ ...baseMandate, validFrom: FIXTURE_NOW + 1n })).toEqual({ ok: false, error: 'MandateExpired' });
    expect(policy({ ...baseMandate, validUntil: FIXTURE_NOW - 1n }, fixtureVault, fixturePrices, { ...baseAction, deadline: FIXTURE_NOW + 1_000n })).toEqual({ ok: false, error: 'MandateExpired' });
  });
});

describe('checkAction #7-#15 action limits', () => {
  test('#7 rejects a zero amount', () => {
    expect(policy(baseMandate, fixtureVault, fixturePrices, { ...baseAction, amount: 0n })).toEqual({ ok: false, error: 'ZeroAmount' });
  });

  test('#8a rejects BORROW when the mandate forbids it', () => {
    expect(policy(baseMandate, fixtureVault, fixturePrices, { ...baseAction, actionType: 'BORROW' })).toEqual({ ok: false, error: 'BorrowForbidden' });
  });

  test('#8b rejects an action whose allow bit is off', () => {
    const action: Action = {
      ...baseAction,
      actionType: 'SWAP',
      tokenOut: TEST_ADDRESSES.mWETH,
      amount: 100_000_000n,
      minAmountOut: 62_500_000_000_000_000n,
    };
    expect(policy(baseMandate, fixtureVault, fixturePrices, action)).toEqual({ ok: false, error: 'ActionNotAllowed' });
  });

  test('#9 rejects an unlisted target', () => {
    expect(policy(baseMandate, fixtureVault, fixturePrices, { ...baseAction, target: '0x00000000000000000000000000000000000000ff' })).toEqual({ ok: false, error: 'TargetNotAllowed' });
  });

  test('#10 rejects a locked token as REPAY input', () => {
    expect(policy(baseMandate, fixtureVault, fixturePrices, { ...baseAction, tokenIn: TEST_ADDRESSES.mWETH, amount: 1_000_000_000_000_000_000n })).toEqual({ ok: false, error: 'AssetLocked' });
  });

  test('#11a rejects a stale tokenIn price', () => {
    const stale = fixturePrices.map((price) => price.token === TEST_ADDRESSES.mUSDC ? { ...price, updatedAt: FIXTURE_NOW - 601n } : price);
    expect(policy(baseMandate, fixtureVault, stale)).toEqual({ ok: false, error: 'StalePrice' });
  });

  test('#11b covers the collateral price in a REPAY price set (D-023)', () => {
    const stale = fixturePrices.map((price) => price.token === TEST_ADDRESSES.mWETH ? { ...price, updatedAt: FIXTURE_NOW - 601n } : price);
    expect(policy(baseMandate, fixtureVault, stale)).toEqual({ ok: false, error: 'StalePrice' });
    const poolOne = { ...baseAction, poolId: 1, amount: 163_590_000n };
    expect(policy(baseMandate, fixtureVault, stale, poolOne)).toMatchObject({ ok: true });
  });

  test('#11 accepts age exactly maxPriceAgeSec and rejects a future timestamp', () => {
    const boundary = fixturePrices.map((price) => price.token === TEST_ADDRESSES.mUSDC ? { ...price, updatedAt: FIXTURE_NOW - 600n } : price);
    expect(policy(baseMandate, fixtureVault, boundary)).toMatchObject({ ok: true });
    const future = fixturePrices.map((price) => price.token === TEST_ADDRESSES.mUSDC ? { ...price, updatedAt: FIXTURE_NOW + 1n } : price);
    expect(policy(baseMandate, fixtureVault, future)).toEqual({ ok: false, error: 'StalePrice' });
  });

  test('#12 rejects quoted-price deviation above the limit and accepts exactly 300 bps', () => {
    expect(policy(baseMandate, fixtureVault, fixturePrices, { ...baseAction, quotedPriceUsd8: 97_087_378n })).toEqual({ ok: false, error: 'PriceDeviation' });
    expect(policy(baseMandate, fixtureVault, fixturePrices, { ...baseAction, quotedPriceUsd8: 97_087_379n })).toMatchObject({ ok: true });
  });

  test('#13 enforces the per-action cap with an exact boundary', () => {
    expect(policy({ ...baseMandate, maxPerActionUsd: 8_656_999_999n })).toEqual({ ok: false, error: 'PerActionCapExceeded' });
    expect(policy({ ...baseMandate, maxPerActionUsd: 8_657_000_000n })).toMatchObject({ ok: true, valueUsd8: 8_657_000_000n });
  });

  test('#14 enforces cumulative budget including spentUsd', () => {
    expect(policy(baseMandate, { ...fixtureVault, spentUsd8: 17_343_000_001n })).toEqual({ ok: false, error: 'BudgetExceeded' });
    expect(policy(baseMandate, { ...fixtureVault, spentUsd8: 17_343_000_000n })).toMatchObject({ ok: true });
  });

  test('#15 enforces oracle-fair SWAP slippage', () => {
    const swapMandate = { ...baseMandate, allowedActions: 7 };
    const swap: Action = {
      ...baseAction,
      actionType: 'SWAP',
      target: swapTarget,
      tokenOut: TEST_ADDRESSES.mWETH,
      amount: 100_000_000n,
      minAmountOut: 61_874_999_999_999_999n,
    };
    expect(policy(swapMandate, fixtureVault, fixturePrices, swap)).toEqual({ ok: false, error: 'SlippageExceeded' });
    expect(policy(swapMandate, fixtureVault, fixturePrices, { ...swap, minAmountOut: 61_875_000_000_000_000n })).toMatchObject({ ok: true });
  });
});

describe('checkAction target roles and the reserve price (D-030, D-031)', () => {
  const swapMandate = { ...baseMandate, allowedActions: 7 };
  const swapAction: Action = {
    ...baseAction,
    actionType: 'SWAP',
    target: swapTarget,
    tokenIn: TEST_ADDRESSES.mWSTETH,
    tokenOut: TEST_ADDRESSES.mWETH,
    amount: 1_000_000n,
    minAmountOut: 1_138_500n,
    quotedPriceUsd8: 184_000_000_000n,
  };

  test('a lending action at the swap address is a wrong-role target', () => {
    expect(policy(baseMandate, fixtureVault, fixturePrices, { ...baseAction, target: swapTarget })).toEqual({ ok: false, error: 'TargetNotAllowed' });
  });

  test('a SWAP at the lending address is a wrong-role target', () => {
    expect(policy(swapMandate, fixtureVault, fixturePrices, { ...swapAction, target: TEST_ADDRESSES.lending })).toEqual({ ok: false, error: 'TargetNotAllowed' });
  });

  test('the SWAP role check sits right after #9, ahead of #10 and the freshness loop (D-032)', () => {
    const wrongTarget = { ...swapAction, target: TEST_ADDRESSES.lending };
    // The vault rejects a SWAP at a LendingSim right after #9, so the role error beats a locked tokenIn.
    const lockedSwap = { ...wrongTarget, tokenIn: TEST_ADDRESSES.mWETH, tokenOut: TEST_ADDRESSES.mWSTETH, amount: 1_000_000n };
    expect(policy(swapMandate, fixtureVault, fixturePrices, lockedSwap)).toEqual({ ok: false, error: 'TargetNotAllowed' });
    const staleTokenIn = fixturePrices.map((price) => price.token === TEST_ADDRESSES.mWSTETH ? { ...price, updatedAt: FIXTURE_NOW - 601n } : price);
    expect(policy(swapMandate, fixtureVault, staleTokenIn, wrongTarget)).toEqual({ ok: false, error: 'TargetNotAllowed' });
    expect(policy(swapMandate, fixtureVault, fixturePrices, { ...wrongTarget, minAmountOut: 0n })).toEqual({ ok: false, error: 'TargetNotAllowed' });
    const rightTarget = { ...swapAction, minAmountOut: 0n };
    expect(policy(swapMandate, fixtureVault, fixturePrices, rightTarget)).toEqual({ ok: false, error: 'SlippageExceeded' });
  });

  test('the lending role check runs after #10 and before the freshness loop', () => {
    const lockedInput = { ...baseAction, target: swapTarget, tokenIn: TEST_ADDRESSES.mWETH, amount: 1_000_000_000_000_000_000n };
    expect(policy(baseMandate, fixtureVault, fixturePrices, lockedInput)).toEqual({ ok: false, error: 'AssetLocked' });
    const stale = fixturePrices.map((price) => price.token === TEST_ADDRESSES.mWETH ? { ...price, updatedAt: FIXTURE_NOW - 601n } : price);
    expect(policy(baseMandate, fixtureVault, stale, { ...baseAction, target: swapTarget })).toEqual({ ok: false, error: 'TargetNotAllowed' });
  });

  test('#11 the reserve token belongs to every action price set', () => {
    const staleReserve = fixturePrices.map((price) => price.token === TEST_ADDRESSES.mUSDC ? { ...price, updatedAt: FIXTURE_NOW - 601n } : price);
    expect(policy(swapMandate, fixtureVault, staleReserve, swapAction)).toEqual({ ok: false, error: 'StalePrice' });
    const missingReserve = fixturePrices.filter((price) => price.token !== TEST_ADDRESSES.mUSDC);
    expect(policy(swapMandate, fixtureVault, missingReserve, swapAction)).toEqual({ ok: false, error: 'StalePrice' });
  });
});

describe('checkPostConditions #16', () => {  const before: PostConditionSnapshot = { liquidReserveUsd8: 40_000_000_000n, healthFactor: 942_857_142_857_142_857n };

  test('rejects a reserve below the mandate floor', () => {
    expect(
      checkPostConditions(
        { action: baseAction, mandate: baseMandate },
        before,
        { liquidReserveUsd8: 9_999_999_999n, healthFactor: 1_005_000_000_000_000_000n },
      ),
    ).toEqual({ ok: false, error: 'PostConditionFailed' });
  });

  test('rejects a lending action that does not improve HF', () => {
    expect(
      checkPostConditions(
        { action: baseAction, mandate: baseMandate },
        before,
        { liquidReserveUsd8: 40_000_000_000n, healthFactor: 942_857_142_857_142_856n },
      ),
    ).toEqual({ ok: false, error: 'PostConditionFailed' });
  });

  test('accepts an equal HF on the boundary and ignores HF for SWAP', () => {
    expect(
      checkPostConditions(
        { action: baseAction, mandate: baseMandate },
        before,
        { liquidReserveUsd8: 10_000_000_000n, healthFactor: 942_857_142_857_142_857n },
      ),
    ).toEqual({ ok: true });
    const swapAction: Action = { ...baseAction, actionType: 'SWAP' };
    expect(
      checkPostConditions(
        { action: swapAction, mandate: baseMandate },
        before,
        { liquidReserveUsd8: 40_000_000_000n, healthFactor: 0n },
      ),
    ).toEqual({ ok: true });
  });
});
