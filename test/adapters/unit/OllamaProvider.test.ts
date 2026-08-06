/**
 * OllamaProvider — 7-pattern tests
 * (unit · scenario · integration · property · security · performance · ROI).
 *
 * Uses an injected fake `_fetch` instead of a real daemon, so the whole
 * file runs offline with nothing installed. The live-daemon counterpart
 * is `test/adapters/integration/ollama-live.test.ts`, gated on
 * AGENTFOOTPRINT_OLLAMA_LIVE.
 */

import { describe, expect, it, vi } from 'vitest';

import {
  ollama,
  OllamaProvider,
  OllamaUnavailableError,
} from '../../../src/adapters/llm/OllamaProvider.js';
import type { LLMRequest } from '../../../src/adapters/types.js';
import { expectScalesLinearly } from '../../helpers/perf.js';

// ─── Fake wire helpers ─────────────────────────────────────────────

interface WireCall {
  readonly url: string;
  readonly init: RequestInit | undefined;
  readonly body: Record<string, unknown>;
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

/** NDJSON body — one JSON object per line, exactly like /api/chat streaming. */
function ndjsonResponse(frames: readonly unknown[], opts: { chunkSize?: number } = {}): Response {
  const text = frames.map((f) => `${JSON.stringify(f)}\n`).join('');
  const bytes = new TextEncoder().encode(text);
  const size = opts.chunkSize ?? bytes.length;
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      for (let i = 0; i < bytes.length; i += size) {
        controller.enqueue(bytes.slice(i, i + size));
      }
      controller.close();
    },
  });
  return new Response(stream, { status: 200, headers: { 'content-type': 'application/x-ndjson' } });
}

/**
 * Fake fetch that answers /api/chat with `chat` and /api/tags with `tags`,
 * recording every call it saw.
 */
function fakeFetch(
  chat: Response | (() => Response | Promise<Response>),
  opts: { calls?: WireCall[]; tags?: Response | (() => Response) } = {},
): typeof fetch {
  return ((url: RequestInfo | URL, init?: RequestInit) => {
    const href = String(url);
    if (opts.calls) {
      let body: Record<string, unknown> = {};
      if (typeof init?.body === 'string') body = JSON.parse(init.body) as Record<string, unknown>;
      opts.calls.push({ url: href, init, body });
    }
    if (href.endsWith('/api/tags')) {
      if (!opts.tags) return Promise.reject(new Error('no tags stub'));
      return Promise.resolve(typeof opts.tags === 'function' ? opts.tags() : opts.tags);
    }
    return Promise.resolve(typeof chat === 'function' ? chat() : chat);
  }) as typeof fetch;
}

const okReply = {
  model: 'llama3.2',
  created_at: '2026-08-05T00:00:00Z',
  message: { role: 'assistant', content: 'hello' },
  done: true,
  done_reason: 'stop',
  prompt_eval_count: 11,
  eval_count: 3,
};

const baseRequest: LLMRequest = {
  messages: [{ role: 'user', content: 'hi' }],
  model: 'llama3.2',
};

// ════════════════════════════════════════════════════════════════════
// UNIT
// ════════════════════════════════════════════════════════════════════

describe('OllamaProvider — unit: identity and capabilities', () => {
  it('is named "ollama"', () => {
    expect(ollama('llama3.2').name).toBe('ollama');
  });

  it('carries all three roles inside messages', () => {
    expect(ollama('llama3.2').carriesInMessages).toEqual(['system', 'user', 'assistant']);
  });

  it('does NOT carry forced tool choice — Ollama has no tool_choice', () => {
    expect(ollama('llama3.2').carriesForcedToolChoice).toBe(false);
  });

  it('exposes stream()', () => {
    expect(typeof ollama('llama3.2').stream).toBe('function');
  });

  it('needs no API key and no SDK to construct', () => {
    expect(() => ollama('llama3.2')).not.toThrow();
    expect(() => ollama()).not.toThrow();
  });
});

