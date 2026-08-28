/**
 * FoundryLocalProvider — 7-pattern tests
 * (unit · scenario · integration · property · security · performance · ROI).
 *
 * Factory under test: `foundryLocal()`. The ONE design fact: an on-device
 * Foundry Local service is talked to over fetch alone — dynamic-port
 * endpoint resolution, alias→variant-id catalog resolution (cached), SSE
 * streaming that keeps the usage riding the final EMPTY-choices chunk,
 * and typed refusals whose messages contain the fix (`foundry server
 * start` / `foundry model run`), never a secret and never the wire's raw
 * failure text uncapped.
 *
 * Uses an injected fake `_fetch` instead of a real service, so the whole
 * file runs offline with nothing installed.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  foundryLocal,
  FoundryLocalProvider,
  FoundryLocalUnavailableError,
} from '../../../src/adapters/llm/FoundryLocalProvider.js';
import type { LLMRequest } from '../../../src/adapters/types.js';
import { expectScalesLinearly } from '../../helpers/perf.js';

// ─── Env hygiene ───────────────────────────────────────────────────
// Every endpoint-resolution path reads these two; a developer machine
// that has them set must not bend any test. Saved+deleted before each,
// restored after — tests that SET one rely on the afterEach to clean up.

const ENV_KEYS = ['FOUNDRY_LOCAL_ENDPOINT', 'FOUNDRY_LOCAL_BASE_URL'] as const;
let savedEnv: Partial<Record<(typeof ENV_KEYS)[number], string | undefined>> = {};

beforeEach(() => {
  savedEnv = {};
  for (const key of ENV_KEYS) {
    savedEnv[key] = process.env[key];
    delete process.env[key];
  }
});

afterEach(() => {
  for (const key of ENV_KEYS) {
    const prev = savedEnv[key];
    if (prev === undefined) delete process.env[key];
    else process.env[key] = prev;
  }
});

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

/**
 * SSE body — `data: {...}` frames separated by blank lines, closed with
 * `data: [DONE]`, exactly like /v1/chat/completions streaming.
 */
function sseResponse(
  frames: readonly unknown[],
  opts: { chunkSize?: number; done?: boolean } = {},
): Response {
  const lines = frames.map((f) => `data: ${JSON.stringify(f)}\n\n`).join('');
  const text = opts.done === false ? lines : `${lines}data: [DONE]\n\n`;
  return sseRaw(text, opts.chunkSize);
}

/** SSE body from raw text — for malformed-line and after-[DONE] cases. */
function sseRaw(text: string, chunkSize?: number): Response {
  const bytes = new TextEncoder().encode(text);
  const size = chunkSize ?? bytes.length;
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      for (let i = 0; i < bytes.length; i += size) {
        controller.enqueue(bytes.slice(i, i + size));
      }
      controller.close();
    },
  });
  return new Response(stream, { status: 200, headers: { 'content-type': 'text/event-stream' } });
}

/**
 * An SSE response the test drives itself: the frames are queued but the body
 * is never closed, and `cancelled()` reports whether anything ever closed it.
 * The shape a real generation has while the model is still writing.
 */
function pushableSse(frames: readonly unknown[]): {
  response: Response;
  cancelled: () => boolean;
} {
  let cancelled = false;
  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      for (const frame of frames) {
        controller.enqueue(encoder.encode(`data: ${JSON.stringify(frame)}\n\n`));
      }
      // deliberately NOT closed — the model is still generating
    },
    cancel() {
      cancelled = true;
    },
  });
  return {
    response: new Response(stream, {
      status: 200,
      headers: { 'content-type': 'text/event-stream' },
    }),
    cancelled: () => cancelled,
  };
}

/**
 * Fake fetch that answers /v1/chat/completions with `chat`,
 * /foundry/list with `catalog` and /openai/models with `models`,
 * recording every call it saw.
 */
function fakeFetch(
  chat: Response | (() => Response | Promise<Response>),
  opts: {
    calls?: WireCall[];
    catalog?: Response | (() => Response);
    models?: Response | (() => Response);
  } = {},
): typeof fetch {
  return ((url: RequestInfo | URL, init?: RequestInit) => {
    const href = String(url);
    if (opts.calls) {
      let body: Record<string, unknown> = {};
      if (typeof init?.body === 'string') body = JSON.parse(init.body) as Record<string, unknown>;
      opts.calls.push({ url: href, init, body });
    }
    if (href.endsWith('/foundry/list')) {
      if (!opts.catalog) return Promise.reject(new Error('no catalog stub'));
      return Promise.resolve(typeof opts.catalog === 'function' ? opts.catalog() : opts.catalog);
    }
    if (href.endsWith('/openai/models')) {
      if (!opts.models) return Promise.reject(new Error('no models stub'));
      return Promise.resolve(typeof opts.models === 'function' ? opts.models() : opts.models);
    }
    return Promise.resolve(typeof chat === 'function' ? chat() : chat);
  }) as typeof fetch;
}

/** A FULL variant id — the execution-provider suffix skips the catalog. */
const DIRECT_ID = 'qwen2.5-0.5b-instruct-generic-cpu:1';
/** The catalog alias for the same model family. */
const ALIAS = 'qwen2.5-0.5b';

const okReply = {
  id: 'chatcmpl-foundry-1',
  object: 'chat.completion',
  choices: [
    { index: 0, message: { role: 'assistant', content: 'hello' }, finish_reason: 'stop' },
  ],
  usage: { prompt_tokens: 11, completion_tokens: 3 },
};

const catalogReply = [
  // First entry with the alias WINS — /foundry/list order is priority order.
  { alias: ALIAS, name: 'qwen2.5-0.5b-instruct-generic-gpu:1' },
  { alias: ALIAS, name: DIRECT_ID },
  { alias: 'phi-3.5-mini', name: 'phi-3.5-mini-instruct-generic-cpu:1' },
];

const baseRequest: LLMRequest = {
  messages: [{ role: 'user', content: 'hi' }],
  model: DIRECT_ID,
};

// ════════════════════════════════════════════════════════════════════
// UNIT
// ════════════════════════════════════════════════════════════════════

describe('FoundryLocalProvider — unit: identity and capabilities', () => {
  it('is named "foundry-local"', () => {
    expect(foundryLocal(DIRECT_ID).name).toBe('foundry-local');
  });

  it('carries all three roles inside messages', () => {
    expect(foundryLocal(DIRECT_ID).carriesInMessages).toEqual(['system', 'user', 'assistant']);
  });

  it('does NOT carry forced tool choice — tool_choice is undocumented on this wire', () => {
    expect(foundryLocal(DIRECT_ID).carriesForcedToolChoice).toBe(false);
  });

  it('exposes stream()', () => {
    expect(typeof foundryLocal(DIRECT_ID).stream).toBe('function');
  });

  it('needs no API key and no SDK to construct', () => {
    expect(() => foundryLocal(DIRECT_ID)).not.toThrow();
    expect(() => foundryLocal()).not.toThrow();
  });
});

