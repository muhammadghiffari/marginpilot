import { execFileSync } from 'node:child_process';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { z } from 'zod';
import { simulatePart1 } from './part1-simulation.js';
import { runPart2 } from './part2-runner.js';
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
    part: values['--part'] ?? '1',
    seed: decimal(values['--seed'] ?? '1'),
    count: decimal(values['--count'] ?? '500'),
  });
}

export interface EvalRunResult {
  directories: string[];
  runs: number;
}

export async function runEval(argv: string[]): Promise<EvalRunResult> {
  const args = parseEvalArgs(argv);
  const sourceDir = dirname(fileURLToPath(import.meta.url));
  const root = resolve(sourceDir, '../..');
  const outputRoot = resolve(root, 'eval/results');
  const commit = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim();
  const directories: string[] = [];
  let runs = 0;
  if (args.part === '1' || args.part === 'all') {
    const cases = simulatePart1({ firstSeed: args.seed, count: args.count });
    const output = await writePart1Report({ cases, outputRoot, firstSeed: args.seed, commit });
    directories.push(output.directory);
    runs += cases.length;
  }
  if (args.part === '2' || args.part === 'all') {
    const output = await runPart2({ seed: args.seed, outputRoot, commit });
    directories.push(output.directory);
    runs += output.rows.length;
  }
  return { directories, runs };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  runEval(process.argv.slice(2)).then(
    ({ directories, runs }) => {
      console.log(`SIMULATED evaluation: ${runs} run(s); generated ${directories.join(', ')}`);
    },
    (error: unknown) => {
      console.error(error instanceof Error ? error.message : 'evaluation failed');
      process.exitCode = 1;
    },
  );
}
