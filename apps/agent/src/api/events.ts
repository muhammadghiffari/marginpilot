import {
  AuditLog,
  type AuditEntry,
  type ChainPort,
  type RunState,
} from '@marginpilot/core';

import type { LlmClient, LlmRequest, LlmToolCall } from '../llm/client.js';
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

/**
 * How many times the run script may take one more step. A step is either an
 * action, a replan, or the final report, so a rescue with two positions and a
 * couple of replans stays well inside the limit.
 */
const ACT_TRACE_REPEATS = 12;

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

/** Tool-result shape the run script reads back to decide the next step. */
interface ToolResultView {
  ok?: boolean;
  error?: string;
  needsReplan?: boolean;
  status?: string;
  planComplete?: boolean;
  planId?: string;
  actionIndex?: number;
  state?: string;
  actions?: { index?: number }[];
}

function lastToolResult(request: LlmRequest<unknown>): ToolResultView | undefined {
  for (let index = request.messages.length - 1; index >= 0; index -= 1) {
    const message = request.messages[index];
    if (!message || message.role !== 'tool') continue;
    try {
      const parsed: unknown = JSON.parse(message.content);
      if (typeof parsed === 'object' && parsed !== null) return parsed as ToolResultView;
      return undefined;
    } catch {
      return undefined;
    }
  }
  return undefined;
}

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
  private readonly explainedPlans = new Set<string>();
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
      { repeat: ACT_TRACE_REPEATS, toolCalls: (request) => this.nextStep(request) },
      { toolCalls: [tool('finish_run')] },
    ];
    deferred.inner = new ScriptedLlm(traces);
    this.publishState(this.state);
  }

  /**
   * Deterministic next step for the run script. It behaves like a careful
   * operator: execute the current plan in order, and when the vault's plan-age
   * check rejects an action (public testnets confirm a transaction several
   * blocks later) replan against fresh chain state instead of ending the run.
   */
  private nextStep(request: LlmRequest<unknown>): LlmToolCall[] {
    const result = lastToolResult(request);

    // No tool result yet: explain the plan and run its first action.
    if (!result) {
      const plan = this.orchestrator.currentPlan;
      if (!plan || plan.actions.length === 0) {
        return [tool('halt_and_ask_owner', {
          reason: { kind: 'NEEDS_OWNER_DECISION', detail: 'no plan available' },
        })];
      }
      return [
        tool('explain_plan', { planId: plan.planId }),
        tool('execute_plan_action', { planId: plan.planId, index: plan.actions[0]?.index ?? 0 }),
      ];
    }

    // A fresh plan (first plan or replan): execute its first action.
    if (Array.isArray(result.actions)) {
      const first = result.actions[0];
      if (!first || typeof result.planId !== 'string') return [tool('finish_run')];
      return this.executeWithExplanation(result.planId, first.index ?? 0);
    }

    // An executed action.
    if (result.ok === true && result.status === 'mined') {
      if (result.planComplete === true) return [tool('finish_run')];
      const plan = this.orchestrator.currentPlan;
      const planId = result.planId;
      const actionIndex = result.actionIndex;
      if (plan && planId && typeof actionIndex === 'number' && plan.planId === planId) {
        const next = plan.actions.find((entry) => entry.index === actionIndex + 1);
        if (next) return [tool('execute_plan_action', { planId, index: next.index })];
      }
      return [tool('plan_rescue')];
    }

    // The plan aged out, the nonce moved, or the budget cap bit: replan.
    if (result.needsReplan === true || result.error === 'StaleAction') {
      return [tool('plan_rescue')];
    }

    return [tool('finish_run')];
  }

  private executeWithExplanation(planId: string, index: number): LlmToolCall[] {
    if (!this.explainedPlans.has(planId)) {
      this.explainedPlans.add(planId);
      return [tool('explain_plan', { planId }), tool('execute_plan_action', { planId, index })];
    }
    return [tool('execute_plan_action', { planId, index })];
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
  private readonly maxSessions: number;

  constructor(maxSessions = 50) {
    this.maxSessions = Math.max(1, maxSessions);
  }

  create(options: RunSessionOptions): RunSession {
    // Bound memory on a public demo: evict the oldest completed sessions.
    while (this.sessions.size >= this.maxSessions) {
      const oldest = this.sessions.keys().next().value as string | undefined;
      if (oldest === undefined) break;
      const session = this.sessions.get(oldest);
      if (session && session.done === undefined) break;
      this.sessions.delete(oldest);
    }
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