describe('OllamaProvider — unit: address resolution', () => {
  async function urlFor(factoryArg: Parameters<typeof ollama>[0], second?: unknown) {
    const calls: WireCall[] = [];
    const p = ollama(
      factoryArg as never,
      {
        ...(second as object),
        _fetch: fakeFetch(jsonResponse(okReply), { calls }),
      } as never,
    );
    await p.complete(baseRequest);
    return calls[0]!.url;
  }

  it('defaults to http://localhost:11434/api/chat', async () => {
    expect(await urlFor('llama3.2')).toBe('http://localhost:11434/api/chat');
  });

  it('accepts baseUrl', async () => {
    expect(await urlFor('llama3.2', { baseUrl: 'http://10.0.0.4:11434' })).toBe(
      'http://10.0.0.4:11434/api/chat',
    );
  });

  it('adds a scheme to a bare host:port', async () => {
    expect(await urlFor('llama3.2', { baseUrl: '10.0.0.4:11434' })).toBe(
      'http://10.0.0.4:11434/api/chat',
    );
  });

  it('trims a trailing slash', async () => {
    expect(await urlFor('llama3.2', { baseUrl: 'http://localhost:11434/' })).toBe(
      'http://localhost:11434/api/chat',
    );
  });

  it('trims a /v1 suffix — an 8.0.0 config points at the same machine', async () => {
    expect(await urlFor('llama3.2', { baseUrl: 'http://localhost:11434/v1' })).toBe(
      'http://localhost:11434/api/chat',
    );
  });

  it('honors OLLAMA_HOST when nothing was passed', async () => {
    const prev = process.env.OLLAMA_HOST;
    process.env.OLLAMA_HOST = 'http://192.168.1.9:11434';
    try {
      expect(await urlFor('llama3.2')).toBe('http://192.168.1.9:11434/api/chat');
    } finally {
      if (prev === undefined) delete process.env.OLLAMA_HOST;
      else process.env.OLLAMA_HOST = prev;
    }
  });

  it('an explicit baseUrl beats OLLAMA_HOST', async () => {
    const prev = process.env.OLLAMA_HOST;
    process.env.OLLAMA_HOST = 'http://192.168.1.9:11434';
    try {
      expect(await urlFor('llama3.2', { baseUrl: 'http://localhost:1234' })).toBe(
        'http://localhost:1234/api/chat',
      );
    } finally {
      if (prev === undefined) delete process.env.OLLAMA_HOST;
      else process.env.OLLAMA_HOST = prev;
    }
  });
});

describe('OllamaProvider — unit: the 8.0.0 object form still works', () => {
  it('accepts { host, defaultModel } and routes to the native wire', async () => {
    const calls: WireCall[] = [];
    const p = ollama({
      host: 'http://localhost:11434',
      defaultModel: 'llama3.1',
      apiKey: 'ollama', // accepted and ignored
      _fetch: fakeFetch(jsonResponse(okReply), { calls }),
    });
    await p.complete({ ...baseRequest, model: 'ollama' });
    expect(calls[0]!.url).toBe('http://localhost:11434/api/chat');
    expect(calls[0]!.body.model).toBe('llama3.1');
  });

  it('accepts the { baseURL } spelling too', async () => {
    const calls: WireCall[] = [];
    const p = ollama({
      baseURL: 'http://localhost:11434/v1',
      _fetch: fakeFetch(jsonResponse(okReply), { calls }),
    });
    await p.complete(baseRequest);
    expect(calls[0]!.url).toBe('http://localhost:11434/api/chat');
  });

  it('sends no Authorization header — there is no key to leak', async () => {
    const calls: WireCall[] = [];
    const p = ollama('llama3.2', {
      apiKey: 'super-secret',
      _fetch: fakeFetch(jsonResponse(okReply), { calls }),
    });
    await p.complete(baseRequest);
    const headers = calls[0]!.init!.headers as Record<string, string>;
    expect(Object.keys(headers).map((k) => k.toLowerCase())).toEqual(['content-type']);
  });
});

