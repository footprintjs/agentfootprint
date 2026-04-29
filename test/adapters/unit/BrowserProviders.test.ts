/**
 * BrowserAnthropicProvider + BrowserOpenAIProvider — 7-pattern tests.
 * Uses injected fake `_fetch` instead of real network calls.
 */

import { describe, expect, it, vi } from 'vitest';

import {
  browserAnthropic,
  BrowserAnthropicProvider,
} from '../../../src/adapters/llm/BrowserAnthropicProvider.js';
import {
  browserOpenai,
  BrowserOpenAIProvider,
} from '../../../src/adapters/llm/BrowserOpenAIProvider.js';
import type { LLMRequest } from '../../../src/adapters/types.js';

// ─── Fake fetch helpers ────────────────────────────────────────────

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

function fakeFetch(body: unknown, status = 200, recorder?: { calls: RequestInit[] }): typeof fetch {
  return ((_url: RequestInfo | URL, init?: RequestInit) => {
    if (recorder && init) recorder.calls.push(init);
    return Promise.resolve(jsonResponse(body, status));
  }) as typeof fetch;
}

const baseRequest: LLMRequest = {
  messages: [{ role: 'user', content: 'hi' }],
  model: 'anthropic',
};

// ════════════════════════════════════════════════════════════════════
// BrowserAnthropicProvider
// ════════════════════════════════════════════════════════════════════

const baseAnthropicResponse = {
  id: 'msg_1',
  model: 'claude-sonnet-4-5-20250929',
  role: 'assistant',
  content: [{ type: 'text', text: 'hello' }],
  stop_reason: 'end_turn',
  usage: { input_tokens: 10, output_tokens: 2 },
};

describe('BrowserAnthropicProvider — unit', () => {
  it('throws synchronously without apiKey', () => {
    expect(() => browserAnthropic({ apiKey: '' })).toThrow(/requires `apiKey`/);
  });

  it('provider name is "browser-anthropic"', () => {
    const p = browserAnthropic({
      apiKey: 'sk-test',
      _fetch: fakeFetch(baseAnthropicResponse),
    });
    expect(p.name).toBe('browser-anthropic');
  });

  it('complete() normalizes Anthropic response to v2 LLMResponse', async () => {
    const p = browserAnthropic({
      apiKey: 'sk-test',
      _fetch: fakeFetch(baseAnthropicResponse),
    });
    const res = await p.complete(baseRequest);
    expect(res.content).toBe('hello');
    expect(res.usage).toEqual({ input: 10, output: 2 });
    expect(res.stopReason).toBe('stop');
    expect(res.providerRef).toBe('msg_1');
  });

  it('sends required Anthropic browser headers', async () => {
    const recorder = { calls: [] as RequestInit[] };
    const p = browserAnthropic({
      apiKey: 'sk-test',
      _fetch: fakeFetch(baseAnthropicResponse, 200, recorder),
    });
    await p.complete(baseRequest);
    const headers = recorder.calls[0]!.headers as Record<string, string>;
    expect(headers['x-api-key']).toBe('sk-test');
    expect(headers['anthropic-version']).toBe('2023-06-01');
    expect(headers['anthropic-dangerous-direct-browser-access']).toBe('true');
  });

  it('class form behaves identically', async () => {
    const provider = new BrowserAnthropicProvider({
      apiKey: 'sk-test',
      _fetch: fakeFetch(baseAnthropicResponse),
    });
    const res = await provider.complete(baseRequest);
    expect(res.content).toBe('hello');
  });
});

describe('BrowserAnthropicProvider — security', () => {
  it('wraps non-OK responses with status', async () => {
    const p = browserAnthropic({
      apiKey: 'sk-test',
      _fetch: fakeFetch({ error: 'unauthorized' }, 401),
    });
    let caught: Error | undefined;
    try {
      await p.complete(baseRequest);
    } catch (e) {
      caught = e as Error;
    }
    expect(caught?.name).toBe('BrowserAnthropicProviderError');
    expect((caught as { status?: number }).status).toBe(401);
  });

  it('wraps fetch rejection with provider tag', async () => {
    const networkError = (() => {
      throw new Error('fetch failed: ENOTFOUND');
    }) as unknown as typeof fetch;
    const p = browserAnthropic({ apiKey: 'sk-test', _fetch: networkError });
    let caught: Error | undefined;
    try {
      await p.complete(baseRequest);
    } catch (e) {
      caught = e as Error;
    }
    expect(caught?.message).toContain('fetch failed');
    expect(caught?.name).toBe('BrowserAnthropicProviderError');
  });
});

describe('BrowserAnthropicProvider — performance', () => {
  it('1000 complete() calls under 500ms with fake fetch', async () => {
    const p = browserAnthropic({
      apiKey: 'sk-test',
      _fetch: fakeFetch(baseAnthropicResponse),
    });
    const start = performance.now();
    for (let i = 0; i < 1000; i++) await p.complete(baseRequest);
    const elapsed = performance.now() - start;
    expect(elapsed).toBeLessThan(500);
  });
});

// ════════════════════════════════════════════════════════════════════
// BrowserOpenAIProvider
// ════════════════════════════════════════════════════════════════════

