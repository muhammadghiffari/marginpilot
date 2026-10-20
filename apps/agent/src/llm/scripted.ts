import type { LlmClient, LlmRequest, LlmResponse, LlmToolCall, LlmUsage } from './client.js';
import { ZERO_USAGE } from './client.js';

export interface ScriptedTrace {
  /** Selects the trace by substring/regex against the last user message. Omit for strict order. */
  when?: string | RegExp;
  text?: string;
  toolCalls?: readonly LlmToolCall[];
  structured?: unknown;
  usage?: Partial<LlmUsage>;
  model?: string;
  temperature?: number;
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
  private readonly used = new Set<number>();

  constructor(
    private readonly traces: readonly ScriptedTrace[],
    private readonly defaults: { model?: string; temperature?: number } = {},
  ) {}

  async complete<T = unknown>(request: LlmRequest<T>): Promise<LlmResponse<T>> {
    const lastUser = [...request.messages].reverse().find((message) => message.role === 'user')?.content ?? '';
    let selected = -1;
    for (let index = 0; index < this.traces.length; index += 1) {
      if (this.used.has(index)) continue;
      const trace = this.traces[index];
      if (trace && matches(trace, lastUser)) {
        selected = index;
        break;
      }
    }
    if (selected < 0) throw new ScriptedLlmExhaustedError();

    this.used.add(selected);
    const trace = this.traces[selected] as ScriptedTrace;
    return {
      text: trace.text ?? '',
      toolCalls: trace.toolCalls ?? [],
      structured: trace.structured as T | undefined,
      usage: usageOf(trace.usage),
      model: trace.model ?? this.defaults.model ?? 'scripted-local',
      temperature: trace.temperature ?? this.defaults.temperature ?? request.temperature ?? 0,
    };
  }

  get remaining(): number {
    return this.traces.length - this.used.size;
  }
}