describe('OllamaProvider — unit: request body', () => {
  async function bodyFor(req: Partial<LLMRequest>, options: Record<string, unknown> = {}) {
    const calls: WireCall[] = [];
    const p = ollama('llama3.2', {
      ...options,
      _fetch: fakeFetch(jsonResponse(okReply), { calls }),
    });
    await p.complete({ ...baseRequest, ...req });
    return calls[0]!.body;
  }

  it('POSTs stream:false for complete()', async () => {
    expect(await bodyFor({})).toMatchObject({ model: 'llama3.2', stream: false });
  });

  it('rewrites the "ollama" model shorthand to the configured model', async () => {
    expect((await bodyFor({ model: 'ollama' })).model).toBe('llama3.2');
  });

  it('passes a concrete model id through untouched', async () => {
    expect((await bodyFor({ model: 'deepseek-r1:8b' })).model).toBe('deepseek-r1:8b');
  });

  it('prepends the system prompt as an ordinary system message', async () => {
    const body = await bodyFor({ systemPrompt: 'be terse' });
    expect(body.messages).toEqual([
      { role: 'system', content: 'be terse' },
      { role: 'user', content: 'hi' },
    ]);
  });

  it('maps maxTokens/temperature/stop into `options`', async () => {
    const body = await bodyFor({ maxTokens: 256, temperature: 0.2, stop: ['END'] });
    expect(body.options).toEqual({ num_predict: 256, temperature: 0.2, stop: ['END'] });
  });

  it('omits `options` entirely when there is nothing to say', async () => {
    expect(await bodyFor({})).not.toHaveProperty('options');
  });

  it('defaultMaxTokens applies when the request is silent', async () => {
    const body = await bodyFor({}, { defaultMaxTokens: 64 });
    expect(body.options).toEqual({ num_predict: 64 });
  });

  it('a request maxTokens beats defaultMaxTokens', async () => {
    const body = await bodyFor({ maxTokens: 8 }, { defaultMaxTokens: 64 });
    expect(body.options).toEqual({ num_predict: 8 });
  });

  it('serializes tools in Ollama shape', async () => {
    const body = await bodyFor({
      tools: [
        {
          name: 'weather',
          description: 'Current weather.',
          inputSchema: { type: 'object', properties: { city: { type: 'string' } } },
        },
      ],
    });
    expect(body.tools).toEqual([
      {
        type: 'function',
        function: {
          name: 'weather',
          description: 'Current weather.',
          parameters: { type: 'object', properties: { city: { type: 'string' } } },
        },
      },
    ]);
  });

  it('never sends tool_choice — the wire has no such field', async () => {
    const body = await bodyFor({
      tools: [{ name: 't', description: 'd', inputSchema: { type: 'object' } }],
      toolChoice: { type: 'tool', name: 't' },
    });
    expect(body).not.toHaveProperty('tool_choice');
  });

  it('sends `think` from the option, including a level', async () => {
    expect((await bodyFor({}, { think: true })).think).toBe(true);
    expect((await bodyFor({}, { think: 'high' })).think).toBe('high');
  });

  it('a per-request thinking budget turns think on (the wire has no budget)', async () => {
    const body = await bodyFor({ thinking: { budget: 2048 } });
    expect(body.think).toBe(true);
    expect(JSON.stringify(body)).not.toContain('2048');
  });

  it('the configured level wins over the request flag', async () => {
    const body = await bodyFor({ thinking: { budget: 1024 } }, { think: 'max' });
    expect(body.think).toBe('max');
  });

  it('omits `think` when nobody asked', async () => {
    expect(await bodyFor({})).not.toHaveProperty('think');
  });

  it('passes keepAlive as keep_alive', async () => {
    expect((await bodyFor({}, { keepAlive: '30m' })).keep_alive).toBe('30m');
  });
});

