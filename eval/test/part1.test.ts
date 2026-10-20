import { describe, expect, test } from 'vitest';
import { simulatePart1 } from '../src/part1-simulation.js';

describe('Part 1 pure simulation (SIMULATED, no chain or LLM)', () => {
  test('seeds 1..3 are reproducible, independent and within the shared budget', () => {
    const first = simulatePart1({ firstSeed: 1, count: 3 });
    expect(first).toEqual(simulatePart1({ firstSeed: 1, count: 3 }));
    expect(first).toHaveLength(3);
    expect(first.map((row) => row.seed)).toEqual([1, 2, 3]);
    expect(first).not.toEqual(simulatePart1({ firstSeed: 2, count: 3 }));
    for (const row of first) {
      expect(row.positions).toHaveLength(2);
      for (const position of row.positions) {
        expect(position.initialShockBps).toBeGreaterThanOrEqual(500);
        expect(position.initialShockBps).toBeLessThanOrEqual(2_500);
        expect(position.postShockPriceUsd8).toBe(
          position.preShockPriceUsd8 * BigInt(10_000 - position.initialShockBps) / 10_000n,
        );
      }
      expect(row.a.spentUsd8).toBeLessThanOrEqual(row.spendableUsd8);
      expect(row.b.spentUsd8).toBeLessThanOrEqual(row.spendableUsd8);
      expect(row.a.realizedLossUsd8).toBeGreaterThanOrEqual(0n);
      expect(row.b.realizedLossUsd8).toBeGreaterThanOrEqual(0n);
      expect(row.a.safePools).toBeGreaterThanOrEqual(0);
      expect(row.b.safePools).toBeLessThanOrEqual(2);
    }
  });

  test('rejects invalid seeds and counts instead of silently changing the study', () => {
    expect(() => simulatePart1({ firstSeed: 0, count: 1 })).toThrow();
    expect(() => simulatePart1({ firstSeed: 1, count: 0 })).toThrow();
  });
});
