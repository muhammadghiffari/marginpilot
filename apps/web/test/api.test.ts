import { describe, expect, test } from 'vitest';
import { ApiRequestError, api, connectRunEvents, serializeJson } from '../src/api.js';

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

describe('API error handling', () => {
  test('a non-JSON error response becomes an ApiRequestError, not a raw parse error', async () => {
    const original = globalThis.fetch;
    globalThis.fetch = (async () => new Response('<html>Bad gateway</html>', { status: 502 })) as typeof fetch;
    try {
      await expect(api.state()).rejects.toSatisfy((error: unknown) => error instanceof ApiRequestError && error.status === 502);
    } finally {
      globalThis.fetch = original;
    }
  });
});

describe('run event stream', () => {
  test('clears the interruption notice when the stream recovers', () => {
    class FakeSource {
      static last: FakeSource;
      onmessage: ((message: { data: string }) => void) | null = null;
      onerror: (() => void) | null = null;
      constructor() { FakeSource.last = this; }
      close(): void {}
    }
    const original = (globalThis as { EventSource?: unknown }).EventSource;
    (globalThis as { EventSource?: unknown }).EventSource = FakeSource;
    try {
      const calls: string[] = [];
      connectRunEvents('run-1', () => calls.push('event'), () => calls.push('error'), () => calls.push('recovered'));
      FakeSource.last.onerror?.();
      FakeSource.last.onmessage?.({ data: JSON.stringify({ runId: 'run-1', seq: 0, ts: 1, type: 'state', payload: { state: 'IDLE' } }) });
      FakeSource.last.onmessage?.({ data: JSON.stringify({ runId: 'run-1', seq: 1, ts: 2, type: 'state', payload: { state: 'OBSERVING' } }) });
      expect(calls).toEqual(['error', 'recovered', 'event', 'event']);
    } finally {
      (globalThis as { EventSource?: unknown }).EventSource = original;
    }
  });
});
