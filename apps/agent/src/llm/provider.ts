import type { LlmClient, LlmRequest, LlmResponse, LlmToolCall, LlmUsage } from './client.js';
import { ZERO_USAGE } from './client.js';

export interface LlmConfig {
  provider: string;
  model: string;
}

export type LlmEnv = Record<string, string | undefined>;

export class LlmNotConfiguredError extends Error {
  constructor() {
    super('LLM provider is not configured: set LLM_PROVIDER, LLM_MODEL and LLM_BASE_URL');
    this.name = 'LlmNotConfiguredError';
  }
}

export class LlmProviderUnavailableError extends Error {
  constructor(provider: string, model: string) {
    super(`live LLM transport is not configured (${provider}/${model}); use ScriptedLlm or set LLM_BASE_URL`);
    this.name = 'LlmProviderUnavailableError';
  }
}

export class LlmHttpError extends Error {
  constructor(readonly provider: string, readonly model: string, readonly status: number) {
    super(`LLM HTTP ${status} from ${provider} (${model})`);
    this.name = 'LlmHttpError';
  }
}

export class LlmTransportError extends Error {
  constructor(readonly provider: string, readonly model: string, detail: string) {
    super(`LLM transport error from ${provider} (${model}): ${detail}`);
    this.name = 'LlmTransportError';
  }
}

/** Read names only. No key is read, stored, logged or placed in a prompt. */
export function readLlmConfig(env: LlmEnv = process.env): LlmConfig {
  return {
    provider: (env.LLM_PROVIDER ?? '').trim(),
    model: (env.LLM_MODEL ?? '').trim(),
  };
}

export interface OpenAiCompatTarget {
  provider: string;
  model: string;
  baseUrl: string;
  apiKey: string;
  timeoutMs?: number;
}

export interface OpenAiCompatOptions {
  primary: OpenAiCompatTarget;
  fallback?: OpenAiCompatTarget;
}

export function readOpenAiCompatOptions(env: LlmEnv = process.env): OpenAiCompatOptions | null {
  const primary = {
    provider: (env.LLM_PROVIDER ?? '').trim(),
    model: (env.LLM_MODEL ?? '').trim(),
    baseUrl: (env.LLM_BASE_URL ?? '').trim().replace(/\/+$/, ''),
    apiKey: env.LLM_API_KEY ?? '',
    timeoutMs: Number(env.LLM_TIMEOUT_MS ?? '60000'),
  };
  if (primary.provider === '' || primary.model === '' || primary.baseUrl === '') return null;
  const fallbackModel = (env.LLM_FALLBACK_MODEL ?? '').trim();
  const fallbackBase = (env.LLM_FALLBACK_BASE_URL ?? '').trim().replace(/\/+$/, '');
  const fallback = fallbackModel === '' || fallbackBase === ''
    ? undefined
    : {
        provider: (env.LLM_FALLBACK_PROVIDER ?? primary.provider).trim(),
        model: fallbackModel,
        baseUrl: fallbackBase,
        apiKey: env.LLM_FALLBACK_API_KEY ?? primary.apiKey,
        timeoutMs: Number(env.LLM_FALLBACK_TIMEOUT_MS ?? env.LLM_TIMEOUT_MS ?? '60000'),
      };
  return { primary, ...(fallback ? { fallback } : {}) };
}

interface OpenAiMessage {
  role: 'system' | 'user' | 'assistant' | 'tool';
  content: string;
  name?: string;
  tool_call_id?: string;
}

interface OpenAiToolCall {
  id?: string;
  type?: string;
  function?: { name?: string; arguments?: string };
}

interface OpenAiChoice {
  message?: { content?: string | null; tool_calls?: OpenAiToolCall[] };
}

interface OpenAiResponseBody {
  model?: string;
  choices?: OpenAiChoice[];
  usage?: { prompt_tokens?: number; completion_tokens?: number; total_tokens?: number };
}

function toOpenAiMessages(request: LlmRequest<unknown>): OpenAiMessage[] {
  const messages: OpenAiMessage[] = [{ role: 'system', content: request.system }];
  for (const message of request.messages) {
    if (message.role === 'tool') {
      messages.push({
        role: 'tool',
        content: message.content,
        ...(message.name ? { name: message.name, tool_call_id: message.name } : {}),
      });
    } else {
      messages.push({ role: message.role, content: message.content });
    }
  }
  return messages;
}

function parseArguments(raw: string | undefined): unknown {
  if (raw === undefined || raw.trim() === '') return {};
  try {
    return JSON.parse(raw);
  } catch {
    return {};
  }
}

function usageOf(body: OpenAiResponseBody): LlmUsage {
  if (!body.usage) return { ...ZERO_USAGE };
  const inputTokens = body.usage.prompt_tokens ?? 0;
  const outputTokens = body.usage.completion_tokens ?? 0;
  return {
    inputTokens,
    outputTokens,
    totalTokens: body.usage.total_tokens ?? inputTokens + outputTokens,
  };
}

function stripFences(text: string): string {
  const trimmed = text.trim();
  const match = /^```(?:json)?\s*([\s\S]*?)\s*```$/i.exec(trimmed);
  return match?.[1] ?? trimmed;
}

/**
 * OpenAI-compatible chat-completions client (D-006). Primary model first, then the
 * configured fallback. Tools are used when the caller supplies them; if the endpoint
 * rejects tool calls, the client retries in JSON-schema mode. No key is ever logged
 * or embedded in an error; keys live only in the caller's environment.
 */
export class OpenAICompatLlm implements LlmClient {
  constructor(private readonly options: OpenAiCompatOptions) {}