describe('FoundryLocalProvider — unit: endpoint resolution', () => {
  async function urlFor(options: Record<string, unknown> = {}) {
    const calls: WireCall[] = [];
    const p = foundryLocal(DIRECT_ID, {
      ...options,
      _fetch: fakeFetch(jsonResponse(okReply), { calls }),
    });
    await p.complete(baseRequest);
    return calls[0]!.url;
  }

  it("defaults to the docs' example port — http://localhost:5272/v1/chat/completions", async () => {
    expect(await urlFor()).toBe('http://localhost:5272/v1/chat/completions');
  });

  it('accepts endpoint', async () => {
    expect(await urlFor({ endpoint: 'http://10.0.0.4:5272' })).toBe(
      'http://10.0.0.4:5272/v1/chat/completions',
    );
  });

  it('adds a scheme to a bare host:port', async () => {
    expect(await urlFor({ endpoint: '10.0.0.4:5272' })).toBe(
      'http://10.0.0.4:5272/v1/chat/completions',
    );
  });

  it('trims a trailing slash', async () => {
    expect(await urlFor({ endpoint: 'http://localhost:5272/' })).toBe(
      'http://localhost:5272/v1/chat/completions',
    );
  });

  it('trims a /v1 suffix — a URL copied from `foundry server status` means the same machine', async () => {
    expect(await urlFor({ endpoint: 'http://localhost:5272/v1' })).toBe(
      'http://localhost:5272/v1/chat/completions',
    );
  });

  it('honors FOUNDRY_LOCAL_ENDPOINT when nothing was passed', async () => {
    process.env.FOUNDRY_LOCAL_ENDPOINT = 'http://192.168.1.9:59152';
    expect(await urlFor()).toBe('http://192.168.1.9:59152/v1/chat/completions');
  });

  it('honors FOUNDRY_LOCAL_BASE_URL — the spelling our own demo taught', async () => {
    process.env.FOUNDRY_LOCAL_BASE_URL = 'http://192.168.1.9:5272';
    expect(await urlFor()).toBe('http://192.168.1.9:5272/v1/chat/completions');
  });

  it('FOUNDRY_LOCAL_ENDPOINT beats FOUNDRY_LOCAL_BASE_URL', async () => {
    process.env.FOUNDRY_LOCAL_ENDPOINT = 'http://first:1111';
    process.env.FOUNDRY_LOCAL_BASE_URL = 'http://second:2222';
    expect(await urlFor()).toBe('http://first:1111/v1/chat/completions');
  });

  it('an explicit endpoint beats the env', async () => {
    process.env.FOUNDRY_LOCAL_ENDPOINT = 'http://192.168.1.9:59152';
    expect(await urlFor({ endpoint: 'http://localhost:1234' })).toBe(
      'http://localhost:1234/v1/chat/completions',
    );
  });

  it("a duck-typed manager's urls[0] beats the env — the manager knows the REAL dynamic port", async () => {
    process.env.FOUNDRY_LOCAL_ENDPOINT = 'http://stale:5272';
    expect(await urlFor({ manager: { urls: ['http://127.0.0.1:59152/'] } })).toBe(
      'http://127.0.0.1:59152/v1/chat/completions',
    );
  });

  it('an explicit endpoint beats the manager — the most specific word wins', async () => {
    expect(
      await urlFor({
        endpoint: 'http://localhost:1234',
        manager: { urls: ['http://127.0.0.1:59152'] },
      }),
    ).toBe('http://localhost:1234/v1/chat/completions');
  });

  // A key present with an EMPTY value is a config that forgot to fill it in
  // (`ENV FOUNDRY_LOCAL_ENDPOINT=` in a Dockerfile, a blank compose value).
  // Read as an endpoint it becomes the URL `http:`, and the refusal then
  // names nothing anyone can check or fix.
  it('a BLANK endpoint env counts as unset — it never becomes the URL http:', async () => {
    process.env.FOUNDRY_LOCAL_ENDPOINT = '';
    expect(await urlFor()).toBe('http://localhost:5272/v1/chat/completions');
  });

  it('a whitespace-only endpoint env counts as unset too', async () => {
    process.env.FOUNDRY_LOCAL_ENDPOINT = '   ';
    expect(await urlFor()).toBe('http://localhost:5272/v1/chat/completions');
  });

  it('a blank value never masks the next candidate — the base-url spelling still wins', async () => {
    process.env.FOUNDRY_LOCAL_ENDPOINT = '';
    process.env.FOUNDRY_LOCAL_BASE_URL = 'http://192.168.1.9:5272';
    expect(await urlFor()).toBe('http://192.168.1.9:5272/v1/chat/completions');
  });

  it('a blank explicit endpoint and a blank manager url both fall through', async () => {
    process.env.FOUNDRY_LOCAL_ENDPOINT = 'http://192.168.1.9:59152';
    expect(await urlFor({ endpoint: '', manager: { urls: [''] } })).toBe(
      'http://192.168.1.9:59152/v1/chat/completions',
    );
  });
});

