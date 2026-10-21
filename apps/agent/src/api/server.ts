import { createReadStream } from 'node:fs';
import { stat } from 'node:fs/promises';
import { dirname, extname, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  AddressSchema,
  MandateDraftSchema,
  MandateSchema,
  encodeJson,
  verifyAuditChain,
} from '@marginpilot/core';
import Fastify, { type FastifyInstance, type FastifyReply } from 'fastify';
import { z } from 'zod';

import { DemoRuntime, DemoSignerNotConfiguredError } from '../demo/runtime.js';
import { ChainTransactionError, OwnerSignerNotConfiguredError } from '../chain/viem-port.js';
import { DraftHasClarificationsError, MandateCompileError } from '../mandate/compile.js';
import {
  AgentRuntime,
  InvalidOwnerSignatureError,
  MandateDraftMismatchError,
  MandateIdChangedError,
  MandateNotInstalledError,
  OwnerSignerMismatchError,
} from '../runtime.js';
import type { RunSession } from './events.js';
import { RunStore, formatSse } from './events.js';

const CompileBody = z.object({ text: z.string().min(1).max(4_000) }).strict();
const Uint256String = z
  .union([z.string().regex(/^(0|[1-9]\d*)$/), z.number().int().nonnegative()])
  .transform(String)
  .transform(BigInt)
  .refine((value) => value <= (1n << 256n) - 1n, 'must fit uint256');
const ConfirmBody = z
  .object({
    draft: MandateDraftSchema,
    ownerMode: z.enum(['demo', 'wallet']),
    signature: z.string().regex(/^0x[0-9a-fA-F]{130}$/).optional(),
    /** Wallet mode: the exact mandate returned by /api/mandate/prepare. */
    mandate: MandateSchema.optional(),
    deadline: Uint256String.optional(),
  })
  .strict();
const PrepareBody = z.object({ draft: MandateDraftSchema }).strict();
const RunBody = z.object({ autoExecute: z.boolean() }).strict();
const RunParams = z.object({ id: z.string().min(1).max(120) }).strict();
const AuditQuery = z.object({ run: z.string().min(1).max(120).optional() }).strict();
const ShockBody = z
  .object({
    token: AddressSchema,
    priceUsd8: z.union([z.string().regex(/^(0|[1-9]\d*)$/), z.number().int().nonnegative()]).transform(String).transform(BigInt),
    updatedAt: z
      .union([z.string().regex(/^(0|[1-9]\d*)$/), z.number().int().nonnegative()])
      .transform(String)
      .transform(BigInt)
      .optional(),
  })
  .strict();
const InjectBody = z
  .object({
    kind: z.enum(['poolPause', 'swapBroken', 'stalePrice', 'poisonNote']),
    value: z.union([z.string().max(500), z.number(), z.boolean()]).optional(),
  })
  .strict();

const CONTENT_TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
};

class TokenBucket {
  private readonly capacity: number;
  private readonly refillPerSecond: number;
  private readonly buckets = new Map<string, { tokens: number; updated: number }>();

  constructor(capacity: number, refillPerSecond: number) {
    this.capacity = capacity;
    this.refillPerSecond = refillPerSecond;
  }

  take(key: string): boolean {
    const now = Date.now();
    const bucket = this.buckets.get(key) ?? { tokens: this.capacity, updated: now };
    const elapsed = (now - bucket.updated) / 1_000;
    bucket.tokens = Math.min(this.capacity, bucket.tokens + elapsed * this.refillPerSecond);
    bucket.updated = now;
    if (bucket.tokens < 1) {
      this.buckets.set(key, bucket);
      return false;
    }
    bucket.tokens -= 1;
    this.buckets.set(key, bucket);
    return true;
  }
}

export interface BuildServerOptions {
  demoMode: boolean;
  runtime?: AgentRuntime;
  staticDir?: string;
  demoOwnerPrivateKey?: string;
  rateLimitCapacity?: number;
  rateLimitRefillPerSecond?: number;
  runLimitCapacity?: number;
  runLimitRefillPerSecond?: number;
}

function sendJson(reply: FastifyReply, status: number, value: unknown): FastifyReply {
  return reply.code(status).type('application/json; charset=utf-8').send(JSON.stringify(encodeJson(value)));
}

function zodMessage(error: z.ZodError): { error: string; fields: string[] } {
  return {
    error: 'InvalidRequest',
    fields: error.issues.map((issue) => issue.path.join('.') || 'body'),
  };
}

function isApi(url: string): boolean {
  return url.startsWith('/api/');
}