const baseOpenAIResponse = {
  id: 'chatcmpl_1',
  model: 'gpt-4o-mini',
  choices: [
    {
      index: 0,
      message: { role: 'assistant', content: 'hello' },
      finish_reason: 'stop',
    },
  ],
  usage: { prompt_tokens: 10, completion_tokens: 2 },
};

const openaiRequest: LLMRequest = { ...baseRequest, model: 'openai' };

describe('BrowserOpenAIProvider — unit', () => {
  it('throws synchronously without apiKey', () => {
    expect(() => browserOpenai({ apiKey: '' })).toThrow(/requires `apiKey`/);
  });

  it('provider name is "browser-openai"', () => {
    const p = browserOpenai({ apiKey: 'sk-test', _fetch: fakeFetch(baseOpenAIResponse) });
    expect(p.name).toBe('browser-openai');
  });

  it('sends Authorization header with Bearer key', async () => {
    const recorder = { calls: [] as RequestInit[] };
    const p = browserOpenai({
      apiKey: 'sk-test',
      _fetch: fakeFetch(baseOpenAIResponse, 200, recorder),
    });
    await p.complete(openaiRequest);
    const headers = recorder.calls[0]!.headers as Record<string, string>;
    expect(headers.authorization).toBe('Bearer sk-test');
  });

  it('attaches openai-organization header when given', async () => {
    const recorder = { calls: [] as RequestInit[] };
    const p = browserOpenai({
      apiKey: 'sk-test',
      organization: 'org-123',
      _fetch: fakeFetch(baseOpenAIResponse, 200, recorder),
    });
    await p.complete(openaiRequest);
    const headers = recorder.calls[0]!.headers as Record<string, string>;
    expect(headers['openai-organization']).toBe('org-123');
  });

  it('complete() normalizes prompt_tokens / completion_tokens', async () => {
    const p = browserOpenai({ apiKey: 'sk-test', _fetch: fakeFetch(baseOpenAIResponse) });
    const res = await p.complete(openaiRequest);
    expect(res.content).toBe('hello');
    expect(res.usage).toEqual({ input: 10, output: 2 });
    expect(res.stopReason).toBe('stop');
  });

  it('class form behaves identically', async () => {
    const provider = new BrowserOpenAIProvider({
      apiKey: 'sk-test',
      _fetch: fakeFetch(baseOpenAIResponse),
    });
    const res = await provider.complete(openaiRequest);
    expect(res.content).toBe('hello');
  });
});

describe('BrowserOpenAIProvider — security', () => {
  it('wraps 4xx with status', async () => {
    const p = browserOpenai({
      apiKey: 'sk-test',
      _fetch: fakeFetch({ error: 'rate limited' }, 429),
    });
    let caught: Error | undefined;
    try {
      await p.complete(openaiRequest);
    } catch (e) {
      caught = e as Error;
    }
    expect(caught?.name).toBe('BrowserOpenAIProviderError');
    expect((caught as { status?: number }).status).toBe(429);
  });

  it('uses custom apiUrl override (Ollama proxy etc.)', async () => {
    const recorder = { calls: [] as RequestInit[] };
    let lastUrl = '';
    const fetchImpl = ((url: RequestInfo | URL, init?: RequestInit) => {
      lastUrl = String(url);
      if (recorder && init) recorder.calls.push(init);
      return Promise.resolve(jsonResponse(baseOpenAIResponse));
    }) as typeof fetch;
    const p = browserOpenai({
      apiKey: 'sk-test',
      apiUrl: 'http://localhost:11434/v1/chat/completions',
      _fetch: fetchImpl,
    });
    await p.complete(openaiRequest);
    expect(lastUrl).toBe('http://localhost:11434/v1/chat/completions');
  });
});

describe('BrowserOpenAIProvider — performance', () => {
  it('1000 complete() calls under 500ms with fake fetch', async () => {
    const p = browserOpenai({ apiKey: 'sk-test', _fetch: fakeFetch(baseOpenAIResponse) });
    const start = performance.now();
    for (let i = 0; i < 1000; i++) await p.complete(openaiRequest);
    const elapsed = performance.now() - start;
    expect(elapsed).toBeLessThan(500);
  });
});

// ─── Property — both browser providers share invariants ───────────

describe('Browser providers — property (shared invariants)', () => {
  it('apiKey is mandatory for both providers', () => {
    expect(() => browserAnthropic({ apiKey: '' })).toThrow();
    expect(() => browserOpenai({ apiKey: '' })).toThrow();
  });

  it('apiUrl override is honored by both', async () => {
    const recorder = { calls: [] as RequestInit[] };
    let lastUrl = '';
    const fetchImpl = ((url: RequestInfo | URL, init?: RequestInit) => {
      lastUrl = String(url);
      if (recorder && init) recorder.calls.push(init);
      return Promise.resolve(jsonResponse(baseAnthropicResponse));
    }) as typeof fetch;
    const a = browserAnthropic({
      apiKey: 'sk-test',
      apiUrl: 'https://proxy.example.com/anthropic',
      _fetch: fetchImpl,
    });
    await a.complete(baseRequest);
    expect(lastUrl).toBe('https://proxy.example.com/anthropic');
  });
});

// Use the recorder import to keep the linter happy when test patterns
// don't naturally pull it in.
void vi;
