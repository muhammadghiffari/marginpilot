import type { LlmClient, LlmRequest, LlmResponse } from './client.js';

export interface LlmConfig {
  provider: string;
  model: string;
}

export type LlmEnv = Record<string, string | undefined>;

export class LlmNotConfiguredError extends Error {
  constructor() {
    super('LLM provider is not configured: set LLM_PROVIDER and LLM_MODEL');
    this.name = 'LlmNotConfiguredError';
  }
}

export class LlmProviderUnavailableError extends Error {
  constructor(provider: string, model: string) {
    super(`live LLM transport is not implemented in this build (${provider}/${model}); use ScriptedLlm`);
    this.name = 'LlmProviderUnavailableError';
  }
}

/** Read names only. No key is read, stored, logged or placed in a prompt. */
export function readLlmConfig(env: LlmEnv = process.env): LlmConfig {
  return {
    provider: (env.LLM_PROVIDER ?? '').trim(),
    model: (env.LLM_MODEL ?? '').trim(),
  };
}

/**
 * B-07 provider stub. It is deliberately not a network client: the project does
 * not ship a live provider in the P0 slice. The typed failure keeps the seam
 * testable and makes an empty configuration explicit rather than silent.
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
  return new LiveLlmClient(readLlmConfig(env));
}