async function serveStatic(reply: FastifyReply, root: string, url: string): Promise<FastifyReply> {
  const raw = url.split('?')[0] ?? '/';
  let relative: string;
  try {
    relative = decodeURIComponent(raw);
  } catch {
    return sendJson(reply, 400, { error: 'BadPath' });
  }
  const normalized = relative === '/' ? '/index.html' : relative;
  const candidate = resolve(root, `.${normalized}`);
  const rootResolved = resolve(root);
  if (candidate !== rootResolved && !candidate.startsWith(`${rootResolved}${sep}`)) {
    return sendJson(reply, 403, { error: 'Forbidden' });
  }
  let path = candidate;
  try {
    const info = await stat(path);
    if (!info.isFile()) path = resolve(root, 'index.html');
  } catch {
    path = resolve(root, 'index.html');
  }
  try {
    const info = await stat(path);
    if (!info.isFile()) throw new Error('not a file');
  } catch {
    return reply
      .code(404)
      .type('text/plain; charset=utf-8')
      .send('MarginPilot UI is not built yet. Run the web build (B-11).');
  }
  reply.type(CONTENT_TYPES[extname(path).toLowerCase()] ?? 'application/octet-stream');
  return reply.send(createReadStream(path));
}

function activeRun(run: RunSession | undefined): boolean {
  return run !== undefined && run.done === undefined;
}

