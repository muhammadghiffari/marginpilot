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
});
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
const ConfirmedSchema = z.object({ txHash: HexSchema, mandateId: z.string(), simulated: z.literal(true) });
const AuditSchema = z.object({ runId: z.string(), entries: z.array(AuditEntrySchema), verified: z.boolean() });
const DemoResponseSchema = z.object({ simulated: z.literal(true) }).passthrough();

export class ApiRequestError extends Error {
  constructor(readonly status: number, readonly code: string) {
    super(code === 'DemoSignerNotConfigured'
      ? 'Demo signing is not configured. You can still run the preloaded simulated mandate.'
      : code === 'ClarificationsRequired'
        ? 'Answer the open questions before signing a mandate.'
        : status === 429
          ? 'Too many requests. Wait a moment and retry.'
          : status >= 500
            ? 'The demo service is unavailable. Your draft is saved here; retry shortly.'
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
  confirmDemo: (draft: unknown) => post('/api/mandate/confirm', { draft, ownerMode: 'demo' }, ConfirmedSchema),
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
