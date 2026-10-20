import { describe, expect, test } from 'vitest';
import { parseEvalArgs } from '../src/cli.js';

describe('evaluation CLI boundary', () => {
  test('accepts the root pnpm -- forwarding shape and defaults to seeds 1..500', () => {
    expect(parseEvalArgs(['--', '--part', '1', '--seed', '1'])).toEqual({
      part: '1', seed: 1, count: 500,
    });
    expect(parseEvalArgs(['--part', '1', '--seed', '7', '--count', '2'])).toEqual({
      part: '1', seed: 7, count: 2,
    });
  });

  test('rejects bad arguments and never silently runs a different study', () => {
    expect(() => parseEvalArgs(['--part', 'unknown', '--seed', '1'])).toThrow();
    expect(() => parseEvalArgs(['--part', '1', '--seed', '0'])).toThrow();
    expect(() => parseEvalArgs(['--part', '1', '--seed', '1', '--unexpected'])).toThrow();
  });
});
