import { describe, expect, test } from 'vitest';

import {
  AuditLog,
  redactText,
  redactValue,
  secretValuesFromEnv,
  verifyAuditChain,
  type AuditEntry,
} from '../src/index.js';

const PRIVATE_KEY_SHAPE = `0x${'ab'.repeat(32)}`;
const PROVIDER_KEY = `sk-${'x'.repeat(30)}`;
const ENV_SECRET = 'not-a-real-secret-value';

describe('redactor', () => {
  test('removes key-shaped strings, provider keys, private key blocks and Authorization values', () => {
    const text = [
      `owner=${PRIVATE_KEY_SHAPE}`,
      `api=${PROVIDER_KEY}`,
      'Authorization: Bearer abc.def.ghi',
      `${['-----BEGIN', 'PRIVATE KEY-----'].join(' ')}\nZmFrZQ==\n${['-----END', 'PRIVATE KEY-----'].join(' ')}`,
    ].join('\n');
    const redacted = redactText(text, [ENV_SECRET]);
    expect(redacted).not.toContain(PRIVATE_KEY_SHAPE);
    expect(redacted).not.toContain(PROVIDER_KEY);
    expect(redacted).not.toContain('abc.def.ghi');
    expect(redacted).not.toContain('ZmFrZQ==');
    expect(redacted).toContain('[REDACTED');
  });

  test('redacts exact secret values supplied from env without reading .env', () => {
    const env = {
      DEMO_OWNER_PRIVATE_KEY: ENV_SECRET,
      LLM_API_KEY: 'another-secret-value',
      LLM_PROVIDER: 'openai',
      SHORT_KEY: 'abc',
    };
    const secrets = secretValuesFromEnv(env);
    expect(secrets).toEqual(expect.arrayContaining([ENV_SECRET, 'another-secret-value']));
    expect(secrets).not.toContain('openai');
    expect(secrets).not.toContain('abc');
    expect(redactText(`value=${ENV_SECRET}`, secrets)).not.toContain(ENV_SECRET);
  });

  test('redacts nested values without mutating the input', () => {
    const input = {
      note: `token ${PRIVATE_KEY_SHAPE}`,
      nested: [{ authorization: 'Bearer secret-token' }, 5n],
    };
    const output = redactValue(input, [ENV_SECRET]) as typeof input;
    const wire = JSON.stringify(output, (_key, value) => (typeof value === 'bigint' ? value.toString() : value));
    expect(wire).not.toContain(PRIVATE_KEY_SHAPE);
    expect(wire).not.toContain('secret-token');
    expect(output.nested[1]).toBe(5n);
    expect(input.note).toContain(PRIVATE_KEY_SHAPE);
  });
});

describe('hash-chained audit log', () => {
  test('builds a verifiable chain starting from a zero hash', () => {
    const log = new AuditLog('run-1', { now: () => 1_700_000_000 });
    log.append('observe', { block: 1n, prices: 4 });
    log.append('plan', { planId: 'p1' });
    log.append('action.mined', { spendUsd8: 8_657_000_000n });
    expect(log.entries).toHaveLength(3);
    expect(log.entries[0]?.prevHash).toBe(`0x${'0'.repeat(64)}`);
    expect(log.entries[0]?.seq).toBe(0);
    expect(log.entries[2]?.seq).toBe(2);
    expect(verifyAuditChain(log.entries)).toBe(true);
  });

  test('detects any tampering with data or linkage', () => {
    const log = new AuditLog('run-1', { now: () => 1_700_000_000 });
    log.append('observe', { block: 1n });
    log.append('plan', { planId: 'p1' });
    const tampered = structuredClone(log.entries) as AuditEntry[];
    const first = tampered[0];
    if (first !== undefined) first.data = { block: 2 };
    expect(verifyAuditChain(tampered)).toBe(false);
  });

  test('redacts secrets before hashing and remains verifiable after JSONL round-trip', () => {
    const log = new AuditLog('run-2', { now: () => 42, secrets: [ENV_SECRET] });
    log.append('mandate.confirmed', { note: `do not leak ${ENV_SECRET}`, owner: PRIVATE_KEY_SHAPE });
    const redacted = JSON.stringify(log.entries[0]?.data);
    expect(redacted).not.toContain(ENV_SECRET);
    expect(redacted).not.toContain(PRIVATE_KEY_SHAPE);
    expect(log.toJSONL()).not.toContain(ENV_SECRET);
    const roundTripped = log.toJSONL().trim().split('\n').map((line) => JSON.parse(line) as AuditEntry);
    expect(verifyAuditChain(roundTripped)).toBe(true);
  });

  test('produces byte-identical hashes for identical sequences', () => {
    const first = new AuditLog('run-3', { now: () => 7 });
    const second = new AuditLog('run-3', { now: () => 7 });
    first.append('plan', { id: 'p', amount: 1n });
    second.append('plan', { id: 'p', amount: 1n });
    expect(first.entries).toEqual(second.entries);
  });
});
