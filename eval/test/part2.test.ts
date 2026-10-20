import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, test } from 'vitest';

import { runPart2 } from '../src/part2-runner.js';

const created: string[] = [];

afterEach(async () => {
  await Promise.all(created.splice(0).map((directory) => rm(directory, { recursive: true, force: true })));
});

async function outputRoot(): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), 'marginpilot-part2-'));
  created.push(directory);
  return directory;
}

describe('B-12 Part 2 runner (SIMULATED MockChainPort)', () => {
  test('config D on S1 completes with two simulated txs and no intended-mandate violation', async () => {
    const directory = await outputRoot();
    const result = await runPart2({
      seed: 1,
      outputRoot: directory,
      commit: 'test-commit',
      configs: ['D'],
      scenarios: ['S1'],
      timestamp: new Date('2026-10-20T12:00:00Z'),
    });
    expect(result.rows).toHaveLength(1);
    const row = result.rows[0];
    if (row?.finalState !== 'COMPLETED') console.error('PART2 DEBUG', JSON.stringify(row));
    expect(row?.config).toBe('D');
    expect(row?.finalState).toBe('COMPLETED');
    expect(row?.txs).toBe(2);
    expect(row?.violationCount).toBe(0);
    expect(row?.falseCompletion).toBe(false);
    const summary = await readFile(join(result.directory, 'summary.md'), 'utf8');
    expect(summary.startsWith('SIMULATED (MockChainPort) — not on-chain evidence')).toBe(true);
    expect(summary).toContain('ablation of design choices, not a competitive benchmark');
    const meta = JSON.parse(await readFile(join(result.directory, 'run-meta.json'), 'utf8'));
    expect(meta.mode).toBe('SIMULATED');
    expect(meta.chainId).toBe(31337);
  });

  test('config C on S7/T15 mines the direct SWAP and records intended-mandate violations', async () => {
    const directory = await outputRoot();
    const result = await runPart2({
      seed: 1,
      outputRoot: directory,
      commit: 'test-commit',
      configs: ['C', 'D'],
      scenarios: ['S7'],
      timestamp: new Date('2026-10-20T12:00:01Z'),
    });
    const c = result.rows.find((row) => row.config === 'C');
    const d = result.rows.find((row) => row.config === 'D');
    expect(c?.txs).toBe(1);
    expect(c?.violationCount).toBeGreaterThan(0);
    expect(d?.txs).toBe(0);
    expect(d?.violationCount).toBe(0);
  });
});