describe('FoundryLocalProvider — unit: model resolution', () => {
  it('a full variant id is used as-is — NO catalog call', async () => {
    const calls: WireCall[] = [];
    const p = foundryLocal(DIRECT_ID, { _fetch: fakeFetch(jsonResponse(okReply), { calls }) });
    await p.complete(baseRequest);
    expect(calls.map((c) => c.url)).toEqual(['http://localhost:5272/v1/chat/completions']);
    expect(calls[0]!.body.model).toBe(DIRECT_ID);
  });

  it('an alias resolves via /foundry/list — FIRST matching variant wins (priority order)', async () => {
    const calls: WireCall[] = [];
    const p = foundryLocal(ALIAS, {
      _fetch: fakeFetch(jsonResponse(okReply), { calls, catalog: jsonResponse(catalogReply) }),
    });
    await p.complete({ ...baseRequest, model: ALIAS });
    expect(calls[0]!.url).toContain('/foundry/list');
    expect(calls[1]!.body.model).toBe('qwen2.5-0.5b-instruct-generic-gpu:1');
  });

  it('the resolution is cached per instance — two calls, exactly ONE catalog fetch', async () => {
    const calls: WireCall[] = [];
    const p = foundryLocal(ALIAS, {
      _fetch: fakeFetch(() => jsonResponse(okReply), {
        calls,
        catalog: jsonResponse(catalogReply),
      }),
    });
    await p.complete({ ...baseRequest, model: ALIAS });
    await p.complete({ ...baseRequest, model: ALIAS });
    expect(calls.filter((c) => c.url.endsWith('/foundry/list'))).toHaveLength(1);
    expect(calls.filter((c) => c.url.endsWith('/v1/chat/completions'))).toHaveLength(2);
  });

  it('tolerates a { models: [...] } catalog wrapper', async () => {
    const calls: WireCall[] = [];
    const p = foundryLocal(ALIAS, {
      _fetch: fakeFetch(jsonResponse(okReply), {
        calls,
        catalog: jsonResponse({ models: catalogReply }),
      }),
    });
    await p.complete({ ...baseRequest, model: ALIAS });
    expect(calls.at(-1)!.body.model).toBe('qwen2.5-0.5b-instruct-generic-gpu:1');
  });

  it("a silent catalog resolves to the name as-is — the chat call's own 404 then reports honestly", async () => {
    const calls: WireCall[] = [];
    const p = foundryLocal(ALIAS, {
      // no catalog stub → the /foundry/list fetch rejects
      _fetch: fakeFetch(jsonResponse(okReply), { calls }),
    });
    await p.complete({ ...baseRequest, model: ALIAS });
    expect(calls.at(-1)!.body.model).toBe(ALIAS);
  });

  it('a catalog MISS is cached exactly like a hit — ONE attempt per provider, not one per call', async () => {
    // The alias is not in the catalog, so the name is used as-is. Without
    // caching that fallback, every complete()/stream() re-asks /foundry/list
    // for the life of the provider — and against a host that accepts but
    // never answers, each call pays a whole timeoutMs before the chat POST.
    const calls: WireCall[] = [];
    const p = foundryLocal(ALIAS, {
      _fetch: fakeFetch(() => jsonResponse(okReply), {
        calls,
        catalog: () => jsonResponse({ models: [] }),
      }),
    });
    await p.complete({ ...baseRequest, model: ALIAS });
    await p.complete({ ...baseRequest, model: ALIAS });
    for await (const _c of p.stream!({ ...baseRequest, model: ALIAS })) void _c;

    expect(calls.filter((c) => c.url.endsWith('/foundry/list'))).toHaveLength(1);
    expect(calls.filter((c) => c.url.endsWith('/v1/chat/completions'))).toHaveLength(3);
    // Still the honest fallback: the name the caller actually wrote.
    expect(calls.at(-1)!.body.model).toBe(ALIAS);
  });

  it('a silent catalog is one attempt too — and a FRESH provider is the retry', async () => {
    const calls: WireCall[] = [];
    // no catalog stub → the /foundry/list fetch rejects, every time
    const p = foundryLocal(ALIAS, { _fetch: fakeFetch(() => jsonResponse(okReply), { calls }) });
    await p.complete({ ...baseRequest, model: ALIAS });
    await p.complete({ ...baseRequest, model: ALIAS });
    expect(calls.filter((c) => c.url.endsWith('/foundry/list'))).toHaveLength(1);

    // The model was pulled meanwhile: a NEW provider asks again and resolves.
    const fresh = foundryLocal(ALIAS, {
      _fetch: fakeFetch(() => jsonResponse(okReply), {
        calls,
        catalog: jsonResponse(catalogReply),
      }),
    });
    await fresh.complete({ ...baseRequest, model: ALIAS });
    expect(calls.filter((c) => c.url.endsWith('/foundry/list'))).toHaveLength(2);
    expect(calls.at(-1)!.body.model).toBe('qwen2.5-0.5b-instruct-generic-gpu:1');
  });

  it('a 404 catalog is one attempt as well — a proxy forwarding only /v1 stays cheap', async () => {
    const calls: WireCall[] = [];
    const p = foundryLocal(ALIAS, {
      _fetch: fakeFetch(() => jsonResponse(okReply), {
        calls,
        catalog: () => jsonResponse({ error: 'no such route' }, 404),
      }),
    });
    await p.complete({ ...baseRequest, model: ALIAS });
    await p.complete({ ...baseRequest, model: ALIAS });
    expect(calls.filter((c) => c.url.endsWith('/foundry/list'))).toHaveLength(1);
  });

  it('rewrites the "foundry-local" model shorthand to the configured model', async () => {
    const calls: WireCall[] = [];
    const p = foundryLocal(DIRECT_ID, { _fetch: fakeFetch(jsonResponse(okReply), { calls }) });
    await p.complete({ ...baseRequest, model: 'foundry-local' });
    expect(calls[0]!.body.model).toBe(DIRECT_ID);
  });
});

