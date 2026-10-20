import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { encodeJson } from '@marginpilot/core';
import type { Part1Case } from './part1-simulation.js';

export interface DescriptiveStats { mean: number; median: number; p90: number }
export interface Comparison {
  wins: number;
  ties: number;
  losses: number;
  meanDifferenceUsd: number;
  bootstrap95Usd: { lower: number; upper: number };
}
export interface Part1Summary {
  sampleCount: number;
  metrics: Record<'expectedLossUsd' | 'realizedLossUsd' | 'spentUsd' | 'safePools', {
    a: DescriptiveStats; b: DescriptiveStats;
  }>;
  realizedComparison: Comparison;
  expectedComparison: Comparison;
}

function percentile(sorted: number[], fraction: number): number {
  if (sorted.length === 0) throw new RangeError('empty statistical sample');
  const index = Math.ceil(fraction * sorted.length) - 1;
  return sorted[Math.max(0, Math.min(sorted.length - 1, index))] ?? 0;
}

function stats(values: number[]): DescriptiveStats {
  if (values.length === 0) throw new RangeError('empty statistical sample');
  const ordered = [...values].sort((left, right) => left - right);
  const mid = Math.floor(ordered.length / 2);
  const median = ordered.length % 2 === 0
    ? ((ordered[mid - 1] ?? 0) + (ordered[mid] ?? 0)) / 2
    : ordered[mid] ?? 0;
  return { mean: values.reduce((sum, value) => sum + value, 0) / values.length,
    median, p90: percentile(ordered, 0.9) };
}

function usd(value: bigint): number { return Number(value) / 100_000_000; }

function bootstrapDifferences(differences: number[], seed: number, replicates: number): Comparison['bootstrap95Usd'] {
  if (!Number.isSafeInteger(seed) || seed < 1 || !Number.isSafeInteger(replicates) || replicates < 1) {
    throw new RangeError('bootstrap seed and replicates must be positive integers');
  }
  let state = seed >>> 0;
  const means: number[] = [];
  for (let repetition = 0; repetition < replicates; repetition += 1) {
    let total = 0;
    for (let index = 0; index < differences.length; index += 1) {
      state ^= state << 13;
      state ^= state >>> 17;
      state ^= state << 5;
      total += differences[(state >>> 0) % differences.length] ?? 0;
    }
    means.push(total / differences.length);
  }
  means.sort((left, right) => left - right);
  return { lower: percentile(means, 0.025), upper: percentile(means, 0.975) };
}

function compare(rows: Part1Case[], key: 'realizedLossUsd8' | 'expectedLossUsd8', seed: number, replicates: number): Comparison {
  const differences = rows.map((row) => usd(row.b[key] - row.a[key]));
  return {
    wins: rows.filter((row) => row.b[key] < row.a[key]).length,
    ties: rows.filter((row) => row.b[key] === row.a[key]).length,
    losses: rows.filter((row) => row.b[key] > row.a[key]).length,
    meanDifferenceUsd: stats(differences).mean,
    bootstrap95Usd: bootstrapDifferences(differences, seed, replicates),
  };
}

export function summarizePart1(rows: Part1Case[], options: { bootstrapSeed: number; replicates?: number }): Part1Summary {
  if (rows.length === 0) throw new RangeError('cannot summarize empty evaluation');
  if (new Set(rows.map((row) => row.seed)).size !== rows.length) throw new Error('duplicate case seed');
  const metric = (read: (row: Part1Case, name: 'a' | 'b') => number) => ({
    a: stats(rows.map((row) => read(row, 'a'))),
    b: stats(rows.map((row) => read(row, 'b'))),
  });
  const replicates = options.replicates ?? 2_000;
  return {
    sampleCount: rows.length,
    metrics: {
      expectedLossUsd: metric((row, name) => usd(row[name].expectedLossUsd8)),
      realizedLossUsd: metric((row, name) => usd(row[name].realizedLossUsd8)),
      spentUsd: metric((row, name) => usd(row[name].spentUsd8)),
      safePools: metric((row, name) => row[name].safePools),
    },
    realizedComparison: compare(rows, 'realizedLossUsd8', options.bootstrapSeed, replicates),
    expectedComparison: compare(rows, 'expectedLossUsd8', options.bootstrapSeed + 1, replicates),
  };
}

export interface WriteReportOptions {
  cases: Part1Case[];
  outputRoot: string;
  firstSeed: number;
  commit: string;
  timestamp?: Date;
  bootstrapSeed?: number;
}