export async function buildServer(options: BuildServerOptions): Promise<FastifyInstance> {
  const app = Fastify({ logger: false, bodyLimit: 1_000_000, trustProxy: false });
  const runtime =
    options.runtime ??
    new DemoRuntime({
      demoOwnerPrivateKey: options.demoOwnerPrivateKey ?? process.env.DEMO_OWNER_PRIVATE_KEY,
    });
  const runs = new RunStore();
  // Rate limits are always on: compile can cost an LLM call and run spends
  // executor gas. Demo mode uses the same buckets with the configured caps.
  const limiter = new TokenBucket(options.rateLimitCapacity ?? 120, options.rateLimitRefillPerSecond ?? 2);
  const runLimiter = new TokenBucket(options.runLimitCapacity ?? 20, options.runLimitRefillPerSecond ?? 1 / 3_600);
  const staticDir =
    options.staticDir ?? resolve(dirname(fileURLToPath(import.meta.url)), '../../../web/dist');

  app.addHook('onRequest', async (request, reply) => {
    if (!limiter || !isApi(request.url)) return;
    if (!limiter.take(request.ip)) {
      reply.header('Retry-After', '1');
      return sendJson(reply, 429, { error: 'RateLimitExceeded' });
    }
    return undefined;
  });

  app.setErrorHandler((error, _request, reply) => {
    if (error instanceof z.ZodError) return sendJson(reply, 400, zodMessage(error));
    if (error instanceof DraftHasClarificationsError) {
      return sendJson(reply, 409, { error: 'ClarificationsRequired', fields: error.fields });
    }
    if (error instanceof MandateCompileError) return sendJson(reply, 400, { error: 'MandateCompileError' });
    if (error instanceof DemoSignerNotConfiguredError) {
      return sendJson(reply, 503, { error: 'DemoSignerNotConfigured' });
    }
    if (error instanceof OwnerSignerMismatchError) {
      return sendJson(reply, 503, { error: 'OwnerSignerMismatch' });
    }
    if (error instanceof InvalidOwnerSignatureError) {
      return sendJson(reply, 400, { error: 'InvalidOwnerSignature' });
    }
    if (error instanceof MandateDraftMismatchError) {
      return sendJson(reply, 400, { error: 'MandateDraftMismatch' });
    }
    if (error instanceof MandateIdChangedError) {
      return sendJson(reply, 409, { error: 'MandateIdChanged' });
    }
    if (error instanceof OwnerSignerNotConfiguredError) {
      return sendJson(reply, 503, { error: 'OwnerSignerNotConfigured' });
    }
    if (error instanceof ChainTransactionError) {
      return sendJson(reply, 502, { error: 'ChainTransactionFailed', txHash: error.txHash });
    }
    if (error instanceof MandateNotInstalledError) {
      return sendJson(reply, 502, { error: 'MandateNotInstalled', status: error.status });
    }
    return sendJson(reply, 500, { error: 'InternalError' });
  });

  app.post('/api/mandate/compile', async (request, reply) => {
    const body = CompileBody.parse(request.body);
    const draft = await runtime.compile(body.text);
    return sendJson(reply, 200, draft);
  });

  app.post('/api/mandate/prepare', async (request, reply) => {
    const body = PrepareBody.parse(request.body);
    const prepared = await runtime.prepareWallet(body.draft);
    return sendJson(reply, 200, prepared);
  });

  app.post('/api/mandate/confirm', async (request, reply) => {
    const body = ConfirmBody.parse(request.body);
    if (body.ownerMode === 'wallet') {
      if (!body.signature || !body.mandate || body.deadline === undefined) {
        return sendJson(reply, 400, { error: 'WalletPreparationRequired' });
      }
      const confirmed = await runtime.confirmWithSignature(
        body.draft,
        body.signature as `0x${string}`,
        body.mandate,
        body.deadline,
      );
      return sendJson(reply, 200, confirmed);
    }
    const confirmed = await runtime.confirm(body.draft);
    return sendJson(reply, 200, confirmed);
  });

  app.post('/api/run', async (request, reply) => {
    const body = RunBody.parse(request.body);
    if (activeRun(runs.latest())) {
      return sendJson(reply, 409, { error: 'RunAlreadyActive', runId: runs.latest()?.runId });
    }
    if (runLimiter && !runLimiter.take(request.ip)) {
      return sendJson(reply, 429, { error: 'RunRateLimitExceeded' });
    }
    const runId = `run-${Date.now().toString(36)}-${runs.all().length + 1}`;
    const session = runs.create({
      runId,
      chain: runtime.chain,
      registry: runtime.registry,
      autoExecute: body.autoExecute,
    });
    if (body.autoExecute) void session.start();
    return sendJson(reply, 202, { runId, state: session.state });
  });

  app.get('/api/run/:id/events', async (request, reply) => {
    const params = RunParams.parse(request.params);
    const session = runs.get(params.id);
    if (!session) return sendJson(reply, 404, { error: 'RunNotFound' });

    reply.hijack();
    reply.raw.writeHead(200, {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
    });
    for (const event of session.events) reply.raw.write(formatSse(event));
    const unsubscribe = session.subscribe((event) => reply.raw.write(formatSse(event)));
    const heartbeat = setInterval(() => reply.raw.write(': heartbeat\n\n'), 15_000);
    const cleanup = () => {
      clearInterval(heartbeat);
      unsubscribe();
    };
    request.raw.on('close', cleanup);
    return reply;
  });

  app.post('/api/run/:id/approve', async (request, reply) => {
    const params = RunParams.parse(request.params);
    const session = runs.get(params.id);
    if (!session) return sendJson(reply, 404, { error: 'RunNotFound' });
    if (session.state !== 'AWAITING_APPROVAL') {
      return sendJson(reply, 409, { error: 'RunNotAwaitingApproval', state: session.state });
    }
    void session.start();
    return sendJson(reply, 202, { runId: session.runId, state: session.state });
  });

  app.post('/api/vault/pause', async (_request, reply) => {
    const txHash = await runtime.pause();
    const vault = await runtime.chain.getVault();
    return sendJson(reply, 200, { txHash, paused: vault.paused });
  });

  app.get('/api/state', async (_request, reply) => {
    const state = await runtime.state();
    const latest = runs.latest();
    const chainId = runtime.registry.chainId;
    return sendJson(reply, 200, {
      ...state,
      ledger: latest?.result?.ledger ?? [],
      runId: latest?.runId ?? null,
      runState: latest?.state ?? 'IDLE',
      simulated: runtime.simulated,
      demoMode: options.demoMode,
      demoControls: runtime.allowDemoControls,
      mode: runtime.chainLabel,
      chainId,
      vaultAddress: runtime.vaultAddress,
      nextMandateId: (runtime.chain.getNextMandateId
        ? await runtime.chain.getNextMandateId()
        : state.vault.activeMandateId + 1n
      ).toString(),
      owner: runtime.registry.owner ?? null,
      executor: runtime.registry.executor ?? null,
      explorerBase: runtime.explorerBase,
      tokens: [
        { symbol: 'mUSDC', address: runtime.registry.tokens.mUSDC, decimals: 6 },
        { symbol: 'mWETH', address: runtime.registry.tokens.mWETH, decimals: 18 },
        { symbol: 'mWSTETH', address: runtime.registry.tokens.mWSTETH, decimals: 18 },
      ],
    });
  });

  app.get('/api/audit', async (request, reply) => {
    const query = AuditQuery.parse(request.query);
    const session = query.run ? runs.get(query.run) : runs.latest();
    if (!session) return sendJson(reply, 404, { error: 'RunNotFound' });
    const entries = session.audit;
    return sendJson(reply, 200, {
      runId: session.runId,
      entries,
      verified: verifyAuditChain(entries),
    });
  });

  app.post('/api/demo/shock', async (request, reply) => {
    if (!options.demoMode) return sendJson(reply, 404, { error: 'DemoModeDisabled' });
    const body = ShockBody.parse(request.body);
    const txHash = await runtime.shock(body.token, body.priceUsd8, body.updatedAt);
    return sendJson(reply, 200, { txHash, simulated: runtime.simulated });
  });

  app.post('/api/demo/inject', async (request, reply) => {
    if (!options.demoMode) return sendJson(reply, 404, { error: 'DemoModeDisabled' });
    const body = InjectBody.parse(request.body);
    const result = await runtime.inject(body.kind, body.value);
    return sendJson(reply, 200, { ...(result as Record<string, unknown>), simulated: runtime.simulated });
  });

  app.setNotFoundHandler(async (request, reply) => {
    if (request.method === 'GET' && !isApi(request.url)) {
      return serveStatic(reply, staticDir, request.url);
    }
    return sendJson(reply, 404, { error: 'NotFound' });
  });

  return app;
}

export type ApiServer = FastifyInstance;
