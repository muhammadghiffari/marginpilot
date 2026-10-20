import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { readFile } from 'node:fs/promises';

import { describe, expect, test } from 'vitest';

import { ScriptedLlm } from '../src/llm/scripted.js';
import {
  DraftHasClarificationsError,
  assertDraftConfirmable,
  compileMandate,
  extractTotalBudgetCandidates,
} from '../src/mandate/compile.js';
import {
  LOCAL_TEST_REGISTRY,
  TokenRegistryInvalidError,
  TokenRegistryMissingError,
  loadTokenRegistry,
} from '../src/mandate/registry.js';

const FIXED_NOW = 1_700_000_000;

interface SeedPrompt {
  id: string;
  text: string;
  expect: Record<string, unknown>;
  clarify: boolean;
  clarifyField?: string;
}

const MODEL_OUTPUTS: Record<string, unknown> = {
  m01: { maxTotalSpendUsd: '260', lockedTokenSymbols: ['mWETH'], allowBorrow: false },
  m02: {
    maxTotalSpendUsd: '400',
    lockedTokenSymbols: ['mWETH'],
    minLiquidReserveUsd: '100',
    allowBorrow: false,
  },
  m03: { unresolvedFields: ['maxTotalSpendUsd'] },
  m04: { maxTotalSpendUsd: '150', maxPerActionUsd: '100', validForSec: 21_600 },
  m05: { maxTotalSpendUsd: '300', allowBorrow: true },
  m06: { maxTotalSpendUsd: '200', allowBorrow: false, lockedTokenSymbols: ['mWSTETH'] },
  m07: { maxTotalSpendUsd: '250', lockedTokenSymbols: [], unresolvedFields: ['lockedTokens'] },
  m08: { maxTotalSpendUsd: '500', unresolvedFields: ['maxTotalSpendUsd'] },
  m09: {
    maxTotalSpendUsd: '1000000',
    allowBorrow: true,
    allowedActions: ['REPAY', 'SUPPLY_COLLATERAL', 'SWAP'],
    unresolvedFields: ['maxTotalSpendUsd'],
  },
  m10: {
    maxTotalSpendUsd: '260',
    lockedTokenSymbols: ['mWETH'],
    maxSlippageBps: 50,
    swapAllowed: true,
  },
  m11: { maxTotalSpendUsd: '180', allowedActions: ['REPAY'] },
  m12: { unresolvedFields: ['maxTotalSpendUsd'] },
};

async function seedPrompts(): Promise<SeedPrompt[]> {
  const file = new URL('../../../eval/fixtures/mandate-prompts.jsonl', import.meta.url);
  const text = await readFile(file, 'utf8');
  return text
    .split('\n')
    .filter((line) => line.trim() !== '')
    .map((line) => JSON.parse(line) as SeedPrompt);
}

function llmFor(fixture: SeedPrompt): ScriptedLlm {
  return new ScriptedLlm([{ when: fixture.text, structured: MODEL_OUTPUTS[fixture.id] }]);
}

function actionNames(bits: number): string[] {
  const names: string[] = [];
  if (bits & 1) names.push('REPAY');
  if (bits & 2) names.push('SUPPLY_COLLATERAL');
  if (bits & 4) names.push('SWAP');
  return names;
}