function markdown(summary: Part1Summary, firstSeed: number, commit: string): string {
  const fixed = (value: number) => value.toFixed(4);
  const comparison = summary.realizedComparison;
  const expected = summary.expectedComparison;
  const rows = (Object.entries(summary.metrics) as [keyof Part1Summary['metrics'], {
    a: DescriptiveStats; b: DescriptiveStats;
  }][]) .map(([name, { a, b }]) =>
    `| ${name} | ${fixed(a.mean)} / ${fixed(a.median)} / ${fixed(a.p90)} | ${fixed(b.mean)} / ${fixed(b.median)} / ${fixed(b.p90)} |`);
  return [
    '# Part 1 — allocation quality (SIMULATED)',
    '',
    `Commit: \`${commit}\`. Seed range: ${firstSeed}–${firstSeed + summary.sampleCount - 1} (${summary.sampleCount} cases).`,
    'Two independent simulated pools per case. No chain transactions and no LLM; A is the local HF<1.05 threshold rule, B is the exhaustive optimizer.',
    'Each case shares one Bernoulli stress realization across A and B (stress drop 10%, probability 50%). All money metrics below are USD.',
    '',
    '| Metric | A mean / median / p90 | B mean / median / p90 |',
    '|---|---:|---:|',
    ...rows,
    '',
    `Win / tie / loss (B vs A, realized loss): ${comparison.wins} / ${comparison.ties} / ${comparison.losses}.`,
    `Mean difference B − A (realized USD): ${fixed(comparison.meanDifferenceUsd)}; bootstrap 95% CI [${fixed(comparison.bootstrap95Usd.lower)}, ${fixed(comparison.bootstrap95Usd.upper)}].`,
    `Win / tie / loss (B vs A, model expected loss): ${expected.wins} / ${expected.ties} / ${expected.losses}.`,
    `Mean difference B − A (expected USD): ${fixed(expected.meanDifferenceUsd)}; bootstrap 95% CI [${fixed(expected.bootstrap95Usd.lower)}, ${fixed(expected.bootstrap95Usd.upper)}].`,
    '',
    'Limitations: simulated market; constructed two-pool generator (core position type currently limits poolId to 0|1); the loss model mirrors the optimizer; independent threshold A is intentionally simple; single-step liquidation with no interest or execution costs. B searches discrete repay levels, while A may choose a partial-target amount outside that set: B can lose individual cases even on model expected loss. Any mean advantage is model-relative, not evidence of real-market performance.',
    '',
  ].join('\n');
}

export async function writePart1Report(options: WriteReportOptions): Promise<{
  directory: string; summary: Part1Summary;
}> {
  if (options.cases.length === 0 || options.cases[0]?.seed !== options.firstSeed ||
      options.cases.some((row, index) => row.seed !== options.firstSeed + index)) {
    throw new Error('case seeds must be contiguous and match firstSeed');
  }
  const timestamp = options.timestamp ?? new Date();
  if (Number.isNaN(timestamp.getTime())) throw new Error('invalid report timestamp');
  const directory = join(options.outputRoot, timestamp.toISOString().replace(/[:.]/g, '-'));
  const bootstrapSeed = options.bootstrapSeed ?? options.firstSeed;
  const summary = summarizePart1(options.cases, { bootstrapSeed });
  const metadata = {
    commit: options.commit,
    timestamp: timestamp.toISOString(),
    seedRange: [options.firstSeed, options.firstSeed + options.cases.length - 1],
    count: options.cases.length,
    model: null,
    temperature: null,
    chainId: null,
    nodeVersion: process.version,
    mode: 'SIMULATED',
    bootstrapSeed,
    bootstrapReplicates: 2_000,
    stressBps: 1_000,
    lambdaBps: 5_000,
  };
  await mkdir(directory);
  await Promise.all([
    writeFile(join(directory, 'results.json'), JSON.stringify(encodeJson({
      part: 1, mode: 'SIMULATED', firstSeed: options.firstSeed, count: options.cases.length,
      cases: options.cases, summary,
    }), null, 2) + '\n'),
    writeFile(join(directory, 'summary.md'), markdown(summary, options.firstSeed, options.commit)),
    writeFile(join(directory, 'run-meta.json'), JSON.stringify(metadata, null, 2) + '\n'),
  ]);
  return { directory, summary };
}
