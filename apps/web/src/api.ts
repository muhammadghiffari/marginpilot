import {
  AuditEntrySchema,
  HexSchema,
  LedgerEntrySchema,
  MandateDraftSchema,
  MandateSchema,
  PlanSchema,
  PositionSnapshotSchema,
  PriceSnapshotSchema,
  VaultSnapshotSchema,
  encodeJson,
  type MandateDraft,
  type Mandate,
  type VaultSnapshot,
  type PositionSnapshot,
  type PriceSnapshot,
  type LedgerEntry,
  type AuditEntry,
  type Plan,
} from '@marginpilot/core';
import { z } from 'zod';

export const TokenInfoSchema = z.object({
  symbol: z.string(),
  address: z.string(),
  decimals: z.number().int(),
});

export const ApiStateSchema = z.object({
  vault: VaultSnapshotSchema,
  mandate: MandateSchema.nullable(),
  positions: z.array(PositionSnapshotSchema),
  prices: z.array(PriceSnapshotSchema),
  ledger: z.array(LedgerEntrySchema),
  runId: z.string().nullable(),
  runState: z.string(),
  simulated: z.boolean(),
  demoMode: z.boolean(),
  demoControls: z.boolean().optional(),
  mode: z.string().optional(),
  chainId: z.number().optional(),
  vaultAddress: z.string().optional(),
  owner: z.string().nullable().optional(),
  executor: z.string().nullable().optional(),
  explorerBase: z.string().optional(),
  tokens: z.array(TokenInfoSchema).optional(),
  nextMandateId: z.string().optional(),
  /** Hash of the mandate transaction installed by this process. */
  mandateTxHash: z.string().nullable().optional(),
  /** Deployed contract addresses, for explorer links. */
  contracts: z.object({
    vault: z.string(),
    oracle: z.string(),
    lending: z.string(),
    swap: z.string(),
  }).optional(),
});
export interface TokenInfo {
  symbol: string;
  address: string;
  decimals: number;
}
export interface ApiState {
  vault: VaultSnapshot;
  mandate: Mandate | null;
  positions: PositionSnapshot[];
  prices: PriceSnapshot[];
  ledger: LedgerEntry[];
  runId: string | null;
  runState: string;
  simulated: boolean;
  demoMode: boolean;
  demoControls?: boolean;
  mode?: string;
  chainId?: number;
  vaultAddress?: string;
  owner?: string | null;
  executor?: string | null;
  explorerBase?: string;
  tokens?: TokenInfo[];
  nextMandateId?: string;
  mandateTxHash?: string | null;
  contracts?: { vault: string; oracle: string; lending: string; swap: string };
}

export const ApiEventSchema = z.object({
  runId: z.string(),
  seq: z.number().int().nonnegative(),
  ts: z.number(),
  type: z.enum(['state', 'observe', 'plan', 'explanation', 'action', 'halt', 'report']),
  payload: z.unknown(),
});
export type ApiEvent = z.infer<typeof ApiEventSchema>;
export type ApiPlan = Plan;

const RunStartedSchema = z.object({ runId: z.string(), state: z.string() });
const ConfirmedSchema = z.object({ txHash: HexSchema, mandateId: z.string(), simulated: z.boolean() });
const PreparedWalletSchema = z.object({
  mandate: MandateSchema,
  deadline: z.string().regex(/^(0|[1-9]\d*)$/),
  typedData: z.unknown(),
});
export interface PreparedWallet {
  mandate: Mandate;
  deadline: string;
  typedData: unknown;
}
const AuditSchema = z.object({ runId: z.string(), entries: z.array(AuditEntrySchema), verified: z.boolean() });
const DemoResponseSchema = z.object({ simulated: z.boolean() }).passthrough();

