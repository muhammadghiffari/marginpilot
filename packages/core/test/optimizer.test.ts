import { describe, expect, test } from 'vitest';

import {
  DEFAULT_OPTIMIZER_PARAMS,
  MAX_UINT256,
  candidateRepayLevels,
  expectedLossUsd8,
  healthFactorWad,
  localThresholdBaseline,
  optimizeRescue,
  type OptimizerInput,
  type PositionSnapshot,
  type PriceSnapshot,
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

function baseInput(overrides: Partial<OptimizerInput> = {}): OptimizerInput {
  return {
    positions: fixturePositions,
    prices: fixturePrices,
    mandate: fixtureMandate,
    vault: fixtureVault,
    market: fixtureMarket,
    ...overrides,
  };
}

const POOL_A = fixturePositions[0] as PositionSnapshot;
const POOL_B = fixturePositions[1] as PositionSnapshot;
const CENT_RAW_USDC = 10_000n;

describe('pinned fixture (OPTIMIZER §6, eval/worked_example.py)', () => {
  test('reproduces candidate levels in cents', () => {
    expect(candidateRepayLevels(POOL_A, fixturePrices).map((level) => [level.amount, level.name])).toEqual([
      [0n, 'none'],
      [86_570_000n, 'safe-now'],
      [200_000_000n, 'target'],
      [217_920_000n, 'safe-stress'],
    ]);
    expect(candidateRepayLevels(POOL_B, fixturePrices).map((level) => [level.amount, level.name])).toEqual([
      [0n, 'none'],
      [123_640_000n, 'target'],
      [163_590_000n, 'safe-stress'],
    ]);
  });

  test('selects the global optimum with exact spend and expected loss', () => {
    const plan = optimizeRescue(baseInput());
    expect(plan.actions.map(({ index, action, rationale }) => [index, action.amount, rationale.levelName])).toEqual([
      [0, 86_570_000n, 'safe-now'],
      [1, 163_590_000n, 'safe-stress'],
    ]);
    expect(plan.totalSpendUsd8).toBe(25_016_000_000n);
    expect(plan.expectedLossUsd8).toBe(1_641_787_500n);
    expect(Number(plan.expectedLossUsd8) / 1e8).toBeCloseTo(16.417875, 8);
    expect(plan.unsavedPools).toEqual([]);
    expect(plan.haltReason).toBeUndefined();
  });

  test('builds deterministic REPAY actions with consecutive nonces', () => {
    const plan = optimizeRescue(baseInput());
    expect(plan.actions.map(({ action }) => action)).toEqual([
      {
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
      },
      {
        mandateId: 1n,
        nonce: 8n,
        actionType: 'REPAY',
        target: TEST_ADDRESSES.lending,
        poolId: 1,
        tokenIn: TEST_ADDRESSES.mUSDC,
        tokenOut: null,
        amount: 163_590_000n,
        minAmountOut: 0n,
        quotedPriceUsd8: 100_000_000n,
        deadline: FIXTURE_NOW + 120n,
      },
    ]);
    expect(plan.planId).toMatch(/^0x[0-9a-f]{64}$/);
    expect(plan.basedOnBlock).toBe(100n);
  });

  test('local threshold automation spends 200.00 and loses 64.00', () => {
    const baseline = localThresholdBaseline(baseInput());
    expect(baseline.allocations.map(({ poolId, amount, levelName }) => [poolId, amount, levelName])).toEqual([
      [0, 200_000_000n, 'target'],
      [1, 0n, 'none'],
    ]);
    expect(baseline.totalSpendUsd8).toBe(20_000_000_000n);
    expect(baseline.expectedLossUsd8).toBe(6_400_000_000n);
    expect(baseline.unsavedPools).toEqual([1]);
  });

  test('shuffled input order produces a byte-identical plan', () => {
    const plan = optimizeRescue(baseInput());
    const shuffled = optimizeRescue(
      baseInput({ positions: [POOL_B, POOL_A], prices: [...fixturePrices].reverse() }),
    );
    expect(shuffled).toEqual(plan);
  });
});

describe('rounding and budget behavior', () => {
  test('safe-now is rounded up to a whole cent and one cent less under-protects', () => {
    const safeNow = candidateRepayLevels(POOL_A, fixturePrices).find((level) => level.name === 'safe-now');
    expect(safeNow).toBeDefined();
    expect(safeNow?.amount).toBe(86_570_000n);
    expect(safeNow?.amount && safeNow.amount % CENT_RAW_USDC).toBe(0n);
    expect(safeNow?.hfAfterWad).toBeGreaterThanOrEqual(DEFAULT_OPTIMIZER_PARAMS.hfSafeEpsWad);
    const oneCentLess = healthFactorWad({
      collateral: POOL_A.collateral,
      collateralDecimals: 18,
      collateralPriceUsd8: 160_000_000_000n,
      ltBps: POOL_A.ltBps,
      debt: POOL_A.debt - ((safeNow?.amount ?? 0n) - CENT_RAW_USDC),
      debtDecimals: 6,
      debtPriceUsd8: 100_000_000n,
    });
    expect(oneCentLess).toBeLessThan(DEFAULT_OPTIMIZER_PARAMS.hfSafeEpsWad);
  });

  test('a $150 cap protects the best pool and reports the other as unsaved', () => {
    const plan = optimizeRescue(
      baseInput({ mandate: { ...fixtureMandate, maxTotalSpendUsd: 15_000_000_000n } }),
    );
    expect(plan.actions.map(({ action }) => action.poolId)).toEqual([0]);
    expect(plan.actions[0]?.action.amount).toBe(86_570_000n);
    expect(plan.totalSpendUsd8).toBe(8_657_000_000n);
    expect(plan.unsavedPools).toEqual([1]);
    expect(plan.haltReason).toBeUndefined();
  });

  test('a $50 cap cannot improve any pool and halts with the cheapest useful amount', () => {
    const plan = optimizeRescue(
      baseInput({ mandate: { ...fixtureMandate, maxTotalSpendUsd: 5_000_000_000n } }),
    );
    expect(plan.actions).toEqual([]);
    expect(plan.unsavedPools).toEqual([0, 1]);
    expect(plan.haltReason).toEqual({
      kind: 'BUDGET_INSUFFICIENT',
      neededUsd8: 8_657_000_000n,
      availableUsd8: 5_000_000_000n,
    });
  });

  test('includes already-spent budget in the remaining cap', () => {
    const plan = optimizeRescue(
      baseInput({
        mandate: { ...fixtureMandate, maxTotalSpendUsd: 26_000_000_000n },
        vault: { ...fixtureVault, spentUsd8: 25_000_000_000n },
      }),
    );
    expect(plan.haltReason?.kind).toBe('BUDGET_INSUFFICIENT');
    expect(plan.totalSpendUsd8).toBe(0n);
  });

  test('ignores a zero-debt position', () => {
    const zeroDebt: PositionSnapshot = { ...POOL_B, debt: 0n, healthFactor: MAX_UINT256 };
    const plan = optimizeRescue(baseInput({ positions: [POOL_A, zeroDebt] }));
    expect(plan.actions.map(({ action }) => [action.poolId, action.amount])).toEqual([[0, 217_920_000n]]);
    expect(plan.unsavedPools).toEqual([]);
    expect(plan.expectedLossUsd8).toBe(0n);
  });
});

describe('brute-force cross-check on seeded random inputs', () => {
  function rng(seed: number): () => number {
    let state = seed >>> 0;
    return () => {
      state = (Math.imul(state, 1_664_525) + 1_013_904_223) >>> 0;
      return state / 0x1_0000_0000;
    };
  }

  test('chosen expected loss equals the exhaustive minimum for 24 random two-pool states', () => {
    const random = rng(20261020);
    const spendable = 26_000_000_000n;
    for (let caseNo = 0; caseNo < 24; caseNo += 1) {
      const makePosition = (poolId: 0 | 1, collateralToken: `0x${string}`): PositionSnapshot => {
        const units = BigInt(1 + Math.floor(random() * 4));
        const price = BigInt(1_200 + Math.floor(random() * 1_000)) * 100_000_000n;
        const debt = BigInt(700 + Math.floor(random() * 3_300)) * 1_000_000n;
        return {
          poolId,
          collateralToken,
          debtToken: TEST_ADDRESSES.mUSDC,
          collateral: units * 10n ** 18n,
          debt,
          healthFactor: 0n,
          ltBps: 7_500 + Math.floor(random() * 1_000),
          liqBonusBps: 300 + Math.floor(random() * 600),
          closeFactorBps: 5_000,
        };
      };
      const positions = [
        makePosition(0, TEST_ADDRESSES.mWETH),
        makePosition(1, TEST_ADDRESSES.mWSTETH),
      ] satisfies PositionSnapshot[];
      const prices: PriceSnapshot[] = [
        { token: TEST_ADDRESSES.mUSDC, priceUsd8: 100_000_000n, updatedAt: FIXTURE_NOW },
        { token: TEST_ADDRESSES.mWETH, priceUsd8: BigInt(1_200 + Math.floor(random() * 1_000)) * 100_000_000n, updatedAt: FIXTURE_NOW },
        { token: TEST_ADDRESSES.mWSTETH, priceUsd8: BigInt(1_400 + Math.floor(random() * 1_200)) * 100_000_000n, updatedAt: FIXTURE_NOW },
      ];
      const input = baseInput({
        positions,
        prices,
        mandate: { ...fixtureMandate, maxTotalSpendUsd: spendable },
        vault: { ...fixtureVault, spentUsd8: 0n },
      });
      const plan = optimizeRescue(input);
      const levels = positions.map((position) => candidateRepayLevels(position, prices));
      let bestLoss: bigint | null = null;
      for (const a of levels[0] ?? []) {
        for (const b of levels[1] ?? []) {
          if (a.spendUsd8 + b.spendUsd8 > spendable) continue;
          const loss = a.expectedLossUsd8 + b.expectedLossUsd8;
          if (bestLoss === null || loss < bestLoss) bestLoss = loss;
        }
      }
      expect(plan.expectedLossUsd8).toBe(bestLoss);
      expect(plan.totalSpendUsd8).toBeLessThanOrEqual(spendable);
      expect(
        plan.actions.reduce((sum, { rationale }) => sum + rationale.spendUsd8, 0n),
      ).toBe(plan.totalSpendUsd8);
      expect(plan.actions.every(({ rationale }) => rationale.lossAfterUsd8 <= rationale.lossBeforeUsd8)).toBe(true);
      expect(
        plan.expectedLossUsd8,
      ).toBe(plan.actions.reduce((sum, { rationale }) => sum + rationale.lossAfterUsd8, 0n) + sumNoneLoss(plan, positions, prices));
    }
  });

  function sumNoneLoss(
    plan: ReturnType<typeof optimizeRescue>,
    positions: PositionSnapshot[],
    prices: PriceSnapshot[],
  ): bigint {
    const acted = new Set(plan.actions.map(({ action }) => action.poolId));
    return positions
      .filter((position) => !acted.has(position.poolId))
      .reduce((sum, position) => sum + expectedLossUsd8(position, 0n, prices), 0n);
  }
});