describe('OllamaProvider — unit: response mapping', () => {
  it('maps content, stop reason and REAL token counts', async () => {
    const p = ollama('llama3.2', { _fetch: fakeFetch(jsonResponse(okReply)) });
    const res = await p.complete(baseRequest);
    expect(res.content).toBe('hello');
    expect(res.stopReason).toBe('stop');
    expect(res.usage).toEqual({ input: 11, output: 3 });
  });

  it('maps done_reason "length" to max_tokens', async () => {
    const p = ollama('llama3.2', {
      _fetch: fakeFetch(jsonResponse({ ...okReply, done_reason: 'length' })),
    });
    expect((await p.complete(baseRequest)).stopReason).toBe('max_tokens');
  });

  it('reports tool_use when the turn ended in tool calls (Ollama still says "stop")', async () => {
    const p = ollama('llama3.2', {
      _fetch: fakeFetch(
        jsonResponse({
          ...okReply,
          message: {
            role: 'assistant',
            content: '',
            tool_calls: [{ function: { name: 'weather', arguments: { city: 'Tokyo' } } }],
          },
        }),
      ),
    });
    const res = await p.complete(baseRequest);
    expect(res.stopReason).toBe('tool_use');
    expect(res.toolCalls[0]).toMatchObject({ name: 'weather', args: { city: 'Tokyo' } });
  });

  it('takes tool-call arguments as the OBJECT they already are', async () => {
    const p = ollama('llama3.2', {
      _fetch: fakeFetch(
        jsonResponse({
          ...okReply,
          message: {
            role: 'assistant',
            content: '',
            tool_calls: [{ function: { name: 'sum', arguments: { a: 1, b: 2 } } }],
          },
        }),
      ),
    });
    expect((await p.complete(baseRequest)).toolCalls[0]!.args).toEqual({ a: 1, b: 2 });
  });

  it('still tolerates stringified arguments from a proxy in the middle', async () => {
    const p = ollama('llama3.2', {
      _fetch: fakeFetch(
        jsonResponse({
          ...okReply,
          message: {
            role: 'assistant',
            content: '',
            tool_calls: [{ function: { name: 'sum', arguments: '{"a":1}' } }],
          },
        }),
      ),
    });
    expect((await p.complete(baseRequest)).toolCalls[0]!.args).toEqual({ a: 1 });
  });

  it('malformed tool args surface as {} rather than crashing the run', async () => {
    const p = ollama('llama3.2', {
      _fetch: fakeFetch(
        jsonResponse({
          ...okReply,
          message: {
            role: 'assistant',
            content: '',
            tool_calls: [{ function: { name: 'sum', arguments: '{not json' } }],
          },
        }),
      ),
    });
    expect((await p.complete(baseRequest)).toolCalls[0]!.args).toEqual({});
  });

  it('synthesizes a tool-call id when the model emits none', async () => {
    const p = ollama('llama3.2', {
      _fetch: fakeFetch(
        jsonResponse({
          ...okReply,
          message: {
            role: 'assistant',
            content: '',
            tool_calls: [
              { function: { name: 'a', arguments: {} } },
              { function: { name: 'b', arguments: {} } },
            ],
          },
        }),
      ),
    });
    const ids = (await p.complete(baseRequest)).toolCalls.map((t) => t.id);
    expect(ids).toEqual(['ollama-call-1', 'ollama-call-2']);
    expect(new Set(ids).size).toBe(2);
  });

  it('keeps a real id when the model DID emit one', async () => {
    const p = ollama('llama3.2', {
      _fetch: fakeFetch(
        jsonResponse({
          ...okReply,
          message: {
            role: 'assistant',
            content: '',
            tool_calls: [{ id: 'call_abc', function: { name: 'a', arguments: {} } }],
          },
        }),
      ),
    });
    expect((await p.complete(baseRequest)).toolCalls[0]!.id).toBe('call_abc');
  });

  it('carries no providerRef — this wire returns no response id', async () => {
    const p = ollama('llama3.2', { _fetch: fakeFetch(jsonResponse(okReply)) });
    expect((await p.complete(baseRequest)).providerRef).toBeUndefined();
  });

  it('an empty message body degrades to empty content, not a throw', async () => {
    const p = ollama('llama3.2', { _fetch: fakeFetch(jsonResponse({ done: true })) });
    const res = await p.complete(baseRequest);
    expect(res.content).toBe('');
    expect(res.usage).toEqual({ input: 0, output: 0 });
  });
});

describe('OllamaProvider — unit: tool-result round trip', () => {
  it('sends tool results with tool_name — how this wire correlates them', async () => {
    const calls: WireCall[] = [];
    const p = ollama('llama3.2', { _fetch: fakeFetch(jsonResponse(okReply), { calls }) });
    await p.complete({
      model: 'llama3.2',
      messages: [
        { role: 'user', content: 'weather?' },
        {
          role: 'assistant',
          content: '',
          toolCalls: [{ id: 'ollama-call-1', name: 'weather', args: { city: 'Tokyo' } }],
        },
        { role: 'tool', content: '18C', toolCallId: 'ollama-call-1', toolName: 'weather' },
      ],
    });
    const messages = calls[0]!.body.messages as Array<Record<string, unknown>>;
    expect(messages[1]).toEqual({
      role: 'assistant',
      content: '',
      tool_calls: [
        { id: 'ollama-call-1', function: { name: 'weather', arguments: { city: 'Tokyo' } } },
      ],
    });
    expect(messages[2]).toEqual({
      role: 'tool',
      content: '18C',
      tool_name: 'weather',
      tool_call_id: 'ollama-call-1',
    });
  });

  it('recovers tool_name from the assistant turn when a hand-built history omits it', async () => {
    const calls: WireCall[] = [];
    const p = ollama('llama3.2', { _fetch: fakeFetch(jsonResponse(okReply), { calls }) });
    await p.complete({
      model: 'llama3.2',
      messages: [
        {
          role: 'assistant',
          content: '',
          toolCalls: [{ id: 'x1', name: 'weather', args: {} }],
        },
        { role: 'tool', content: '18C', toolCallId: 'x1' },
      ],
    });
    const messages = calls[0]!.body.messages as Array<Record<string, unknown>>;
    expect(messages[1]).toMatchObject({ role: 'tool', tool_name: 'weather' });
  });
});

