import type { z } from 'zod';

export type LlmRole = 'system' | 'user' | 'assistant' | 'tool';

export interface LlmMessage {
  role: LlmRole;
  content: string;
  /** Optional tool name for role="tool". */
  name?: string;
}

export interface LlmToolCall {
  id: string;
  name: string;
  arguments: unknown;
}

export interface LlmToolDefinition {
  name: string;
  description: string;
  parameters: unknown;
}

export interface LlmUsage {
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
}

export interface LlmRequest<T = unknown> {
  system: string;
  messages: readonly LlmMessage[];
  tools?: readonly LlmToolDefinition[];
  /** When present, a provider must return schema-valid structured output. */
  schema?: z.ZodType<T>;
  temperature?: number;
}

export interface LlmResponse<T = unknown> {
  text: string;
  toolCalls: readonly LlmToolCall[];
  structured?: T;
  usage: LlmUsage;
  model: string;
  temperature: number;
}

/** The only provider seam. Provider details never leak into compile/orchestration code. */
export interface LlmClient {
  complete<T = unknown>(request: LlmRequest<T>): Promise<LlmResponse<T>>;
}

export const ZERO_USAGE: LlmUsage = { inputTokens: 0, outputTokens: 0, totalTokens: 0 };
