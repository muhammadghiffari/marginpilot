import { describe, expect, test } from 'vitest';
import { ApiRequestError, serializeJson } from '../src/api.js';

describe('API boundary serialization', () => {
  test('sends parsed mandate bigint amounts as decimal strings, not JS numbers', () => {
    expect(serializeJson({ mandate: { maxTotalSpendUsd: 26_000_000_000n } })).toBe(
      '{"mandate":{"maxTotalSpendUsd":"26000000000"}}',
    );
  });

  test('an owner-signature mismatch names the account that actually signed', () => {
    const error = new ApiRequestError(400, 'InvalidOwnerSignature', {
      recovered: '0x70997970C51812dc3A010C7d01b50e0d17dc79C8',
      expected: '0xdcf89b628aaee7b4C91Ce3d594049E596Dd9c85C',
    });
    expect(error.message).toContain('0x70997970C51812dc3A010C7d01b50e0d17dc79C8');
    expect(error.message).toContain('0xdcf89b628aaee7b4C91Ce3d594049E596Dd9c85C');
    expect(error.message).toMatch(/owner/i);
  });
});