// ════════════════════════════════════════════════════════════════════
// SCENARIO — streaming
// ════════════════════════════════════════════════════════════════════

describe('OllamaProvider — scenario: streaming', () => {
  const streamFrames = [
    { message: { role: 'assistant', content: 'Hel' }, done: false },
    { message: { role: 'assistant', content: 'lo' }, done: false },
    {
      message: { role: 'assistant', content: '' },
      done: true,
      done_reason: 'stop',
      prompt_eval_count: 7,
      eval_count: 2,
    },
  ];

  it('yields content deltas then a terminal chunk with the authoritative response', async () => {
    const p = ollama('llama3.2', { _fetch: fakeFetch(() => ndjsonResponse(streamFrames)) });
    const chunks = [];
    for await (const c of p.stream!(baseRequest)) chunks.push(c);

    expect(chunks.filter((c) => !c.done).map((c) => c.content)).toEqual(['Hel', 'lo']);
    const last = chunks.at(-1)!;
    expect(last.done).toBe(true);
    expect(last.response!.content).toBe('Hello');
    expect(last.response!.stopReason).toBe('stop');
  });

  it('REPORTS TOKEN COUNTS while streaming — the whole reason for the native wire', async () => {
    const p = ollama('llama3.2', { _fetch: fakeFetch(() => ndjsonResponse(streamFrames)) });
    const chunks = [];
    for await (const c of p.stream!(baseRequest)) chunks.push(c);
    // Zero here is what silently disarmed `.compaction()` and cost budgets
    // when this factory rode the OpenAI-compatible endpoint.
    expect(chunks.at(-1)!.response!.usage).toEqual({ input: 7, output: 2 });
  });

  it('POSTs stream:true', async () => {
    const calls: WireCall[] = [];
    const p = ollama('llama3.2', {
      _fetch: fakeFetch(() => ndjsonResponse(streamFrames), { calls }),
    });
    for await (const _c of p.stream!(baseRequest)) void _c;
    expect(calls[0]!.body.stream).toBe(true);
  });

  it('reassembles JSON split across transport chunk boundaries', async () => {
    // One byte at a time — the pathological case for a line-delimited parser.
    const p = ollama('llama3.2', {
      _fetch: fakeFetch(() => ndjsonResponse(streamFrames, { chunkSize: 1 })),
    });
    const chunks = [];
    for await (const c of p.stream!(baseRequest)) chunks.push(c);
    expect(chunks.at(-1)!.response!.content).toBe('Hello');
    expect(chunks.at(-1)!.response!.usage).toEqual({ input: 7, output: 2 });
  });

  it('tolerates a final frame with no trailing newline', async () => {
    const body = `${JSON.stringify(streamFrames[0])}\n${JSON.stringify(streamFrames[2])}`;
    const p = ollama('llama3.2', {
      _fetch: (() =>
        Promise.resolve(new Response(body, { status: 200 }))) as unknown as typeof fetch,
    });
    const chunks = [];
    for await (const c of p.stream!(baseRequest)) chunks.push(c);
    expect(chunks.at(-1)!.response!.usage).toEqual({ input: 7, output: 2 });
  });

  it('skips a malformed line instead of failing the stream', async () => {
    const body =
      `${JSON.stringify(streamFrames[0])}\n` + `{oops\n` + `${JSON.stringify(streamFrames[2])}\n`;
    const p = ollama('llama3.2', {
      _fetch: (() =>
        Promise.resolve(new Response(body, { status: 200 }))) as unknown as typeof fetch,
    });
    const chunks = [];
    for await (const c of p.stream!(baseRequest)) chunks.push(c);
    expect(chunks.at(-1)!.response!.content).toBe('Hel');
  });

  it('collects streamed tool calls, which arrive whole rather than as deltas', async () => {
    const frames = [
      {
        message: {
          role: 'assistant',
          content: '',
          tool_calls: [{ function: { name: 'weather', arguments: { city: 'Oslo' } } }],
        },
        done: false,
      },
      { message: { role: 'assistant', content: '' }, done: true, done_reason: 'stop' },
    ];
    const p = ollama('llama3.2', { _fetch: fakeFetch(() => ndjsonResponse(frames)) });
    const chunks = [];
    for await (const c of p.stream!(baseRequest)) chunks.push(c);
    const res = chunks.at(-1)!.response!;
    expect(res.stopReason).toBe('tool_use');
    expect(res.toolCalls).toEqual([
      { id: 'ollama-call-1', name: 'weather', args: { city: 'Oslo' } },
    ]);
  });
});

