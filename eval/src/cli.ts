import { execFileSync } from 'node:child_process';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { z } from 'zod';
import { simulatePart1 } from './part1-simulation.js';
import { writePart1Report } from './report.js';

const ArgsSchema = z.object({
  part: z.enum(['1', '2', 'all']),
  seed: z.number().int().min(1).max(0xffff_ffff),
  count: z.number().int().min(1).max(5_000),
}).strict();

export type EvalArgs = z.infer<typeof ArgsSchema>;

export function parseEvalArgs(argv: string[]): EvalArgs {
  const tokens = argv.filter((token) => token !== '--');
  const values: Record<string, string> = {};
  for (let index = 0; index < tokens.length; index += 2) {
    const flag = tokens[index];
    const value = tokens[index + 1];
    if (!flag || !['--part', '--seed', '--count'].includes(flag) || !value || value.startsWith('--') || values[flag] !== undefined) {
      throw new Error(`invalid or duplicated eval argument: ${flag ?? '(empty)'}`);
    }
    values[flag] = value;
  }
  const decimal = (value: string): number => {
    if (!/^(0|[1-9]\d*)$/.test(value)) throw new Error('eval seed/count must be unsigned decimal integers');
    return Number(value);
  };
  return ArgsSchema.parse({
    part: values['--part'] ?? 'all',
    seed: decimal(values['--seed'] ?? '1'),
    count: decimal(values['--count'] ?? '500'),
  });
}

export async function runEval(argv: string[]): Promise<{ directory: string; sampleCount: number }> {
  const args = parseEvalArgs(argv);
  if (args.part !== '1') {
    throw new Error('Part 2 blocked: requires deployments/<chainId>.json, packages/core/src/abi/, eval/fixtures/base.json and A-09 chain runner; no chain results were generated');
  }
  const sourceDir = dirname(fileURLToPath(import.meta.url));
  const root = resolve(sourceDir, '../..');
  const outputRoot = resolve(root, 'eval/results');
  const commit = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim();
  const cases = simulatePart1({ firstSeed: args.seed, count: args.count });
  const output = await writePart1Report({ cases, outputRoot, firstSeed: args.seed, commit });
  return { directory: output.directory, sampleCount: cases.length };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  runEval(process.argv.slice(2)).then(
    ({ directory, sampleCount }) => {
      console.log(`SIMULATED Part 1: ${sampleCount} seeded cases; generated ${directory}`);
    },
    (error: unknown) => {
      console.error(error instanceof Error ? error.message : 'evaluation failed');
      process.exitCode = 1;
    },
  );
}
