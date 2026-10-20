import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterEach, describe, expect, test } from 'vitest';
import { z } from 'zod';

import {
  LiveLlmClient,
  OpenAICompatLlm,
  createLlmClientFromEnv,
  readOpenAiCompatOptions,
} from '../src/llm/provider.js';

interface MockReply { status: number; body: unknown }
interface MockServer {
  baseUrl: string;
  requests: Record<string, unknown>[];
  close: () => Promise<void>;
}

const servers: MockServer[] = [];

afterEach(async () => {
  await Promise.all(servers.splice(0).map((server) => server.close()));
});

async function mockServer(reply: (body: Record<string, unknown>) => MockReply): Promise<MockServer> {
  const requests: Record<string, unknown>[] = [];
  const server = createServer((request, response) => {
    let data = '';
    request.on('data', (chunk) => { data += chunk; });
    request.on('end', () => {
      const body = data === '' ? {} : (JSON.parse(data) as Record<string, unknown>);
      requests.push(body);
      const result = reply(body);
      response.writeHead(result.status, { 'content-type': 'application/json' });
      response.end(JSON.stringify(result.body));
    });
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address() as AddressInfo;
  const mock: MockServer = {
    baseUrl: `http://127.0.0.1:${address.port}`,
    requests,
    close: () => new Promise<void>((resolve) => server.close(() => resolve())),
  };
  servers.push(mock);
  return mock;
}

const request = {
  system: 'You are the agent.',
  messages: [{ role: 'user' as const, content: 'rescue the vault' }],
  tools: [{ name: 'get_state', description: 'read state', parameters: { type: 'object', properties: {} } }],
};

const okBody = (message: Record<string, unknown>, model = 'glm-test') => ({
  model,
  choices: [{ message }],
  usage: { prompt_tokens: 11, completion_tokens: 5, total_tokens: 16 },
});

describe('OpenAICompatLlm (local mock HTTP server only)', () => {
  test('maps tool calls, forces temperature 0 and records model/usage', async () => {
    const server = await mockServer(() => ({
      status: 200,
      body: okBody({
        content: '',
        tool_calls: [{ id: 'call_9', type: 'function', function: { name: 'get_state', arguments: '{}' } }],
      }),
    }));
    const llm = new OpenAICompatLlm({
      primary: { provider: 'zai', model: 'glm-5.2', baseUrl: server.baseUrl, apiKey: 'sk-local-test' },
    });
    const response = await llm.complete(request);
    expect(response.toolCalls).toEqual([{ id: 'call_9', name: 'get_state', arguments: {} }]);
    expect(response.model).toBe('glm-test');
    expect(response.temperature).toBe(0);
    expect(response.usage).toEqual({ inputTokens: 11, outputTokens: 5, totalTokens: 16 });
    expect(server.requests[0]?.temperature).toBe(0);
    expect(server.requests[0]?.tools).toHaveLength(1);
  });

  test('falls back to the configured second endpoint on a server error', async () => {
    const primary = await mockServer(() => ({ status: 500, body: { error: 'boom' } }));
    const fallback = await mockServer(() => ({ status: 200, body: okBody({ content: 'fallback answer' }, 'qwen-local') }));
    const llm = new OpenAICompatLlm({
      primary: { provider: 'zai', model: 'glm-5.2', baseUrl: primary.baseUrl, apiKey: 'a' },
      fallback: { provider: 'local', model: 'qwen', baseUrl: fallback.baseUrl, apiKey: '' },
    });
    const response = await llm.complete({ system: 's', messages: [{ role: 'user', content: 'hi' }] });
    expect(response.text).toBe('fallback answer');
    expect(response.model).toBe('qwen-local');
    expect(primary.requests).toHaveLength(1);
    expect(fallback.requests).toHaveLength(1);
  });

  test('retries without tools in JSON-schema mode when the endpoint rejects tool calls', async () => {
    const server = await mockServer((body) => {
      if (body.tools !== undefined) return { status: 400, body: { error: 'tools unsupported' } };
      return {
        status: 200,
        body: okBody({
          content: '{"toolCalls":[{"name":"get_state","arguments":{}}],"text":""}',
        }),
      };
    });
    const llm = new OpenAICompatLlm({
      primary: { provider: 'local', model: 'qwen', baseUrl: server.baseUrl, apiKey: '' },
    });
    const response = await llm.complete(request);
    expect(response.toolCalls).toEqual([{ id: 'json-call-1', name: 'get_state', arguments: {} }]);
    expect(server.requests).toHaveLength(2);
    expect(server.requests[1]?.tools).toBeUndefined();
  });

  test('validates structured output with the caller schema', async () => {
    const server = await mockServer(() => ({
      status: 200,
      body: okBody({ content: '{"summary":"ok"}' }),
    }));
    const llm = new OpenAICompatLlm({
      primary: { provider: 'local', model: 'qwen', baseUrl: server.baseUrl, apiKey: '' },
    });
    const response = await llm.complete({
      system: 's',
      messages: [{ role: 'user', content: 'compile' }],
      schema: z.object({ summary: z.string() }),
    });
    expect(response.structured).toEqual({ summary: 'ok' });
  });

  test('never puts the API key in an error message', async () => {
    const server = await mockServer(() => ({ status: 401, body: { error: 'unauthorized' } }));
    const secret = 'sk-test-secret-value';
    const llm = new OpenAICompatLlm({
      primary: { provider: 'zai', model: 'glm-5.2', baseUrl: server.baseUrl, apiKey: secret },
    });
    const error = await llm.complete(request).catch((reason: unknown) => reason);
    expect(error).toBeInstanceOf(Error);
    expect((error as Error).message).toContain('401');
    expect((error as Error).message).not.toContain(secret);
    expect(JSON.stringify(error)).not.toContain(secret);
  });

  test('factory uses the live client only when provider/model/base URL are configured', () => {
    const options = readOpenAiCompatOptions({
      LLM_PROVIDER: 'zai', LLM_MODEL: 'glm-5.2', LLM_BASE_URL: 'https://example.test/v1/',
      LLM_API_KEY: 'secret', LLM_FALLBACK_MODEL: 'glm-flash', LLM_FALLBACK_BASE_URL: 'http://127.0.0.1:9000/v1',
    });
    expect(options?.primary.baseUrl).toBe('https://example.test/v1');
    expect(options?.fallback?.model).toBe('glm-flash');
    expect(createLlmClientFromEnv({
      LLM_PROVIDER: 'zai', LLM_MODEL: 'glm-5.2', LLM_BASE_URL: 'https://example.test/v1',
    })).toBeInstanceOf(OpenAICompatLlm);
    expect(createLlmClientFromEnv({})).toBeInstanceOf(LiveLlmClient);
  });
});