// ════════════════════════════════════════════════════════════════════
// INTEGRATION — the two refusals
// ════════════════════════════════════════════════════════════════════

describe('OllamaProvider — integration: refusals name the fix', () => {
  const refused = (() => Promise.reject(new TypeError('fetch failed'))) as unknown as typeof fetch;

  it('daemon down → typed error naming the address and `ollama serve`', async () => {
    const p = ollama('llama3.2', { _fetch: refused });
    await expect(p.complete(baseRequest)).rejects.toThrow(OllamaUnavailableError);
    await expect(p.complete(baseRequest)).rejects.toThrow(/http:\/\/localhost:11434/);
    await expect(p.complete(baseRequest)).rejects.toThrow(/ollama serve/);
  });

  it('the daemon-down error is never a raw ECONNREFUSED', async () => {
    const econn = Object.assign(new TypeError('fetch failed'), {
      cause: Object.assign(new Error('connect ECONNREFUSED 127.0.0.1:11434'), {
        code: 'ECONNREFUSED',
      }),
    });
    const p = ollama('llama3.2', {
      _fetch: (() => Promise.reject(econn)) as unknown as typeof fetch,
    });
    const err = await p.complete(baseRequest).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(OllamaUnavailableError);
    expect((err as OllamaUnavailableError).reason).toBe('daemon-unreachable');
    expect((err as Error).message).not.toMatch(/ECONNREFUSED/);
    // The original is preserved for anyone who wants it — just not in the face.
    expect((err as OllamaUnavailableError).cause).toBe(econn);
  });

  it('names the baseUrl it actually tried, not the default', async () => {
    const p = ollama('llama3.2', { baseUrl: 'http://10.1.2.3:9999', _fetch: refused });
    await expect(p.complete(baseRequest)).rejects.toThrow(/http:\/\/10\.1\.2\.3:9999/);
  });

  it('refuses instead of hanging when nothing ever answers', async () => {
    const neverAnswers = (() => new Promise<Response>(() => {})) as unknown as typeof fetch;
    const p = ollama('llama3.2', { timeoutMs: 20, _fetch: neverAnswers });
    const err = await p.complete(baseRequest).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(OllamaUnavailableError);
    expect((err as OllamaUnavailableError).reason).toBe('daemon-unreachable');
  });

  it('the timeout bounds the ANSWER, not generation — a slow model is fine', async () => {
    // Headers arrive fast; the body then takes longer than timeoutMs. A long
    // local generation must not be killed by the daemon-liveness timer.
    const slowBody = new ReadableStream<Uint8Array>({
      start(controller) {
        setTimeout(() => {
          controller.enqueue(new TextEncoder().encode(`${JSON.stringify(okReply)}\n`));
          controller.close();
        }, 60);
      },
    });
    const p = ollama('llama3.2', {
      timeoutMs: 20,
      _fetch: (() => Promise.resolve(new Response(slowBody, { status: 200 }))) as never,
    });
    const chunks = [];
    for await (const c of p.stream!(baseRequest)) chunks.push(c);
    expect(chunks.at(-1)!.response!.usage).toEqual({ input: 11, output: 3 });
  });

  it("a caller's own abort is re-thrown as an abort, not blamed on the daemon", async () => {
    const controller = new AbortController();
    const abortError = Object.assign(new Error('This operation was aborted'), {
      name: 'AbortError',
    });
    const p = ollama('llama3.2', {
      _fetch: ((_u: unknown, init?: RequestInit) => {
        controller.abort();
        void init;
        return Promise.reject(abortError);
      }) as unknown as typeof fetch,
    });
    const err = await p.complete({ ...baseRequest, signal: controller.signal }).catch((e) => e);
    expect(err).not.toBeInstanceOf(OllamaUnavailableError);
    expect((err as Error).name).toBe('AbortError');
  });

  it('model not pulled → typed error naming `ollama pull <model>` and what IS here', async () => {
    const p = ollama('qwen3', {
      _fetch: fakeFetch(jsonResponse({ error: "model 'qwen3' not found" }, 404), {
        tags: jsonResponse({ models: [{ name: 'llama3.2:latest' }, { name: 'deepseek-r1:8b' }] }),
      }),
    });
    const err = await p.complete({ ...baseRequest, model: 'qwen3' }).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(OllamaUnavailableError);
    const typed = err as OllamaUnavailableError;
    expect(typed.reason).toBe('model-not-pulled');
    expect(typed.model).toBe('qwen3');
    expect(typed.availableModels).toEqual(['llama3.2:latest', 'deepseek-r1:8b']);
    expect(typed.message).toContain('ollama pull qwen3');
    expect(typed.message).toContain('llama3.2:latest');
  });

  it('still says `ollama pull` when the model listing itself fails', async () => {
    const p = ollama('qwen3', {
      _fetch: fakeFetch(jsonResponse({ error: 'not found' }, 404)), // no tags stub → rejects
    });
    const err = await p.complete({ ...baseRequest, model: 'qwen3' }).catch((e: unknown) => e);
    expect((err as OllamaUnavailableError).reason).toBe('model-not-pulled');
    expect((err as Error).message).toContain('ollama pull qwen3');
    expect((err as OllamaUnavailableError).availableModels).toBeUndefined();
  });

  it('any other status becomes a labelled provider error carrying the wire text', async () => {
    const p = ollama('llama3.2', {
      _fetch: fakeFetch(jsonResponse({ error: 'model requires more system memory' }, 500)),
    });
    const err = await p.complete(baseRequest).catch((e: unknown) => e);
    expect((err as Error).name).toBe('OllamaProviderError');
    expect((err as Error).message).toContain('[ollama]');
    expect((err as Error).message).toContain('500');
    expect((err as Error).message).toContain('more system memory');
    expect((err as { status?: number }).status).toBe(500);
  });

  it('refuses on the streaming path too', async () => {
    const p = ollama('llama3.2', { _fetch: refused });
    await expect(async () => {
      for await (const _c of p.stream!(baseRequest)) void _c;
    }).rejects.toThrow(OllamaUnavailableError);
  });
});