export class ApiRequestError extends Error {
  constructor(readonly status: number, readonly code: string) {
    super(code === 'DemoSignerNotConfigured'
      ? 'Owner signing is not configured on the server. Ask the operator for the owner key or use the simulated demo.'
      : code === 'ClarificationsRequired'
        ? 'Answer the open questions before signing a mandate.'
        : code === 'InvalidOwnerSignature' || code === 'OwnerSignerMismatch'
          ? 'This wallet is not the deployment owner, or the signature does not match. Switch accounts and retry.'
          : code === 'WalletPreparationRequired' || code === 'MandateIdChanged'
            ? 'The mandate changed while you were signing. Draft and sign again.'
            : code === 'ChainTransactionFailed'
              ? 'The chain transaction was broadcast but not confirmed. Check the explorer before retrying.'
              : status === 429
                ? 'Too many requests. Wait a moment and retry.'
                : status >= 500
                  ? 'The service is unavailable. Your draft is saved here; retry shortly.'
                  : `The request could not be completed (${code}).`);
  }
}

async function request<T>(url: string, schema: { parse(input: unknown): unknown }, init?: RequestInit): Promise<T> {
  const response = await fetch(url, {
    ...init,
    headers: { 'Content-Type': 'application/json', ...init?.headers },
  });
  const body: unknown = await response.json();
  if (!response.ok) {
    const error = z.object({ error: z.string() }).safeParse(body);
    throw new ApiRequestError(response.status, error.success ? error.data.error : 'Unknown');
  }
  return schema.parse(body) as T;
}

function post<T>(url: string, body: unknown, schema: { parse(input: unknown): unknown }): Promise<T> {
  return request(url, schema, { method: 'POST', body: serializeJson(body) });
}

export function serializeJson(value: unknown): string { return JSON.stringify(encodeJson(value)); }

export const api = {
  state: () => request<ApiState>('/api/state', ApiStateSchema),
  compile: (text: string): Promise<MandateDraft> => post<MandateDraft>('/api/mandate/compile', { text }, MandateDraftSchema),
  prepareWallet: (draft: unknown) =>
    post<PreparedWallet>('/api/mandate/prepare', { draft }, PreparedWalletSchema),
  confirmDemo: (draft: unknown) =>
    post<{ txHash: string; mandateId: string; simulated: boolean }>(
      '/api/mandate/confirm', { draft, ownerMode: 'demo' }, ConfirmedSchema,
    ),
  confirmWallet: (draft: unknown, mandate: unknown, deadline: string, signature: string) =>
    post<{ txHash: string; mandateId: string; simulated: boolean }>(
      '/api/mandate/confirm', { draft, ownerMode: 'wallet', mandate, deadline, signature }, ConfirmedSchema,
    ),
  run: () => post<{ runId: string; state: string }>('/api/run', { autoExecute: true }, RunStartedSchema),
  approve: (runId: string) => post<{ runId: string; state: string }>(`/api/run/${encodeURIComponent(runId)}/approve`, {}, RunStartedSchema),
  audit: (runId: string) => request<{ runId: string; entries: AuditEntry[]; verified: boolean }>(`/api/audit?run=${encodeURIComponent(runId)}`, AuditSchema),
  pause: () => post('/api/vault/pause', {}, z.object({ txHash: HexSchema, paused: z.boolean() })),
  shock: (token: string, priceUsd8: bigint) => post('/api/demo/shock', {
    token, priceUsd8: priceUsd8.toString(),
  }, DemoResponseSchema),
  inject: (kind: string, value: string | number | boolean) => post('/api/demo/inject', {
    kind, value,
  }, DemoResponseSchema),
};

export function parsePlanEvent(payload: unknown): ApiPlan | null {
  const parsed = PlanSchema.safeParse(payload);
  return parsed.success ? parsed.data as Plan : null;
}

export function connectRunEvents(
  runId: string,
  onEvent: (event: ApiEvent) => void,
  onError: (error: Error) => void,
): () => void {
  const source = new EventSource(`/api/run/${encodeURIComponent(runId)}/events`);
  source.onmessage = (message) => {
    try {
      onEvent(ApiEventSchema.parse(JSON.parse(message.data) as unknown));
    } catch {
      onError(new Error('An event could not be verified. Refresh the chain state before acting.'));
    }
  };
  source.onerror = () => onError(new Error('Live updates were interrupted. Refresh state or reconnect.'));
  return () => source.close();
}