  async complete<T = unknown>(request: LlmRequest<T>): Promise<LlmResponse<T>> {
    try {
      return await this.call(this.options.primary, request);
    } catch (primaryError) {
      if (!this.options.fallback) throw primaryError;
      return this.call(this.options.fallback, request);
    }
  }

  private async call<T>(target: OpenAiCompatTarget, request: LlmRequest<T>): Promise<LlmResponse<T>> {
    try {
      return await this.callOnce(target, request, true);
    } catch (error) {
      if (error instanceof LlmHttpError && request.tools && request.tools.length > 0 &&
          (error.status === 400 || error.status === 422)) {
        return this.callOnce(target, request, false);
      }
      throw error;
    }
  }

  private async callOnce<T>(
    target: OpenAiCompatTarget,
    request: LlmRequest<T>,
    useTools: boolean,
  ): Promise<LlmResponse<T>> {
    const messages = toOpenAiMessages(request);
    const wantsJson = request.schema !== undefined;
    if (!useTools && request.tools && request.tools.length > 0) {
      messages.push({
        role: 'user',
        content: 'The endpoint does not support tool calls. Reply with ONLY a JSON object: ' +
          '{"toolCalls":[{"name":"<tool>","arguments":{...}}],"text":""}. Valid tool names: ' +
          request.tools.map((tool) => tool.name).join(', ') + '.',
      });
    }
    const body: Record<string, unknown> = {
      model: target.model,
      temperature: 0,
      messages,
    };
    if (useTools && request.tools && request.tools.length > 0) {
      body.tools = request.tools.map((tool) => ({
        type: 'function',
        function: { name: tool.name, description: tool.description, parameters: tool.parameters },
      }));
      body.tool_choice = 'auto';
    }
    if (wantsJson) body.response_format = { type: 'json_object' };

    let response: Response;
    try {
      response = await fetch(`${target.baseUrl}/chat/completions`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          ...(target.apiKey === '' ? {} : { authorization: `Bearer ${target.apiKey}` }),
        },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(target.timeoutMs ?? 60_000),
      });
    } catch (error) {
      throw new LlmTransportError(target.provider, target.model, error instanceof Error ? error.name : 'unknown');
    }
    if (!response.ok) throw new LlmHttpError(target.provider, target.model, response.status);

    let parsed: OpenAiResponseBody;
    try {
      parsed = (await response.json()) as OpenAiResponseBody;
    } catch {
      throw new LlmTransportError(target.provider, target.model, 'invalid JSON response');
    }
    const message = parsed.choices?.[0]?.message;
    const content = message?.content ?? '';
    const toolCalls: LlmToolCall[] = (message?.tool_calls ?? []).map((call, index) => ({
      id: call.id ?? `call-${index}`,
      name: call.function?.name ?? '',
      arguments: parseArguments(call.function?.arguments),
    })).filter((call) => call.name !== '');

    if (toolCalls.length > 0) {
      return {
        text: content,
        toolCalls,
        usage: usageOf(parsed),
        model: parsed.model ?? target.model,
        temperature: 0,
      };
    }

    if ((!useTools && request.tools && request.tools.length > 0) || content.trim().startsWith('{')) {
      const fallbackCalls = this.parseJsonToolCalls(content);
      if (fallbackCalls.length > 0) {
        return {
          text: '',
          toolCalls: fallbackCalls,
          usage: usageOf(parsed),
          model: parsed.model ?? target.model,
          temperature: 0,
        };
      }
    }

    let structured: T | undefined;
    if (request.schema) {
      const candidate = this.parseJson(content);
      const validated = request.schema.safeParse(candidate);
      if (!validated.success) {
        throw new LlmTransportError(target.provider, target.model, 'structured output failed schema validation');
      }
      structured = validated.data;
    }

    return {
      text: content,
      toolCalls: [],
      ...(structured !== undefined ? { structured } : {}),
      usage: usageOf(parsed),
      model: parsed.model ?? target.model,
      temperature: 0,
    };
  }

  private parseJson(text: string): unknown {
    try {
      return JSON.parse(stripFences(text));
    } catch {
      return null;
    }
  }

  private parseJsonToolCalls(text: string): LlmToolCall[] {
    const parsed = this.parseJson(text);
    if (typeof parsed !== 'object' || parsed === null) return [];
    const candidate = (parsed as { toolCalls?: unknown }).toolCalls;
    if (!Array.isArray(candidate)) return [];
    const calls: LlmToolCall[] = [];
    for (const entry of candidate) {
      if (typeof entry !== 'object' || entry === null) continue;
      const name = (entry as { name?: unknown }).name;
      const args = (entry as { arguments?: unknown }).arguments;
      if (typeof name !== 'string' || name === '') continue;
      calls.push({
        id: `json-call-${calls.length + 1}`,
        name,
        arguments: typeof args === 'object' && args !== null ? args : {},
      });
    }
    return calls;
  }
}

/**
 * B-07 compatibility stub: used when the environment has no live provider. It is
 * deliberately not a network client, so CI never calls a model.
 */
export class LiveLlmClient implements LlmClient {
  constructor(private readonly config: LlmConfig) {}

  async complete<T = unknown>(_request: LlmRequest<T>): Promise<LlmResponse<T>> {
    if (this.config.provider === '' || this.config.model === '') {
      throw new LlmNotConfiguredError();
    }
    throw new LlmProviderUnavailableError(this.config.provider, this.config.model);
  }
}

export function createLlmClientFromEnv(env: LlmEnv = process.env): LlmClient {
  const options = readOpenAiCompatOptions(env);
  if (options) return new OpenAICompatLlm(options);
  return new LiveLlmClient(readLlmConfig(env));
}