// ════════════════════════════════════════════════════════════════════
// PROPERTY
// ════════════════════════════════════════════════════════════════════

describe('OllamaProvider — property: laws that hold for any input', () => {
  it('every request carries a model and a messages array', async () => {
    const inputs: LLMRequest[] = [
      { model: 'ollama', messages: [] },
      { model: 'a:b', messages: [{ role: 'user', content: '' }] },
      { model: 'x', messages: [{ role: 'assistant', content: 'hi' }], systemPrompt: 's' },
    ];
    for (const req of inputs) {
      const calls: WireCall[] = [];
      const p = ollama('llama3.2', { _fetch: fakeFetch(jsonResponse(okReply), { calls }) });
      await p.complete(req);
      expect(typeof calls[0]!.body.model).toBe('string');
      expect((calls[0]!.body.model as string).length).toBeGreaterThan(0);
      expect(Array.isArray(calls[0]!.body.messages)).toBe(true);
    }
  });

  it('usage is always a pair of numbers, whatever the daemon reports', async () => {
    const bodies = [
      okReply,
      { ...okReply, prompt_eval_count: undefined, eval_count: undefined },
      { message: { role: 'assistant', content: 'x' }, done: true },
      {},
    ];
    for (const body of bodies) {
      const p = ollama('llama3.2', { _fetch: fakeFetch(jsonResponse(body)) });
      const res = await p.complete(baseRequest);
      expect(Number.isFinite(res.usage.input)).toBe(true);
      expect(Number.isFinite(res.usage.output)).toBe(true);
    }
  });

  it('complete() and stream() agree on content, usage and tool calls', async () => {
    const toolFrame = {
      message: {
        role: 'assistant',
        content: 'Hello',
        tool_calls: [{ function: { name: 'weather', arguments: { city: 'Oslo' } } }],
      },
      done: true,
      done_reason: 'stop',
      prompt_eval_count: 7,
      eval_count: 2,
    };
    const completed = await ollama('llama3.2', {
      _fetch: fakeFetch(jsonResponse(toolFrame)),
    }).complete(baseRequest);

    const streamed = ollama('llama3.2', { _fetch: fakeFetch(() => ndjsonResponse([toolFrame])) });
    const chunks = [];
    for await (const c of streamed.stream!(baseRequest)) chunks.push(c);
    const streamedResponse = chunks.at(-1)!.response!;

    expect(streamedResponse.content).toBe(completed.content);
    expect(streamedResponse.usage).toEqual(completed.usage);
    expect(streamedResponse.stopReason).toBe(completed.stopReason);
    expect(streamedResponse.toolCalls).toEqual(completed.toolCalls);
  });

  it('the provider holds no per-call state — two calls, same answer', async () => {
    // A fresh Response per call: a body can only be read once.
    const p = ollama('llama3.2', { _fetch: fakeFetch(() => jsonResponse(okReply)) });
    const a = await p.complete(baseRequest);
    const b = await p.complete(baseRequest);
    expect(b.content).toBe(a.content);
    expect(b.usage).toEqual(a.usage);
  });
});

