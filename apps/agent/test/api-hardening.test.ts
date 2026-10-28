import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import type { FastifyInstance } from 'fastify';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';

import { buildServer, type BuildServerOptions } from '../src/api/server.js';
import { DemoRuntime } from '../src/demo/runtime.js';

const KEY = '0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80';
const HASH = `0x${'22'.repeat(32)}` as const;
const JSON_HEADERS = { 'content-type': 'application/json' };

let app: FastifyInstance;
let staticDir: string;
let runtime: DemoRuntime;

async function make(options: Partial<BuildServerOptions> = {}): Promise<void> {
  runtime = new DemoRuntime({ demoOwnerPrivateKey: KEY });
  app = await buildServer({
    demoMode: true,
    runtime,
    staticDir,
    rateLimitCapacity: 1_000,
    rateLimitRefillPerSecond: 0,
    runLimitCapacity: 100,
    ...options,
  });
}

beforeEach(async () => {
  staticDir = await mkdtemp(join(tmpdir(), 'mp-hard-'));
  await writeFile(join(staticDir, 'index.html'), '<!doctype html><title>t</title>');
});
afterEach(async () => {
  await app.close();
  await rm(staticDir, { recursive: true, force: true });
});

describe('transport hardening', () => {
  test('health reports mode without secrets', async () => {
    await make();
    const response = await app.inject({ method: 'GET', url: '/api/health' });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({ ok: true, simulated: true });
    expect(response.body).not.toMatch(/0x[0-9a-fA-F]{64}/);
  });

  test('every response carries security headers and no CORS header', async () => {
    await make();
    for (const url of ['/api/state', '/']) {
      const response = await app.inject({ method: 'GET', url });
      expect(response.headers['content-security-policy']).toContain("default-src 'self'");
      expect(response.headers['content-security-policy']).toContain("frame-ancestors 'none'");
      expect(response.headers['x-content-type-options']).toBe('nosniff');
      expect(response.headers['access-control-allow-origin']).toBeUndefined();
    }
  });

  test('a POST from a foreign Origin is refused; the same origin and no Origin pass', async () => {
    await make();
    const body = JSON.stringify({ text: 'Protect my loans. Max $260.' });
    const foreign = await app.inject({ method: 'POST', url: '/api/mandate/compile', headers: { ...JSON_HEADERS, origin: 'https://evil.example', host: 'demo.example' }, payload: body });
    expect(foreign.statusCode).toBe(403);
    expect(foreign.json()).toEqual({ error: 'OriginNotAllowed' });
    const same = await app.inject({ method: 'POST', url: '/api/mandate/compile', headers: { ...JSON_HEADERS, origin: 'https://demo.example', host: 'demo.example' }, payload: body });
    expect(same.statusCode).not.toBe(403);
    const bare = await app.inject({ method: 'POST', url: '/api/mandate/compile', headers: JSON_HEADERS, payload: body });
    expect(bare.statusCode).not.toBe(403);
  });

  test('an explicitly allowed Origin passes', async () => {
    await make({ allowedOrigins: ['https://app.example'] });
    const response = await app.inject({ method: 'POST', url: '/api/mandate/compile', headers: { ...JSON_HEADERS, origin: 'https://app.example', host: 'api.example' }, payload: '{"text":"hello"}' });
    expect(response.statusCode).not.toBe(403);
  });

  test('request bodies above 64 KB are rejected', async () => {
    await make();
    const response = await app.inject({ method: 'POST', url: '/api/mandate/compile', headers: JSON_HEADERS, payload: JSON.stringify({ text: 'a'.repeat(70_000) }) });
    expect(response.statusCode).toBe(413);
  });
});

describe('kill switch and reset guards', () => {
  test('pause works once, then reports AlreadyPaused', async () => {
    await make();
    expect((await app.inject({ method: 'POST', url: '/api/vault/pause', headers: JSON_HEADERS, payload: '{}' })).statusCode).toBe(200);
    const second = await app.inject({ method: 'POST', url: '/api/vault/pause', headers: JSON_HEADERS, payload: '{}' });
    expect(second.statusCode).toBe(409);
    expect(second.json()).toEqual({ error: 'AlreadyPaused' });
  });

  test('a pause cooldown rate-limits the shared kill switch', async () => {
    await make({ pauseCooldownMs: 60_000 });
    await app.inject({ method: 'POST', url: '/api/vault/pause', headers: JSON_HEADERS, payload: '{}' });
    const second = await app.inject({ method: 'POST', url: '/api/vault/pause', headers: JSON_HEADERS, payload: '{}' });
    expect(second.statusCode).toBe(429);
    expect(second.json()).toEqual({ error: 'PauseCooldown' });
    expect(Number(second.headers['retry-after'])).toBeGreaterThan(0);
  });

  test('reset is unavailable outside demo mode, on a chain without it, and while a run is active', async () => {
    await make({ demoMode: false });
    expect((await app.inject({ method: 'POST', url: '/api/demo/reset', headers: JSON_HEADERS, payload: '{}' })).statusCode).toBe(404);
    await app.close();
    await make();
    const unsupported = await app.inject({ method: 'POST', url: '/api/demo/reset', headers: JSON_HEADERS, payload: '{}' });
    expect(unsupported.statusCode).toBe(501);
  });

  test('reset calls the chain baseline once and honours its cooldown', async () => {
    await make({ resetCooldownMs: 60_000 });
    const reset = vi.fn(async () => [HASH]);
    Object.assign(runtime.chain, { demoResetMarket: reset });
    const first = await app.inject({ method: 'POST', url: '/api/demo/reset', headers: JSON_HEADERS, payload: '{}' });
    expect(first.statusCode).toBe(200);
    expect(first.json()).toMatchObject({ txHashes: [HASH] });
    expect(reset).toHaveBeenCalledTimes(1);
    const second = await app.inject({ method: 'POST', url: '/api/demo/reset', headers: JSON_HEADERS, payload: '{}' });
    expect(second.statusCode).toBe(429);
    expect(reset).toHaveBeenCalledTimes(1);
  });
});

describe('run guards', () => {
  test('a run cooldown spaces runs apart', async () => {
    await make({ runCooldownMs: 60_000 });
    const first = await app.inject({ method: 'POST', url: '/api/run', headers: JSON_HEADERS, payload: '{"autoExecute":true}' });
    expect(first.statusCode).toBe(202);
    for (let i = 0; i < 100 && (await app.inject({ method: 'GET', url: '/api/state' })).json<{ runState: string }>().runState.match(/OBSERVING|PLANNING|EXECUTING|IDLE/); i += 1) {
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
    const second = await app.inject({ method: 'POST', url: '/api/run', headers: JSON_HEADERS, payload: '{"autoExecute":true}' });
    expect(second.statusCode).toBe(429);
    expect(second.json()).toEqual({ error: 'RunCooldown' });
  });

  test('a run is refused when the executor cannot pay for gas', async () => {
    await make({ minExecutorBalanceWei: 10n ** 16n });
    Object.assign(runtime.chain, { executorBalance: async () => 1n });
    const response = await app.inject({ method: 'POST', url: '/api/run', headers: JSON_HEADERS, payload: '{"autoExecute":true}' });
    expect(response.statusCode).toBe(503);
    expect(response.json()).toEqual({ error: 'ExecutorLowBalance' });
  });
});
