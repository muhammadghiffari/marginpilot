import type { LlmClient, LlmRequest, LlmResponse, LlmToolCall, LlmUsage } from './client.js';
import { ZERO_USAGE } from './client.js';

export interface ScriptedTrace {
  /** Selects the trace by substring/regex against the last user message. Omit for strict order. */
  when?: string | RegExp;
  text?: string;
  /**
   * A recorded list, or a deterministic function of the request history. The
   * function exists so scenario traces can reference the plan id returned by an
   * earlier tool without hard-coding it.
   */
  toolCalls?:
    | readonly LlmToolCall[]
    | ((request: LlmRequest<unknown>) => readonly LlmToolCall[]);
  structured?: unknown;
  usage?: Partial<LlmUsage>;
  model?: string;
  temperature?: number;
  /**
   * How many times this trace may answer (default 1). A repeatable trace models
   * a step the agent takes again after new chain state, e.g. replanning when a
   * plan aged out; every use still replays the same deterministic script.
   */
  repeat?: number;
}

export class ScriptedLlmExhaustedError extends Error {
  constructor() {
    super('ScriptedLlm has no unused trace for this request');
    this.name = 'ScriptedLlmExhaustedError';
  }
}

function matches(trace: ScriptedTrace, lastUser: string): boolean {
  if (trace.when === undefined) return true;
  if (typeof trace.when === 'string') return lastUser.includes(trace.when);
  trace.when.lastIndex = 0;
  return trace.when.test(lastUser);
}

function usageOf(partial: Partial<LlmUsage> | undefined): LlmUsage {
  if (!partial) return { ...ZERO_USAGE };
  const inputTokens = partial.inputTokens ?? 0;
  const outputTokens = partial.outputTokens ?? 0;
  return {
    inputTokens,
    outputTokens,
    totalTokens: partial.totalTokens ?? inputTokens + outputTokens,
  };
}

/**
 * Deterministic CI/demo provider. Traces are immutable and consumed once, so a
 * replay cannot silently change behavior between runs. No network access.
 */
export class ScriptedLlm implements LlmClient {
  private readonly used = new Map<number, number>();

  constructor(
    private readonly traces: readonly ScriptedTrace[],
    private readonly defaults: { model?: string; temperature?: number } = {},
  ) {}

  async complete<T = unknown>(request: LlmRequest<T>): Promise<LlmResponse<T>> {
    const lastUser = [...request.messages].reverse().find((message) => message.role === 'user')?.content ?? '';
    let selected = -1;
    for (let index = 0; index < this.traces.length; index += 1) {
      const trace = this.traces[index];
      if (!trace) continue;
      const used = this.used.get(index) ?? 0;
      if (used >= Math.max(1, trace.repeat ?? 1)) continue;
      if (matches(trace, lastUser)) {
        selected = index;
        break;
      }
    }
    if (selected < 0) throw new ScriptedLlmExhaustedError();

    this.used.set(selected, (this.used.get(selected) ?? 0) + 1);
    const trace = this.traces[selected] as ScriptedTrace;
    const toolCalls =
      typeof trace.toolCalls === 'function'
        ? trace.toolCalls(request as LlmRequest<unknown>)
        : (trace.toolCalls ?? []);
    return {
      text: trace.text ?? '',
      toolCalls,
      structured: trace.structured as T | undefined,
      usage: usageOf(trace.usage),
      model: trace.model ?? this.defaults.model ?? 'scripted-local',
      temperature: trace.temperature ?? this.defaults.temperature ?? request.temperature ?? 0,
    };
  }

  get remaining(): number {
    return this.traces.reduce(
      (total, trace, index) => total + Math.max(0, Math.max(1, trace.repeat ?? 1) - (this.used.get(index) ?? 0)),
      0,
    );
  }
}
