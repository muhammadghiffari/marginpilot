import { describe, expect, test } from 'vitest';

import {
  ActionSchema,
  MandateSchema,
  PlanSchema,
  parseJson,
  encodeJson,
  canonicalJson,
} from '../src/index.js';

const owner = '0x0000000000000000000000000000000000000001' as const;
const vault = '0x0000000000000000000000000000000000000002' as const;
const lending = '0x0000000000000000000000000000000000000003' as const;
const usdc = '0x0000000000000000000000000000000000000004' as const;

const mandate = {
  id: 7n,
  validFrom: 1_700_000_000n,
  validUntil: 1_700_086_400n,
  maxTotalSpendUsd: 26_000_000_000n,
  maxPerActionUsd: 26_000_000_000n,
  minLiquidReserveUsd: 10_000_000_000n,
  maxSlippageBps: 100,
  maxPriceAgeSec: 600,
  maxPriceDeviationBps: 300,
  allowedActions: 3,
  allowBorrow: false,
  allowedTargets: [lending],
  lockedTokens: [usdc],
};

const action = {
  mandateId: 7n,
  nonce: 3n,
  actionType: 'REPAY' as const,
  target: lending,
  poolId: 0,
  tokenIn: usdc,
  tokenOut: null,
  amount: 86_570_000n,
  minAmountOut: 0n,
  quotedPriceUsd8: 100_000_000n,
  deadline: 1_700_000_120n,
};

describe('bigint boundary codec', () => {
  test('round-trips a mandate without losing bigint precision', () => {
    const wire = encodeJson(mandate);
    expect(wire).toMatchObject({ id: '7', maxTotalSpendUsd: '26000000000' });
    expect(parseJson(MandateSchema, wire)).toEqual(mandate);
    expect(JSON.parse(JSON.stringify(wire))).toEqual(wire);
  });

  test('round-trips an action with a null tokenOut', () => {
    const wire = encodeJson(action);
    expect(parseJson(ActionSchema, wire)).toEqual(action);
  });

  test('round-trips a nested plan', () => {
    const plan = {
      planId: 'fixture-1',
      version: 1,
      basedOnBlock: 42n,
      actions: [
        {
          index: 0,
          action,
          rationale: {
            poolId: 0,
            hfBefore: 942_857_142_857_142_857n,
            hfAfterExpected: 1_005_000_000_000_000_000n,
            lossBeforeUsd8: 3_500_000_000n,
            lossAfterUsd8: 0n,
            spendUsd8: 8_657_000_000n,
            levelName: 'safe-now',
          },
        },
      ],
      totalSpendUsd8: 8_657_000_000n,
      expectedLossUsd8: 16_417_900_000n,
      unsavedPools: [1],
    };
    expect(parseJson(PlanSchema, encodeJson(plan))).toEqual(plan);
  });
});

const mandateWire = encodeJson(mandate) as Record<string, unknown>;
const actionWire = encodeJson(action) as Record<string, unknown>;

describe('strict boundary validation', () => {
  test('rejects unknown mandate fields', () => {
    expect(() => parseJson(MandateSchema, { ...mandateWire, surprise: '1' })).toThrow(/unrecognized key/i);
  });

  test('rejects malformed addresses and non-decimal bigint encodings', () => {
    expect(() => parseJson(ActionSchema, { ...actionWire, target: '0x1234' })).toThrow(/20-byte/i);
    expect(() => parseJson(ActionSchema, { ...actionWire, amount: 86_570_000 })).toThrow();
    expect(() => parseJson(ActionSchema, { ...actionWire, amount: '-1' })).toThrow(/unsigned decimal/i);
    expect(() => parseJson(ActionSchema, { ...actionWire, amount: '086' })).toThrow(/unsigned decimal/i);
  });

  test('rejects out-of-range solidity integers', () => {
    expect(() => parseJson(MandateSchema, { ...mandateWire, id: '18446744073709551616' })).toThrow();
    expect(() => parseJson(MandateSchema, { ...mandateWire, maxSlippageBps: 10_001 })).toThrow();
    expect(() => parseJson(MandateSchema, { ...mandateWire, allowedActions: 256 })).toThrow();
  });

  test('canonical JSON sorts keys recursively and preserves bigint digits', () => {
    const a = canonicalJson({ z: 9n, a: { y: 2, b: 1n }, list: [{ d: 4n, c: 3 }] });
    const b = canonicalJson({ list: [{ c: 3, d: 4n }], a: { b: 1n, y: 2 }, z: 9n });
    expect(a).toBe(b);
    expect(a).toBe('{"a":{"b":"1","y":2},"list":[{"c":3,"d":"4"}],"z":"9"}');
  });

  test('encoding refuses values JSON cannot represent safely', () => {
    const cyclic: Record<string, unknown> = {};
    cyclic['self'] = cyclic;
    expect(() => encodeJson(cyclic)).toThrow(/cyclic/i);
    expect(() => encodeJson(Number.POSITIVE_INFINITY)).toThrow(/finite/i);
    expect(() => encodeJson(new Date())).toThrow(/plain object/i);
    expect(() => encodeJson(undefined)).toThrow(/unsupported/i);
  });
});

describe('no secrets in fixtures', () => {
  test('fixture addresses are documentation-only placeholders', () => {
    expect(owner).toMatch(/^0x0{39}1$/);
    expect(vault).toMatch(/^0x0{39}2$/);
  });
});