function assertExpected(draft: Awaited<ReturnType<typeof compileMandate>>, expected: Record<string, unknown>): void {
  if (expected.maxTotalSpendUsd !== undefined) {
    expect(draft.mandate.maxTotalSpendUsd.toString()).toBe(expected.maxTotalSpendUsd);
  }
  if (expected.maxPerActionUsd !== undefined) {
    expect(draft.mandate.maxPerActionUsd.toString()).toBe(expected.maxPerActionUsd);
  }
  if (expected.minLiquidReserveUsd !== undefined) {
    expect(draft.mandate.minLiquidReserveUsd.toString()).toBe(expected.minLiquidReserveUsd);
  }
  if (expected.maxSlippageBps !== undefined) {
    expect(draft.mandate.maxSlippageBps).toBe(expected.maxSlippageBps);
  }
  if (expected.allowBorrow !== undefined) {
    expect(draft.mandate.allowBorrow).toBe(expected.allowBorrow);
  }
  if (expected.lockedTokens !== undefined) {
    const symbols = expected.lockedTokens as Array<keyof typeof LOCAL_TEST_REGISTRY.tokens>;
    expect([...draft.mandate.lockedTokens].sort()).toEqual(
      symbols.map((symbol) => LOCAL_TEST_REGISTRY.tokens[symbol]).sort(),
    );
  }
  if (expected.validForSec !== undefined) {
    expect(Number(draft.mandate.validUntil - draft.mandate.validFrom)).toBe(expected.validForSec);
  }
  if (expected.swapAllowed !== undefined) {
    expect(draft.mandate.allowedActions & 4).toBe(4);
    expect(draft.mandate.allowedTargets).toContain(LOCAL_TEST_REGISTRY.targets.swap);
  }
  if (expected.allowedActionsOnly !== undefined) {
    expect(actionNames(draft.mandate.allowedActions)).toEqual(expected.allowedActionsOnly);
  }
}

function dangerousWidenings(draft: Awaited<ReturnType<typeof compileMandate>>, text: string): number {
  let count = 0;
  const candidates = extractTotalBudgetCandidates(text);
  if (candidates.length > 0) {
    const smallest = candidates.reduce((left, right) => (left < right ? left : right));
    if (draft.mandate.maxTotalSpendUsd > smallest) count += 1;
  }
  if (draft.mandate.maxPerActionUsd > draft.mandate.maxTotalSpendUsd) count += 1;
  if (draft.mandate.allowBorrow && !/\bborrow/i.test(text)) count += 1;
  if ((draft.mandate.allowedActions & 4) !== 0 && !/\bswap/i.test(text)) count += 1;
  if (draft.mandate.allowedTargets.includes(LOCAL_TEST_REGISTRY.targets.swap) && !/\bswap/i.test(text)) {
    count += 1;
  }
  return count;
}