// ════════════════════════════════════════════════════════════════════
// SECURITY
// ════════════════════════════════════════════════════════════════════

describe('OllamaProvider — security', () => {
  it('an error message never repeats the conversation back', async () => {
    const p = ollama('llama3.2', {
      _fetch: fakeFetch(jsonResponse({ error: 'boom' }, 500)),
    });
    const err = await p
      .complete({
        model: 'llama3.2',
        systemPrompt: 'SSN 123-45-6789',
        messages: [{ role: 'user', content: 'my password is hunter2' }],
      })
      .catch((e: unknown) => e);
    expect((err as Error).message).not.toContain('hunter2');
    expect((err as Error).message).not.toContain('123-45-6789');
  });

  it('the not-pulled error names models, never their contents', async () => {
    const p = ollama('qwen3', {
      _fetch: fakeFetch(jsonResponse({ error: 'nope' }, 404), {
        tags: jsonResponse({ models: [{ name: 'llama3.2' }] }),
      }),
    });
    const err = await p
      .complete({ model: 'qwen3', messages: [{ role: 'user', content: 'secret-payload' }] })
      .catch((e: unknown) => e);
    expect((err as Error).message).not.toContain('secret-payload');
  });

  it('the wire body is capped when a server returns something enormous', async () => {
    const p = ollama('llama3.2', {
      _fetch: (() => Promise.resolve(new Response('x'.repeat(50_000), { status: 500 }))) as never,
    });
    const err = await p.complete(baseRequest).catch((e: unknown) => e);
    expect((err as Error).message.length).toBeLessThan(500);
  });

  it('a `role` the port does not define is dropped, not forwarded blindly', async () => {
    const calls: WireCall[] = [];
    const p = ollama('llama3.2', { _fetch: fakeFetch(jsonResponse(okReply), { calls }) });
    await p.complete({
      model: 'llama3.2',
      messages: [
        { role: 'user', content: 'a' },
        { role: 'root' as never, content: 'sudo' },
      ],
    });
    const messages = calls[0]!.body.messages as Array<{ role: string }>;
    expect(messages.map((m) => m.role)).toEqual(['user']);
  });
});

// ════════════════════════════════════════════════════════════════════
// PERFORMANCE
// ════════════════════════════════════════════════════════════════════

describe('OllamaProvider — performance', () => {
  it('body assembly scales linearly with history length', async () => {
    const p = ollama('llama3.2', { _fetch: fakeFetch(() => jsonResponse(okReply)) });
    const callWith = async (n: number) => {
      const messages = Array.from({ length: n }, (_v, i) => ({
        role: 'user' as const,
        content: `m${i}`,
      }));
      await p.complete({ model: 'llama3.2', messages });
    };
    await expectScalesLinearly({
      small: () => callWith(20),
      large: () => callWith(200),
      scale: 10,
      why: 'message serialization must stay linear in history length',
    });
  });

  it('constructing a provider opens no connection', () => {
    const spy = vi.fn();
    ollama('llama3.2', { _fetch: spy as unknown as typeof fetch });
    expect(spy).not.toHaveBeenCalled();
  });
});

// ════════════════════════════════════════════════════════════════════
// ROI — the class form and the ladder's middle rung
// ════════════════════════════════════════════════════════════════════

describe('OllamaProvider — ROI', () => {
  it('the class form behaves like the factory', async () => {
    const p = new OllamaProvider('llama3.2', { _fetch: fakeFetch(jsonResponse(okReply)) });
    expect(p.name).toBe('ollama');
    expect(p.carriesForcedToolChoice).toBe(false);
    expect((await p.complete(baseRequest)).content).toBe('hello');
  });

  it('the class form accepts the object form too', async () => {
    const p = new OllamaProvider({ defaultModel: 'x', _fetch: fakeFetch(jsonResponse(okReply)) });
    expect((await p.complete(baseRequest)).content).toBe('hello');
  });

  it('needs no vendor SDK — nothing is required beyond fetch', async () => {
    // The point of the rung: no `openai` package, no key, no network setup.
    // A bare global fetch stub is the entire dependency surface.
    const p = ollama('llama3.2', { _fetch: fakeFetch(jsonResponse(okReply)) });
    expect((await p.complete(baseRequest)).content).toBe('hello');
  });
});