describe('FoundryLocalProvider — unit: request body', () => {
  async function bodyFor(req: Partial<LLMRequest>, options: Record<string, unknown> = {}) {
    const calls: WireCall[] = [];
    const p = foundryLocal(DIRECT_ID, {
      ...options,
      _fetch: fakeFetch(jsonResponse(okReply), { calls }),
    });
    await p.complete({ ...baseRequest, ...req });
    return calls[0]!.body;
  }

  it('POSTs stream:false with NO stream_options for complete()', async () => {
    const body = await bodyFor({});
    expect(body).toMatchObject({ model: DIRECT_ID, stream: false });
    expect(body).not.toHaveProperty('stream_options');
  });

  it('prepends the system prompt as an ordinary system message', async () => {
    const body = await bodyFor({ systemPrompt: 'be terse' });
    expect(body.messages).toEqual([
      { role: 'system', content: 'be terse' },
      { role: 'user', content: 'hi' },
    ]);
  });

  it('maps maxTokens/temperature/stop onto the wire', async () => {
    const body = await bodyFor({ maxTokens: 256, temperature: 0.2, stop: ['END'] });
    expect(body.max_tokens).toBe(256);
    expect(body.temperature).toBe(0.2);
    expect(body.stop).toEqual(['END']);
  });

  it('omits the caps entirely when there is nothing to say', async () => {
    const body = await bodyFor({});
    expect(body).not.toHaveProperty('max_tokens');
    expect(body).not.toHaveProperty('temperature');
    expect(body).not.toHaveProperty('stop');
  });

  it('defaultMaxTokens applies when the request is silent; a request maxTokens beats it', async () => {
    expect((await bodyFor({}, { defaultMaxTokens: 64 })).max_tokens).toBe(64);
    expect((await bodyFor({ maxTokens: 8 }, { defaultMaxTokens: 64 })).max_tokens).toBe(8);
  });

  it('serializes tools in the OpenAI shape', async () => {
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

  it('never sends tool_choice — support is undocumented and the port refuses upstream', async () => {
    const body = await bodyFor({
      tools: [{ name: 't', description: 'd', inputSchema: { type: 'object' } }],
      toolChoice: { type: 'tool', name: 't' },
    });
    expect(body).not.toHaveProperty('tool_choice');
  });

  it('round-trips tool calls: assistant arguments as a JSON STRING, results by tool_call_id', async () => {
    const calls: WireCall[] = [];
    const p = foundryLocal(DIRECT_ID, { _fetch: fakeFetch(jsonResponse(okReply), { calls }) });
    await p.complete({
      model: DIRECT_ID,
      messages: [
        { role: 'user', content: 'weather?' },
        {
          role: 'assistant',
          content: '',
          toolCalls: [{ id: 'call_1', name: 'weather', args: { city: 'Tokyo' } }],
        },
        { role: 'tool', content: '18C', toolCallId: 'call_1', toolName: 'weather' },
      ],
    });
    const messages = calls[0]!.body.messages as Array<Record<string, unknown>>;
    expect(messages[1]).toEqual({
      role: 'assistant',
      content: '',
      tool_calls: [
        { id: 'call_1', type: 'function', function: { name: 'weather', arguments: '{"city":"Tokyo"}' } },
      ],
    });
    expect(messages[2]).toEqual({ role: 'tool', content: '18C', tool_call_id: 'call_1' });
  });
});

describe('FoundryLocalProvider — unit: response mapping', () => {
  it('maps content, stop reason and usage from prompt/completion tokens', async () => {
    const p = foundryLocal(DIRECT_ID, { _fetch: fakeFetch(jsonResponse(okReply)) });
    const res = await p.complete(baseRequest);
    expect(res.content).toBe('hello');
    expect(res.stopReason).toBe('stop');
    expect(res.usage).toEqual({ input: 11, output: 3 });
  });

  it('maps finish_reason "length" to max_tokens', async () => {
    const p = foundryLocal(DIRECT_ID, {
      _fetch: fakeFetch(
        jsonResponse({
          ...okReply,
          choices: [{ message: { role: 'assistant', content: 'x' }, finish_reason: 'length' }],
        }),
      ),
    });
    expect((await p.complete(baseRequest)).stopReason).toBe('max_tokens');
  });

  const toolCallsChoice = (finishReason: string) => ({
    ...okReply,
    choices: [
      {
        message: {
          role: 'assistant',
          content: '',
          tool_calls: [
            { id: 'call_9', function: { name: 'weather', arguments: '{"city":"Tokyo"}' } },
          ],
        },
        finish_reason: finishReason,
      },
    ],
  });

  it('maps finish_reason "tool_calls" to tool_use and parses the argument string', async () => {
    const p = foundryLocal(DIRECT_ID, { _fetch: fakeFetch(jsonResponse(toolCallsChoice('tool_calls'))) });
    const res = await p.complete(baseRequest);
    expect(res.stopReason).toBe('tool_use');
    expect(res.toolCalls[0]).toMatchObject({ id: 'call_9', name: 'weather', args: { city: 'Tokyo' } });
  });

  it('reports tool_use even when the model said "stop" with tool calls attached', async () => {
    const p = foundryLocal(DIRECT_ID, { _fetch: fakeFetch(jsonResponse(toolCallsChoice('stop'))) });
    expect((await p.complete(baseRequest)).stopReason).toBe('tool_use');
  });

  it('still tolerates OBJECT arguments from a proxy in the middle', async () => {
    const p = foundryLocal(DIRECT_ID, {
      _fetch: fakeFetch(
        jsonResponse({
          ...okReply,
          choices: [
            {
              message: {
                role: 'assistant',
                content: '',
                tool_calls: [{ id: 'c1', function: { name: 'sum', arguments: { a: 1 } } }],
              },
              finish_reason: 'tool_calls',
            },
          ],
        }),
      ),
    });
    expect((await p.complete(baseRequest)).toolCalls[0]!.args).toEqual({ a: 1 });
  });

  it('malformed tool args surface as {} rather than crashing the run', async () => {
    const p = foundryLocal(DIRECT_ID, {
      _fetch: fakeFetch(
        jsonResponse({
          ...okReply,
          choices: [
            {
              message: {
                role: 'assistant',
                content: '',
                tool_calls: [{ id: 'c1', function: { name: 'sum', arguments: '{not json' } }],
              },
              finish_reason: 'tool_calls',
            },
          ],
        }),
      ),
    });
    expect((await p.complete(baseRequest)).toolCalls[0]!.args).toEqual({});
  });

  it('synthesizes a tool-call id when a small model emits none', async () => {
    const p = foundryLocal(DIRECT_ID, {
      _fetch: fakeFetch(
        jsonResponse({
          ...okReply,
          choices: [
            {
              message: {
                role: 'assistant',
                content: '',
                tool_calls: [
                  { function: { name: 'a', arguments: '{}' } },
                  { function: { name: 'b', arguments: '{}' } },
                ],
              },
              finish_reason: 'tool_calls',
            },
          ],
        }),
      ),
    });
    const ids = (await p.complete(baseRequest)).toolCalls.map((t) => t.id);
    expect(ids).toEqual(['foundry-call-1', 'foundry-call-2']);
  });

  it('an empty choices array degrades to empty content and zero usage, not a throw', async () => {
    const p = foundryLocal(DIRECT_ID, { _fetch: fakeFetch(jsonResponse({ choices: [] })) });
    const res = await p.complete(baseRequest);
    expect(res.content).toBe('');
    expect(res.usage).toEqual({ input: 0, output: 0 });
  });
});

// ════════════════════════════════════════════════════════════════════
// SCENARIO — streaming
// ════════════════════════════════════════════════════════════════════

describe('FoundryLocalProvider — scenario: streaming', () => {
  const streamFrames = [
    { id: 'chatcmpl-s1', choices: [{ delta: { content: 'Hel' } }] },
    { choices: [{ delta: { content: 'lo' } }] },
    { choices: [{ delta: {}, finish_reason: 'stop' }] },
    // The counts ride a FINAL chunk whose choices array is EMPTY.
    { choices: [], usage: { prompt_tokens: 7, completion_tokens: 2 } },
  ];

  it('yields content deltas then a terminal chunk with the authoritative response', async () => {
    const p = foundryLocal(DIRECT_ID, { _fetch: fakeFetch(() => sseResponse(streamFrames)) });
    const chunks = [];
    for await (const c of p.stream!(baseRequest)) chunks.push(c);

    expect(chunks.filter((c) => !c.done).map((c) => c.content)).toEqual(['Hel', 'lo']);
    const last = chunks.at(-1)!;
    expect(last.done).toBe(true);
    expect(last.response!.content).toBe('Hello');
    expect(last.response!.stopReason).toBe('stop');
  });

  it('READS USAGE OFF THE FINAL EMPTY-CHOICES CHUNK — the exact bug class 9.73.0 fixed', async () => {
    const p = foundryLocal(DIRECT_ID, { _fetch: fakeFetch(() => sseResponse(streamFrames)) });
    const chunks = [];
    for await (const c of p.stream!(baseRequest)) chunks.push(c);
    // A `continue` on the missing choice would throw these away, and every
    // streamed local call would read zero tokens everywhere usage is consumed.
    expect(chunks.at(-1)!.response!.usage).toEqual({ input: 7, output: 2 });
  });

  it('POSTs stream:true with stream_options asking for that usage', async () => {
    const calls: WireCall[] = [];
    const p = foundryLocal(DIRECT_ID, {
      _fetch: fakeFetch(() => sseResponse(streamFrames), { calls }),
    });
    for await (const _c of p.stream!(baseRequest)) void _c;
    expect(calls[0]!.body.stream).toBe(true);
    expect(calls[0]!.body.stream_options).toEqual({ include_usage: true });
  });

  it('reassembles SSE frames split across transport chunk boundaries', async () => {
    // One byte at a time — the pathological case for a line-buffered parser.
    const p = foundryLocal(DIRECT_ID, {
      _fetch: fakeFetch(() => sseResponse(streamFrames, { chunkSize: 1 })),
    });
    const chunks = [];
    for await (const c of p.stream!(baseRequest)) chunks.push(c);
    expect(chunks.at(-1)!.response!.content).toBe('Hello');
    expect(chunks.at(-1)!.response!.usage).toEqual({ input: 7, output: 2 });
  });

  it('stops at [DONE] — frames a broken server writes afterwards never arrive', async () => {
    const text =
      `data: ${JSON.stringify(streamFrames[0])}\n\n` +
      `data: ${JSON.stringify(streamFrames[3])}\n\n` +
      `data: [DONE]\n\n` +
      `data: ${JSON.stringify({ choices: [{ delta: { content: 'POISON' } }] })}\n\n`;
    const p = foundryLocal(DIRECT_ID, { _fetch: (() => Promise.resolve(sseRaw(text))) as never });
    const chunks = [];
    for await (const c of p.stream!(baseRequest)) chunks.push(c);
    expect(chunks.at(-1)!.response!.content).toBe('Hel');
    expect(chunks.at(-1)!.response!.content).not.toContain('POISON');
  });

  it('skips a malformed data line instead of failing the stream', async () => {
    const text =
      `data: ${JSON.stringify(streamFrames[0])}\n\n` +
      `data: {oops\n\n` +
      `data: ${JSON.stringify(streamFrames[3])}\n\n` +
      `data: [DONE]\n\n`;
    const p = foundryLocal(DIRECT_ID, { _fetch: (() => Promise.resolve(sseRaw(text))) as never });
    const chunks = [];
    for await (const c of p.stream!(baseRequest)) chunks.push(c);
    expect(chunks.at(-1)!.response!.content).toBe('Hel');
    expect(chunks.at(-1)!.response!.usage).toEqual({ input: 7, output: 2 });
  });

  it('accumulates tool_call deltas by index — id and name first, argument JSON in fragments', async () => {
    const frames = [
      {
        choices: [
          {
            delta: {
              tool_calls: [
                { index: 0, id: 'call_9', function: { name: 'weather', arguments: '{"ci' } },
              ],
            },
          },
        ],
      },
      { choices: [{ delta: { tool_calls: [{ index: 0, function: { arguments: 'ty":"Oslo"}' } }] } }] },
      { choices: [{ delta: {}, finish_reason: 'tool_calls' }] },
      { choices: [], usage: { prompt_tokens: 5, completion_tokens: 9 } },
    ];
    const p = foundryLocal(DIRECT_ID, { _fetch: fakeFetch(() => sseResponse(frames)) });
    const chunks = [];
    for await (const c of p.stream!(baseRequest)) chunks.push(c);
    const res = chunks.at(-1)!.response!;
    expect(res.stopReason).toBe('tool_use');
    expect(res.toolCalls).toEqual([{ id: 'call_9', name: 'weather', args: { city: 'Oslo' } }]);
    expect(res.usage).toEqual({ input: 5, output: 9 });
  });

  it('tool calls come back in INDEX order even when the wire opens index 1 first', async () => {
    // Map insertion order is FIRST-SEEN order. A consumer reading
    // toolCalls[0] as "the first tool the model asked for" would name B.
    const frames = [
      {
        choices: [
          {
            delta: {
              tool_calls: [{ index: 1, id: 'call_b', function: { name: 'B', arguments: '{}' } }],
            },
          },
        ],
      },
      {
        choices: [
          {
            delta: {
              tool_calls: [{ index: 0, id: 'call_a', function: { name: 'A', arguments: '{}' } }],
            },
          },
        ],
      },
      { choices: [{ delta: {}, finish_reason: 'tool_calls' }] },
    ];
    const p = foundryLocal(DIRECT_ID, { _fetch: fakeFetch(() => sseResponse(frames)) });
    const chunks = [];
    for await (const c of p.stream!(baseRequest)) chunks.push(c);
    expect(chunks.at(-1)!.response!.toolCalls.map((t) => t.name)).toEqual(['A', 'B']);
    expect(chunks.at(-1)!.response!.toolCalls.map((t) => t.id)).toEqual(['call_a', 'call_b']);
  });

  it('a consumer that BREAKS out cancels the body — the model does not keep generating', async () => {
    const wire = pushableSse([
      { choices: [{ delta: { content: 'a' } }] },
      { choices: [{ delta: { content: 'b' } }] },
      { choices: [{ delta: { content: 'c' } }] },
    ]);
    const p = foundryLocal(DIRECT_ID, { _fetch: (() => Promise.resolve(wire.response)) as never });
    const seen: string[] = [];
    for await (const c of p.stream!(baseRequest)) {
      if (!c.done) seen.push(c.content);
      if (seen.length === 1) break;
    }
    expect(seen).toEqual(['a']);
    // releaseLock() alone leaves the socket open and the generation running.
    expect(wire.cancelled()).toBe(true);
  });
});

// ════════════════════════════════════════════════════════════════════
// SCENARIO — a failed generation is never a clean stop
// ════════════════════════════════════════════════════════════════════

describe('FoundryLocalProvider — scenario: an in-band failure on an already-200 stream', () => {
  async function drain(p: ReturnType<typeof foundryLocal>) {
    const seen: Array<{ done: boolean; content: string }> = [];
    let error: unknown;
    try {
      for await (const c of p.stream!(baseRequest)) seen.push({ done: c.done, content: c.content });
    } catch (e) {
      error = e;
    }
    return { seen, error };
  }

  it('RAISES a data: error frame instead of reporting a truncated answer as a clean stop', async () => {
    const frames = [
      { id: '1', choices: [{ delta: { content: 'par' } }] },
      { error: { message: 'model failed to load: out of memory', code: 'model_error' } },
    ];
    const p = foundryLocal(DIRECT_ID, { _fetch: fakeFetch(() => sseResponse(frames)) });
    const { seen, error } = await drain(p);

    expect((error as Error).name).toBe('FoundryLocalProviderError');
    expect((error as Error).message).toContain('out of memory');
    // The decisive half: NO terminal chunk, so nothing downstream can read
    // 'par' as a finished answer with stopReason 'stop' and zero tokens.
    expect(seen.some((c) => c.done)).toBe(false);
    expect(seen.map((c) => c.content)).toEqual(['par']);
  });

  it('RAISES the event: error spelling too — the frame name is not dropped', async () => {
    const text =
      `data: ${JSON.stringify({ choices: [{ delta: { content: 'par' } }] })}\n\n` +
      'event: error\n' +
      'data: {"message":"CUDA out of memory"}\n\n';
    const p = foundryLocal(DIRECT_ID, { _fetch: (() => Promise.resolve(sseRaw(text))) as never });
    const { seen, error } = await drain(p);
    expect((error as Error).name).toBe('FoundryLocalProviderError');
    expect((error as Error).message).toContain('CUDA out of memory');
    expect(seen.some((c) => c.done)).toBe(false);
  });

  it('an error frame that names no reason still refuses rather than stopping cleanly', async () => {
    const p = foundryLocal(DIRECT_ID, {
      _fetch: fakeFetch(() => sseResponse([{ error: { code: 'model_error' } }])),
    });
    const { seen, error } = await drain(p);
    expect((error as Error).name).toBe('FoundryLocalProviderError');
    expect(seen.some((c) => c.done)).toBe(false);
  });

  it('the reason is capped — a poisoned error frame never becomes the message', async () => {
    const frames = [{ error: { message: `${'x'.repeat(50_000)}sk-foundry-DO-NOT-LEAK-7b2a` } }];
    const p = foundryLocal(DIRECT_ID, { _fetch: fakeFetch(() => sseResponse(frames)) });
    const { error } = await drain(p);
    expect((error as Error).message.length).toBeLessThan(400);
    expect((error as Error).message).not.toContain('sk-foundry-DO-NOT-LEAK-7b2a');
  });

  it('an ordinary usage-only frame is still NOT an error — the guard is narrow', async () => {
    const p = foundryLocal(DIRECT_ID, {
      _fetch: fakeFetch(() =>
        sseResponse([
          { choices: [{ delta: { content: 'ok' }, finish_reason: 'stop' }] },
          { choices: [], usage: { prompt_tokens: 4, completion_tokens: 1 } },
        ]),
      ),
    });
    const { seen, error } = await drain(p);
    expect(error).toBeUndefined();
    expect(seen.at(-1)!.done).toBe(true);
  });

  it('complete() refuses a 200 body that is really an error, instead of an empty answer', async () => {
    const p = foundryLocal(DIRECT_ID, {
      _fetch: fakeFetch(jsonResponse({ error: { message: 'model failed to load' } })),
    });
    const err = await p.complete(baseRequest).catch((e: unknown) => e);
    expect((err as Error).name).toBe('FoundryLocalProviderError');
    expect((err as Error).message).toContain('model failed to load');
  });
});

// ════════════════════════════════════════════════════════════════════
// SCENARIO — cancellation reaches the WHOLE call
// ════════════════════════════════════════════════════════════════════

describe('FoundryLocalProvider — scenario: the caller can actually cancel', () => {
  it('a signal already aborted at call time sends NOTHING — not even the catalog lookup', async () => {
    const calls: WireCall[] = [];
    const ac = new AbortController();
    ac.abort();
    const p = foundryLocal(ALIAS, {
      _fetch: fakeFetch(() => jsonResponse(okReply), {
        calls,
        catalog: jsonResponse(catalogReply),
      }),
    });
    const err = await p
      .complete({ ...baseRequest, model: ALIAS, signal: ac.signal })
      .catch((e: unknown) => e);

    // An already-aborted signal never dispatches another 'abort' event, so a
    // listener alone cannot hear it: the POST used to go out on a cancelled
    // turn and the local model ran to completion for nobody.
    expect(calls).toHaveLength(0);
    expect((err as Error).name).toBe('AbortError');
    expect(err).not.toBeInstanceOf(FoundryLocalUnavailableError);
  });

  it('stream() refuses a pre-aborted signal the same way', async () => {
    const calls: WireCall[] = [];
    const ac = new AbortController();
    ac.abort();
    const p = foundryLocal(DIRECT_ID, {
      _fetch: fakeFetch(() => sseResponse([{ choices: [{ delta: { content: 'x' } }] }]), { calls }),
    });
    let error: unknown;
    try {
      for await (const _c of p.stream!({ ...baseRequest, signal: ac.signal })) void _c;
    } catch (e) {
      error = e;
    }
    expect(calls).toHaveLength(0);
    expect((error as Error).name).toBe('AbortError');
  });

  it('an abort DURING generation stops the stream and cancels the body', async () => {
    const wire = pushableSse([
      { choices: [{ delta: { content: 'a' } }] },
      { choices: [{ delta: { content: 'b' } }] },
      { choices: [{ delta: { content: 'c' } }] },
      { choices: [{ delta: { content: 'd' } }] },
    ]);
    const ac = new AbortController();
    const p = foundryLocal(DIRECT_ID, { _fetch: (() => Promise.resolve(wire.response)) as never });
    const seen: string[] = [];
    let error: unknown;
    try {
      for await (const c of p.stream!({ ...baseRequest, signal: ac.signal })) {
        if (!c.done) seen.push(c.content);
        if (seen.length === 2) ac.abort();
      }
    } catch (e) {
      error = e;
    }

    // The bridge used to be removed the moment headers arrived, so an abort
    // raised during generation reached nothing at all.
    expect(seen).toEqual(['a', 'b']);
    expect((error as Error).name).toBe('AbortError');
    expect(wire.cancelled()).toBe(true);
  });

  it('an abort during the BODY READ is honored by complete(), not waited out', async () => {
    const urls: string[] = [];
    const ac = new AbortController();
    const p = foundryLocal(DIRECT_ID, {
      _fetch: ((url: RequestInfo | URL) => {
        urls.push(String(url));
        // Headers arrive; the body never does — a big answer still being read.
        return Promise.resolve({
          ok: true,
          status: 200,
          json: () => new Promise<never>(() => {}),
        } as unknown as Response);
      }) as unknown as typeof fetch,
    });
    const pending = p.complete({ ...baseRequest, signal: ac.signal });
    await new Promise((resolve) => setTimeout(resolve, 10));
    ac.abort();
    const err = await pending.catch((e: unknown) => e);

    expect(urls).toHaveLength(1); // we really did get past the headers
    expect((err as Error).name).toBe('AbortError');
    expect(err).not.toBeInstanceOf(FoundryLocalUnavailableError);
  });

  it('a call with NO signal is unaffected — the whole guard is opt-in', async () => {
    const p = foundryLocal(DIRECT_ID, { _fetch: fakeFetch(jsonResponse(okReply)) });
    expect((await p.complete(baseRequest)).content).toBe('hello');
  });
});

// ════════════════════════════════════════════════════════════════════
// INTEGRATION — the two refusals
// ════════════════════════════════════════════════════════════════════

describe('FoundryLocalProvider — integration: refusals name the fix', () => {
  const refused = (() => Promise.reject(new TypeError('fetch failed'))) as unknown as typeof fetch;

  it('service down → typed error naming the endpoint, `foundry server start` AND the discovery command', async () => {
    const p = foundryLocal(DIRECT_ID, { _fetch: refused });
    await expect(p.complete(baseRequest)).rejects.toThrow(FoundryLocalUnavailableError);
    await expect(p.complete(baseRequest)).rejects.toThrow(/http:\/\/localhost:5272/);
    await expect(p.complete(baseRequest)).rejects.toThrow(/foundry server start/);
    // The port is dynamic, so the message must also teach discovery.
    await expect(p.complete(baseRequest)).rejects.toThrow(/foundry server status/);
    await expect(p.complete(baseRequest)).rejects.toThrow(/FOUNDRY_LOCAL_ENDPOINT/);
  });

  it('the service-down error is never a raw ECONNREFUSED — cause preserved, not echoed', async () => {
    const econn = Object.assign(new TypeError('fetch failed'), {
      cause: Object.assign(new Error('connect ECONNREFUSED 127.0.0.1:5272'), {
        code: 'ECONNREFUSED',
      }),
    });
    const p = foundryLocal(DIRECT_ID, {
      _fetch: (() => Promise.reject(econn)) as unknown as typeof fetch,
    });
    const err = await p.complete(baseRequest).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(FoundryLocalUnavailableError);
    expect((err as FoundryLocalUnavailableError).reason).toBe('service-unreachable');
    expect((err as Error).message).not.toMatch(/ECONNREFUSED/);
    // The original is preserved for anyone who wants it — just not in the face.
    expect((err as FoundryLocalUnavailableError).cause).toBe(econn);
  });

  it('names the endpoint it actually tried, not the default', async () => {
    const p = foundryLocal(DIRECT_ID, { endpoint: 'http://10.1.2.3:9999', _fetch: refused });
    await expect(p.complete(baseRequest)).rejects.toThrow(/http:\/\/10\.1\.2\.3:9999/);
  });

  it('refuses instead of hanging when nothing ever answers', async () => {
    const neverAnswers = (() => new Promise<Response>(() => {})) as unknown as typeof fetch;
    const p = foundryLocal(DIRECT_ID, { timeoutMs: 20, _fetch: neverAnswers });
    const err = await p.complete(baseRequest).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(FoundryLocalUnavailableError);
    expect((err as FoundryLocalUnavailableError).reason).toBe('service-unreachable');
  });

  it('an ALIAS config refuses too — the catalog lookup is bounded by the same deadline', async () => {
    // The alias path fetches /foundry/list before chat. A fetch that never
    // settles must not hang there either: the bounded lookup gives up, the
    // chat POST then refuses on its own deadline.
    const neverAnswers = (() => new Promise<Response>(() => {})) as unknown as typeof fetch;
    const p = foundryLocal(ALIAS, { timeoutMs: 20, _fetch: neverAnswers });
    const err = await p.complete({ ...baseRequest, model: ALIAS }).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(FoundryLocalUnavailableError);
    expect((err as FoundryLocalUnavailableError).reason).toBe('service-unreachable');
  });

  it('the timeout bounds the ANSWER, not generation — a slow model is fine', async () => {
    // Headers arrive fast; the body then takes longer than timeoutMs. A long
    // local generation must not be killed by the liveness timer.
    const text =
      `data: ${JSON.stringify({ choices: [{ delta: { content: 'ok' }, finish_reason: 'stop' }] })}\n\n` +
      `data: ${JSON.stringify({ choices: [], usage: { prompt_tokens: 11, completion_tokens: 3 } })}\n\n` +
      `data: [DONE]\n\n`;
    const bytes = new TextEncoder().encode(text);
    const slowBody = new ReadableStream<Uint8Array>({
      start(controller) {
        setTimeout(() => {
          controller.enqueue(bytes);
          controller.close();
        }, 60);
      },
    });
    const p = foundryLocal(DIRECT_ID, {
      timeoutMs: 20,
      _fetch: (() => Promise.resolve(new Response(slowBody, { status: 200 }))) as never,
    });
    const chunks = [];
    for await (const c of p.stream!(baseRequest)) chunks.push(c);
    expect(chunks.at(-1)!.response!.usage).toEqual({ input: 11, output: 3 });
  });

  it("a caller's own abort is re-thrown as an abort, not blamed on the service", async () => {
    const controller = new AbortController();
    const abortError = Object.assign(new Error('This operation was aborted'), {
      name: 'AbortError',
    });
    const p = foundryLocal(DIRECT_ID, {
      _fetch: ((_u: unknown, init?: RequestInit) => {
        controller.abort();
        void init;
        return Promise.reject(abortError);
      }) as unknown as typeof fetch,
    });
    const err = await p.complete({ ...baseRequest, signal: controller.signal }).catch((e) => e);
    expect(err).not.toBeInstanceOf(FoundryLocalUnavailableError);
    expect((err as Error).name).toBe('AbortError');
  });

  it('404 → typed error naming `foundry model run` and what IS cached here', async () => {
    const p = foundryLocal(DIRECT_ID, {
      _fetch: fakeFetch(jsonResponse({ error: { message: 'model not found' } }, 404), {
        models: jsonResponse(['phi-3.5-mini-instruct-generic-cpu', DIRECT_ID.replace('qwen', 'other')]),
      }),
    });
    const err = await p.complete(baseRequest).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(FoundryLocalUnavailableError);
    const typed = err as FoundryLocalUnavailableError;
    expect(typed.reason).toBe('model-not-available');
    expect(typed.model).toBe(DIRECT_ID);
    expect(typed.availableModels).toEqual([
      'phi-3.5-mini-instruct-generic-cpu',
      DIRECT_ID.replace('qwen', 'other'),
    ]);
    expect(typed.message).toContain(`foundry model run ${DIRECT_ID}`);
    expect(typed.message).toContain('phi-3.5-mini-instruct-generic-cpu');
  });

  it('still says `foundry model run` when the models listing itself fails', async () => {
    const p = foundryLocal(DIRECT_ID, {
      _fetch: fakeFetch(jsonResponse({ error: { message: 'not found' } }, 404)), // no models stub → rejects
    });
    const err = await p.complete(baseRequest).catch((e: unknown) => e);
    expect((err as FoundryLocalUnavailableError).reason).toBe('model-not-available');
    expect((err as Error).message).toContain(`foundry model run ${DIRECT_ID}`);
    expect((err as FoundryLocalUnavailableError).availableModels).toBeUndefined();
  });

  it('any other status becomes a labelled provider error carrying capped wire text', async () => {
    const p = foundryLocal(DIRECT_ID, {
      _fetch: fakeFetch(jsonResponse({ error: { message: 'model requires more system memory' } }, 500)),
    });
    const err = await p.complete(baseRequest).catch((e: unknown) => e);
    expect((err as Error).name).toBe('FoundryLocalProviderError');
    expect((err as Error).message).toContain('[foundry-local]');
    expect((err as Error).message).toContain('500');
    expect((err as Error).message).toContain('more system memory');
    expect((err as { status?: number }).status).toBe(500);
  });

  it('a 404 that did NOT speak the dialect names the endpoint as a suspect too', async () => {
    // Pointing at something that is not Foundry Local's chat route (an Ollama
    // port, a proxy) 404s with a body that is not the dialect's error shape.
    // Saying `foundry model run` for a model the user may already have — and
    // nothing else — is a confident instruction for the wrong fault.
    const p = foundryLocal(DIRECT_ID, {
      endpoint: 'http://localhost:11434',
      _fetch: fakeFetch(new Response('404 page not found', { status: 404 })),
    });
    const err = await p.complete(baseRequest).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(FoundryLocalUnavailableError);
    expect((err as FoundryLocalUnavailableError).reason).toBe('model-not-available');
    expect((err as Error).message).toContain(`foundry model run ${DIRECT_ID}`);
    expect((err as Error).message).toContain('http://localhost:11434');
    expect((err as Error).message).toContain('foundry server status');
  });

  it('a 404 that DID speak the dialect keeps the single, confident model answer', async () => {
    const p = foundryLocal(DIRECT_ID, {
      _fetch: fakeFetch(jsonResponse({ error: { message: 'model not found' } }, 404)),
    });
    const err = await p.complete(baseRequest).catch((e: unknown) => e);
    expect((err as Error).message).toContain(`foundry model run ${DIRECT_ID}`);
    expect((err as Error).message).not.toContain('foundry server status');
  });

  it('refuses on the streaming path too', async () => {
    const p = foundryLocal(DIRECT_ID, { _fetch: refused });
    await expect(async () => {
      for await (const _c of p.stream!(baseRequest)) void _c;
    }).rejects.toThrow(FoundryLocalUnavailableError);
  });
});

// ════════════════════════════════════════════════════════════════════
// PROPERTY
// ════════════════════════════════════════════════════════════════════

describe('FoundryLocalProvider — property: laws that hold for any input', () => {
  it('complete() and stream() agree on content, usage, stop reason and tool calls', async () => {
    const completed = await foundryLocal(DIRECT_ID, {
      _fetch: fakeFetch(
        jsonResponse({
          id: 'chatcmpl-x',
          choices: [
            {
              message: {
                role: 'assistant',
                content: 'Hello',
                tool_calls: [
                  { id: 'call_1', function: { name: 'weather', arguments: '{"city":"Oslo"}' } },
                ],
              },
              finish_reason: 'tool_calls',
            },
          ],
          usage: { prompt_tokens: 7, completion_tokens: 2 },
        }),
      ),
    }).complete(baseRequest);

    const frames = [
      {
        choices: [
          {
            delta: {
              content: 'Hello',
              tool_calls: [
                { index: 0, id: 'call_1', function: { name: 'weather', arguments: '{"city":"Oslo"}' } },
              ],
            },
          },
        ],
      },
      { choices: [{ delta: {}, finish_reason: 'tool_calls' }] },
      { choices: [], usage: { prompt_tokens: 7, completion_tokens: 2 } },
    ];
    const streamed = foundryLocal(DIRECT_ID, { _fetch: fakeFetch(() => sseResponse(frames)) });
    const chunks = [];
    for await (const c of streamed.stream!(baseRequest)) chunks.push(c);
    const streamedResponse = chunks.at(-1)!.response!;

    expect(streamedResponse.content).toBe(completed.content);
    expect(streamedResponse.usage).toEqual(completed.usage);
    expect(streamedResponse.stopReason).toBe(completed.stopReason);
    expect(streamedResponse.toolCalls).toEqual(completed.toolCalls);
  });

  it('usage is always a pair of finite numbers, whatever the service reports', async () => {
    const bodies = [
      okReply,
      { ...okReply, usage: undefined },
      { choices: [{ message: { role: 'assistant', content: 'x' } }] },
      {},
    ];
    for (const body of bodies) {
      const p = foundryLocal(DIRECT_ID, { _fetch: fakeFetch(jsonResponse(body)) });
      const res = await p.complete(baseRequest);
      expect(Number.isFinite(res.usage.input)).toBe(true);
      expect(Number.isFinite(res.usage.output)).toBe(true);
    }
  });

  it('the provider holds no per-call state — two calls, same answer', async () => {
    // A fresh Response per call: a body can only be read once.
    const p = foundryLocal(DIRECT_ID, { _fetch: fakeFetch(() => jsonResponse(okReply)) });
    const a = await p.complete(baseRequest);
    const b = await p.complete(baseRequest);
    expect(b.content).toBe(a.content);
    expect(b.usage).toEqual(a.usage);
  });
});

// ════════════════════════════════════════════════════════════════════
// SECURITY
// ════════════════════════════════════════════════════════════════════

describe('FoundryLocalProvider — security', () => {
  it('sends no Authorization header EVER — no key exists on this wire', async () => {
    const calls: WireCall[] = [];
    const p = foundryLocal(DIRECT_ID, { _fetch: fakeFetch(jsonResponse(okReply), { calls }) });
    await p.complete(baseRequest);
    const headers = calls[0]!.init!.headers as Record<string, string>;
    expect(Object.keys(headers).map((k) => k.toLowerCase())).toEqual(['content-type']);
  });

  it('an error message never repeats the conversation back', async () => {
    const p = foundryLocal(DIRECT_ID, {
      _fetch: fakeFetch(jsonResponse({ error: { message: 'boom' } }, 500)),
    });
    const err = await p
      .complete({
        model: DIRECT_ID,
        systemPrompt: 'the token is sk-foundry-DO-NOT-LEAK-7b2a',
        messages: [{ role: 'user', content: 'my password is hunter2' }],
      })
      .catch((e: unknown) => e);
    expect((err as Error).message).not.toContain('hunter2');
    expect((err as Error).message).not.toContain('sk-foundry-DO-NOT-LEAK-7b2a');
  });

  it('a poisoned 50KB error body is capped — the payload never becomes the message', async () => {
    const poisoned = `${'x'.repeat(50_000)}sk-foundry-DO-NOT-LEAK-7b2a`;
    const p = foundryLocal(DIRECT_ID, {
      _fetch: (() => Promise.resolve(new Response(poisoned, { status: 500 }))) as never,
    });
    const err = await p.complete(baseRequest).catch((e: unknown) => e);
    expect((err as Error).message.length).toBeLessThan(500);
    expect((err as Error).message).not.toContain('sk-foundry-DO-NOT-LEAK-7b2a');
  });

  it('a `role` the port does not define is dropped, not forwarded blindly', async () => {
    const calls: WireCall[] = [];
    const p = foundryLocal(DIRECT_ID, { _fetch: fakeFetch(jsonResponse(okReply), { calls }) });
    await p.complete({
      model: DIRECT_ID,
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

describe('FoundryLocalProvider — performance', () => {
  it('body assembly scales linearly with history length', async () => {
    const p = foundryLocal(DIRECT_ID, { _fetch: fakeFetch(() => jsonResponse(okReply)) });
    const callWith = async (n: number) => {
      const messages = Array.from({ length: n }, (_v, i) => ({
        role: 'user' as const,
        content: `m${i}`,
      }));
      await p.complete({ model: DIRECT_ID, messages });
    };
    await expectScalesLinearly({
      small: () => callWith(20),
      large: () => callWith(200),
      scale: 10,
      why: 'message serialization must stay linear in history length',
    });
  });
});

// ════════════════════════════════════════════════════════════════════
// ROI — nothing to install, nothing opened early
// ════════════════════════════════════════════════════════════════════

describe('FoundryLocalProvider — ROI', () => {
  it('construction opens no socket — the first fetch happens on the first call', () => {
    const spy = vi.fn();
    foundryLocal(DIRECT_ID, { _fetch: spy as unknown as typeof fetch });
    expect(spy).not.toHaveBeenCalled();
  });

  it('the class form behaves like the factory', async () => {
    const p = new FoundryLocalProvider(DIRECT_ID, { _fetch: fakeFetch(jsonResponse(okReply)) });
    expect(p.name).toBe('foundry-local');
    expect(p.carriesForcedToolChoice).toBe(false);
    expect((await p.complete(baseRequest)).content).toBe('hello');
  });

  it('the class form accepts the object form too', async () => {
    const p = new FoundryLocalProvider({
      defaultModel: DIRECT_ID,
      _fetch: fakeFetch(jsonResponse(okReply)),
    });
    expect((await p.complete(baseRequest)).content).toBe('hello');
  });

  it('needs no vendor SDK — a bare fetch stub is the entire dependency surface', async () => {
    // The point of the rung: no `foundry-local-sdk`, no key, no network setup.
    const p = foundryLocal(DIRECT_ID, { _fetch: fakeFetch(jsonResponse(okReply)) });
    expect((await p.complete(baseRequest)).content).toBe('hello');
  });
});