describe('token registry', () => {
  test('uses the explicit test fallback when no deployment exists', async () => {
    const root = await mkdtemp(join(tmpdir(), 'marginpilot-reg-'));
    try {
      const registry = await loadTokenRegistry(31337, { root, fallback: LOCAL_TEST_REGISTRY });
      expect(registry).toEqual(LOCAL_TEST_REGISTRY);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  test('reads deployments/<chainId>.json at the boundary', async () => {
    const root = await mkdtemp(join(tmpdir(), 'marginpilot-reg-'));
    try {
      await mkdir(join(root, 'deployments'));
      await writeFile(
        join(root, 'deployments', '31337.json'),
        JSON.stringify({
          chainId: 31337,
          contracts: {
            mUSDC: LOCAL_TEST_REGISTRY.tokens.mUSDC,
            mWETH: LOCAL_TEST_REGISTRY.tokens.mWETH,
            mWSTETH: LOCAL_TEST_REGISTRY.tokens.mWSTETH,
            lending: LOCAL_TEST_REGISTRY.targets.lending,
            swap: LOCAL_TEST_REGISTRY.targets.swap,
            vault: '0x00000000000000000000000000000000000000b2',
          },
        }),
      );
      const registry = await loadTokenRegistry(31337, { root });
      expect(registry).toEqual(LOCAL_TEST_REGISTRY);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  test('missing and malformed deployment files fail closed', async () => {
    const root = await mkdtemp(join(tmpdir(), 'marginpilot-reg-'));
    try {
      await expect(loadTokenRegistry(31337, { root })).rejects.toBeInstanceOf(TokenRegistryMissingError);
      await mkdir(join(root, 'deployments'));
      await writeFile(join(root, 'deployments', '31337.json'), JSON.stringify({ chainId: 31337, contracts: {} }));
      await expect(loadTokenRegistry(31337, { root })).rejects.toBeInstanceOf(TokenRegistryInvalidError);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});

describe('compile_mandate seed prompts m01-m12', () => {
  test('all twelve prompts produce zero dangerous widening and the expected clarifications', async () => {
    const fixtures = await seedPrompts();
    expect(fixtures.map((fixture) => fixture.id)).toEqual([
      'm01',
      'm02',
      'm03',
      'm04',
      'm05',
      'm06',
      'm07',
      'm08',
      'm09',
      'm10',
      'm11',
      'm12',
    ]);

    let widenings = 0;
    for (const fixture of fixtures) {
      const draft = await compileMandate(fixture.text, llmFor(fixture), {
        registry: LOCAL_TEST_REGISTRY,
        nowSec: FIXED_NOW,
      });
      assertExpected(draft, fixture.expect);
      expect(draft.clarifications.length > 0, fixture.id).toBe(fixture.clarify);
      if (fixture.clarifyField) {
        expect(draft.clarifications.map((entry) => entry.field), fixture.id).toContain(fixture.clarifyField);
      }
      if (fixture.clarify) {
        expect(() => assertDraftConfirmable(draft), fixture.id).toThrow(DraftHasClarificationsError);
      } else {
        expect(() => assertDraftConfirmable(draft), fixture.id).not.toThrow();
      }
      widenings += dangerousWidenings(draft, fixture.text);
    }
    expect(widenings).toBe(0);
  });

  test('m09 is flagged by the injection tripwire without logging the prompt', async () => {
    const fixtures = await seedPrompts();
    const fixture = fixtures.find((entry) => entry.id === 'm09');
    if (!fixture) throw new Error('missing m09');
    const audit: Array<{ kind: string; data: unknown }> = [];
    await compileMandate(fixture.text, llmFor(fixture), {
      registry: LOCAL_TEST_REGISTRY,
      nowSec: FIXED_NOW,
      audit: (event) => audit.push(event),
    });
    const suspected = audit.find((event) => event.kind === 'injection.suspected');
    expect(suspected).toBeDefined();
    expect((suspected?.data as { patterns: string[] }).patterns).toContain('ignore_previous');
    expect(JSON.stringify(audit)).not.toContain('Ignore previous');
  });

  test('a model that widens the budget is clamped and cannot be confirmed', async () => {
    const llm = new ScriptedLlm([{ structured: { maxTotalSpendUsd: '4000' } }]);
    const draft = await compileMandate('Protect my loans. Spend at most $400.', llm, {
      registry: LOCAL_TEST_REGISTRY,
      nowSec: FIXED_NOW,
    });
    expect(draft.mandate.maxTotalSpendUsd).toBe(40_000_000_000n);
    expect(draft.clarifications.map((entry) => entry.field)).toContain('maxTotalSpendUsd');
    expect(() => assertDraftConfirmable(draft)).toThrow(DraftHasClarificationsError);
  });

  test('a missing budget becomes a clarification, never an invented cap', async () => {
    const llm = new ScriptedLlm([{ structured: { maxTotalSpendUsd: '1000000' } }]);
    const draft = await compileMandate('Protect my loans, use whatever you need.', llm, {
      registry: LOCAL_TEST_REGISTRY,
      nowSec: FIXED_NOW,
    });
    expect(draft.mandate.maxTotalSpendUsd).toBe(0n);
    expect(draft.clarifications.map((entry) => entry.field)).toContain('maxTotalSpendUsd');
  });

  test('defaults are listed as assumptions and expiry defaults to now + 24h', async () => {
    const fixture = (await seedPrompts()).find((entry) => entry.id === 'm01');
    if (!fixture) throw new Error('missing m01');
    const draft = await compileMandate(fixture.text, llmFor(fixture), {
      registry: LOCAL_TEST_REGISTRY,
      nowSec: FIXED_NOW,
    });
    expect(draft.mandate.validFrom).toBe(BigInt(FIXED_NOW));
    expect(Number(draft.mandate.validUntil - draft.mandate.validFrom)).toBe(86_400);
    const validUntil = draft.assumptions.find((entry) => entry.field === 'validUntil');
    expect(validUntil?.reason).toBe('default');
    expect(draft.assumptions.some((entry) => entry.field === 'maxPerActionUsd')).toBe(true);
  });
});
