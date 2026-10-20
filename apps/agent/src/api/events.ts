import {
  AuditLog,
  type AuditEntry,
  type ChainPort,
  type RunState,
} from '@marginpilot/core';

import type { LlmClient, LlmRequest } from '../llm/client.js';
import { ScriptedLlm, type ScriptedTrace } from '../llm/scripted.js';
import { RescueOrchestrator, type RunResult } from '../orchestrator.js';
import type { TokenRegistry } from '../mandate/registry.js';

export type ApiRunEventType =
  | 'state'
  | 'observe'
  | 'plan'
  | 'explanation'
  | 'action'
  | 'halt'
  | 'report';

export interface ApiRunEvent {
  runId: string;
  seq: number;
  ts: number;
  type: ApiRunEventType;
  payload: unknown;
}

export interface RunSessionOptions {
  runId: string;
  chain: ChainPort;
  registry: TokenRegistry;
  autoExecute: boolean;
  now?: () => number;
  maxToolCalls?: number;
  maxReplans?: number;
  maxPlanAgeBlocks?: number;
}

function eventType(kind: string): ApiRunEventType {
  if (kind === 'observe') return 'observe';
  if (kind === 'plan') return 'plan';
  if (kind === 'plan.explained') return 'explanation';
  if (kind.startsWith('action.')) return 'action';
  if (kind === 'halt') return 'halt';
  if (kind === 'report') return 'report';
  return 'state';
}

/** AuditLog that mirrors each append to the SSE subscribers. */
class EmittingAuditLog extends AuditLog {
  constructor(
    runId: string,
    private readonly onEntry: (entry: AuditEntry) => void,
  ) {
    super(runId);
  }

  override append(kind: string, data: unknown, ts?: number): AuditEntry {
    const entry = ts === undefined ? super.append(kind, data) : super.append(kind, data, ts);
    this.onEntry(entry);
    return entry;
  }
}

class DeferredLlm implements LlmClient {
  inner?: LlmClient;

  async complete<T = unknown>(request: LlmRequest<T>) {
    if (!this.inner) throw new Error('run LLM is not ready');
    return this.inner.complete(request);
  }
}

function tool(name: string, args: Record<string, unknown> = {}) {
  toolCounter += 1;
  return { id: `call-${toolCounter}`, name, arguments: args };
}

let toolCounter = 0;

function marketOf(registry: TokenRegistry) {
  return {
    reserveToken: registry.tokens.mUSDC,
    lendingSim: registry.targets.lending,
    tokenDecimals: {
      [registry.tokens.mUSDC]: 6,
      [registry.tokens.mWETH]: 18,
      [registry.tokens.mWSTETH]: 18,
    },
  };
}

export class RunSession {
  readonly runId: string;
  readonly autoExecute: boolean;
  readonly events: ApiRunEvent[] = [];
  readonly startedAt = Date.now();
  state: RunState;
  result?: RunResult;
  done?: Promise<RunResult>;
  readonly orchestrator: RescueOrchestrator;

  private readonly auditLog: EmittingAuditLog;
  private readonly subscribers = new Set<(event: ApiRunEvent) => void>();
  private seq = 0;

  constructor(options: RunSessionOptions) {
    this.runId = options.runId;
    this.autoExecute = options.autoExecute;
    this.state = options.autoExecute ? 'IDLE' : 'AWAITING_APPROVAL';

    const deferred = new DeferredLlm();
    this.auditLog = new EmittingAuditLog(this.runId, (entry) => this.publish(entry));
    this.orchestrator = new RescueOrchestrator({
      chain: options.chain,
      llm: deferred,
      market: marketOf(options.registry),
      registry: options.registry,
      runId: this.runId,
      audit: this.auditLog,
      ...(options.now ? { now: options.now } : {}),
      ...(options.maxToolCalls ? { maxToolCalls: options.maxToolCalls } : {}),
      ...(options.maxReplans ? { maxReplans: options.maxReplans } : {}),
      ...(options.maxPlanAgeBlocks ? { maxPlanAgeBlocks: options.maxPlanAgeBlocks } : {}),
    });

    const traces: ScriptedTrace[] = [
      { toolCalls: [tool('get_state')] },
      { toolCalls: [tool('plan_rescue')] },
      {
        toolCalls: () => {
          const plan = this.orchestrator.currentPlan;
          if (!plan) return [tool('halt_and_ask_owner', {
            reason: { kind: 'NEEDS_OWNER_DECISION', detail: 'no plan available' },
          })];
          return [
            tool('explain_plan', { planId: plan.planId }),
            ...plan.actions.map((entry) =>
              tool('execute_plan_action', { planId: plan.planId, index: entry.index }),
            ),
          ];
        },
      },
      { toolCalls: [tool('finish_run')] },
    ];
    deferred.inner = new ScriptedLlm(traces);
    this.publishState(this.state);
  }

  get audit(): AuditEntry[] {
    return [...this.auditLog.entries];
  }

  start(): Promise<RunResult> {
    if (this.done) return this.done;
    this.state = 'OBSERVING';
    this.publishState(this.state);
    this.done = this.orchestrator.run().then((result) => {
      this.result = result;
      this.state = result.state;
      this.publishState(this.state);
      return result;
    });
    return this.done;
  }

  subscribe(listener: (event: ApiRunEvent) => void): () => void {
    this.subscribers.add(listener);
    return () => this.subscribers.delete(listener);
  }

  private publish(entry: AuditEntry): void {
    this.emit(eventType(entry.kind), entry.data, entry.ts);
  }

  private publishState(state: RunState): void {
    this.emit('state', { state }, Date.now());
  }

  private emit(type: ApiRunEventType, payload: unknown, ts: number): void {
    const event: ApiRunEvent = {
      runId: this.runId,
      seq: this.seq,
      ts,
      type,
      payload,
    };
    this.seq += 1;
    this.events.push(event);
    for (const listener of this.subscribers) listener(event);
  }
}

export class RunStore {
  private readonly sessions = new Map<string, RunSession>();
  private latestId?: string;

  create(options: RunSessionOptions): RunSession {
    const session = new RunSession(options);
    this.sessions.set(session.runId, session);
    this.latestId = session.runId;
    return session;
  }

  get(runId: string): RunSession | undefined {
    return this.sessions.get(runId);
  }

  latest(): RunSession | undefined {
    return this.latestId ? this.sessions.get(this.latestId) : undefined;
  }

  all(): RunSession[] {
    return [...this.sessions.values()];
  }
}

export function formatSse(event: ApiRunEvent): string {
  return `id: ${event.seq}\ndata: ${JSON.stringify(event)}\n\n`;
}
