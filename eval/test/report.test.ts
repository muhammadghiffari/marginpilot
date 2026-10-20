import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, test } from 'vitest';
import { simulatePart1 } from '../src/part1-simulation.js';
import { summarizePart1, writePart1Report } from '../src/report.js';

describe('Part 1 generated evaluation report', () => {
  test('reports wins, ties, losses and deterministic bootstrap 95% CI without discarding cases', () => {
    const rows = simulatePart1({ firstSeed: 1, count: 3 });
    const scored = rows.map((row, index) => ({
      ...row,
      a: { ...row.a, realizedLossUsd8: [1_000_000_000n, 200_000_000n, 100_000_000n][index] ?? 0n },
      b: { ...row.b, realizedLossUsd8: [500_000_000n, 200_000_000n, 300_000_000n][index] ?? 0n },
    }));
    const summary = summarizePart1(scored, { bootstrapSeed: 17, replicates: 200 });
    expect(summary.sampleCount).toBe(3);
    expect(summary.realizedComparison).toMatchObject({ wins: 1, ties: 1, losses: 1 });
    expect(summary.realizedComparison.meanDifferenceUsd).toBeCloseTo(-1);
    expect(summary.realizedComparison.bootstrap95Usd).toEqual(
      summarizePart1(scored, { bootstrapSeed: 17, replicates: 200 }).realizedComparison.bootstrap95Usd,
    );
    expect(summary.realizedComparison.bootstrap95Usd.lower).toBeLessThanOrEqual(summary.realizedComparison.bootstrap95Usd.upper);
    expect(summary.metrics.realizedLossUsd.a).toMatchObject({ mean: expect.any(Number), median: expect.any(Number), p90: expect.any(Number) });
  });

  test('writes only generated SIMULATED artifacts with seed and commit provenance', async () => {
    const outputRoot = await mkdtemp(join(tmpdir(), 'marginpilot-eval-'));
    try {
      const cases = simulatePart1({ firstSeed: 1, count: 2 });
      const output = await writePart1Report({
        cases, outputRoot, firstSeed: 1, commit: 'test-commit',
        timestamp: new Date('2026-10-20T09:00:00.000Z'), bootstrapSeed: 1,
      });
      const results = JSON.parse(await readFile(join(output.directory, 'results.json'), 'utf8')) as Record<string, unknown>;
      const meta = JSON.parse(await readFile(join(output.directory, 'run-meta.json'), 'utf8')) as Record<string, unknown>;
      const markdown = await readFile(join(output.directory, 'summary.md'), 'utf8');
      expect(results).toMatchObject({ part: 1, mode: 'SIMULATED', firstSeed: 1, count: 2 });
      expect((results.cases as unknown[])).toHaveLength(2);
      expect(meta).toMatchObject({ commit: 'test-commit', seedRange: [1, 2], model: null, chainId: null });
      expect(markdown).toContain('SIMULATED');
      expect(markdown).toContain('Win / tie / loss');
      expect(markdown).toContain('bootstrap 95% CI');
      expect(markdown).toContain('partial-target');
    } finally {
      await rm(outputRoot, { recursive: true, force: true });
    }
  });
});
