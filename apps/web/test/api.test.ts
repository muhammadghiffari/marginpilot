import { describe, expect, test } from 'vitest';
import { serializeJson } from '../src/api.js';

describe('API boundary serialization', () => {
  test('sends parsed mandate bigint amounts as decimal strings, not JS numbers', () => {
    expect(serializeJson({ mandate: { maxTotalSpendUsd: 26_000_000_000n } })).toBe(
      '{"mandate":{"maxTotalSpendUsd":"26000000000"}}',
    );
  });
});
