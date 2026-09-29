/**
 * invokeModelGateway — Anthropic models behind a gateway that speaks the
 * Bedrock InvokeModel wire with an API-key header.
 *
 * Every test drives the adapter through a SCRIPTED fetch: nothing leaves the
 * process. The scripts are the wire as a field deployment recorded it —
 * `data:` lines without `event:` names, the terminal chunk carrying the
 * response, tool arguments arriving as `input_json_delta` fragments.
 *
 * Test types (Convention 3): unit (request, response, stream, keys, errors) ·
 * scenario (an Agent tool loop over the adapter) · property (a seeded
 * generator re-chunks the stream at arbitrary byte boundaries; no fast-check
 * in the tree) · contract (withRetry composes on the typed status and never
 * repeats a refusal raised before a request or a 2xx it could not read).
 */
import { describe, it, expect } from 'vitest';
import {
  invokeModelGateway,
  InvokeModelGatewayError,
  InvokeModelGatewayProvider,
  INVOKE_MODEL_ANTHROPIC_VERSION,
  type InvokeModelGatewayFetch,
} from '../../../src/adapters/llm/InvokeModelGatewayProvider.js';
import { createProvider } from '../../../src/adapters/llm/createProvider.js';
import { ContextWindowExceededError } from '../../../src/adapters/llm/contextWindow.js';
import { withRetry } from '../../../src/resilience/withRetry.js';
import { Agent, defineTool } from '../../../src/index.js';
import type { LLMChunk, LLMRequest } from '../../../src/adapters/types.js';

// ─── The scripted gateway ───────────────────────────────────────────

interface Seen {
  readonly url: string;
  readonly headers: Record<string, string>;
  readonly body: Record<string, unknown>;
}

type Reply = () => Response;

/** A fetch that records each request and answers from a queue of replies. */
function scriptedFetch(replies: Reply[], seen: Seen[]): InvokeModelGatewayFetch {
  return async (input, init) => {
    seen.push({
      url: String(input),
      headers: { ...(init?.headers as Record<string, string>) },
      body: JSON.parse(String(init?.body)) as Record<string, unknown>,
    });
    const next = replies.shift();
    if (!next) throw new Error('script ran out of replies');
    return next();
  };
}

const json =
  (value: unknown, status = 200, headers: Record<string, string> = {}): Reply =>
  () =>
    new Response(JSON.stringify(value), {
      status,
      headers: { 'content-type': 'application/json', ...headers },
    });

const text =
  (body: string, status: number, headers: Record<string, string> = {}): Reply =>
  () =>
    new Response(body, { status, headers });

/** An SSE reply delivered in the given pieces (strings, or raw byte slices). */
const sse =
  (pieces: readonly (string | Uint8Array)[]): Reply =>
  () => {
    const encoder = new TextEncoder();
    return new Response(
      new ReadableStream<Uint8Array>({
        start(controller) {
          for (const piece of pieces) {
            controller.enqueue(typeof piece === 'string' ? encoder.encode(piece) : piece);
          }
          controller.close();
        },
      }),
      { status: 200, headers: { 'content-type': 'text/event-stream' } },
    );
  };

/** Bare `data:` lines — the framing the gateway sends. */
const dataLines = (events: readonly unknown[]): string =>
  events.map((e) => `data: ${JSON.stringify(e)}\n\n`).join('');

const HAIKU = 'us.anthropic.claude-haiku-4-5-20251001-v1:0';
const SONNET = 'us.anthropic.claude-sonnet-4-6';
const BASE = 'https://llm-gateway.example.test/bedrock/';

function gateway(
  seen: Seen[],
  replies: Reply[],
  extra: Partial<Parameters<typeof invokeModelGateway>[0]> = {},
) {
  return invokeModelGateway({
    baseUrl: BASE,
    apiKeyHeader: 'api-key',
    apiKey: 'key-one',
    model: HAIKU,
    fetch: scriptedFetch(replies, seen),
    ...extra,
  });
}

const LOOKUP = {
  name: 'lookup',
  description: 'Look a record up',
  inputSchema: { type: 'object', properties: { id: { type: 'string' } }, required: ['id'] },
} as const;

const MESSAGE_REPLY = {
  id: 'msg_1',
  model: HAIKU,
  role: 'assistant',
  content: [
    { type: 'text', text: 'Looking it up.' },
    { type: 'tool_use', id: 'tu_1', name: 'lookup', input: { id: 'r-7' } },
  ],
  stop_reason: 'tool_use',
  usage: { input_tokens: 31, output_tokens: 12 },
};

const TEXT_EVENTS = [
  {
    type: 'message_start',
    message: { id: 'msg_2', usage: { input_tokens: 20, output_tokens: 1 } },
  },
  { type: 'content_block_start', index: 0, content_block: { type: 'text', text: '' } },
  { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: 'The code ' } },
  { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: 'is 42.' } },
  { type: 'content_block_stop', index: 0 },
  { type: 'message_delta', delta: { stop_reason: 'end_turn' }, usage: { output_tokens: 7 } },
  { type: 'message_stop' },
];

const TOOL_EVENTS = [
  {
    type: 'message_start',
    message: { id: 'msg_3', usage: { input_tokens: 40, output_tokens: 1 } },
  },
  {
    type: 'content_block_start',
    index: 0,
    content_block: { type: 'tool_use', id: 'tu_a', name: 'lookup', input: {} },
  },
  {
    type: 'content_block_start',
    index: 1,
    content_block: { type: 'tool_use', id: 'tu_b', name: 'lookup', input: {} },
  },
  // Fragments of the two calls INTERLEAVE — reassembly is keyed by index.
  {
    type: 'content_block_delta',
    index: 0,
    delta: { type: 'input_json_delta', partial_json: '{"id":' },
  },
  {
    type: 'content_block_delta',
    index: 1,
    delta: { type: 'input_json_delta', partial_json: '{"id":"r-' },
  },
  {
    type: 'content_block_delta',
    index: 0,
    delta: { type: 'input_json_delta', partial_json: '"r-1"}' },
  },
  {
    type: 'content_block_delta',
    index: 1,
    delta: { type: 'input_json_delta', partial_json: '2"}' },
  },
  { type: 'content_block_stop', index: 0 },
  { type: 'content_block_stop', index: 1 },
  { type: 'message_delta', delta: { stop_reason: 'tool_use' }, usage: { output_tokens: 18 } },
  { type: 'message_stop' },
];

async function drain(stream: AsyncIterable<LLMChunk>): Promise<LLMChunk[]> {
  const out: LLMChunk[] = [];
  for await (const chunk of stream) out.push(chunk);
  return out;
}

async function caught(p: Promise<unknown>): Promise<unknown> {
  try {
    await p;
  } catch (err) {
    return err;
  }
  throw new Error('expected a rejection');
}

const ask = (content = 'hi'): LLMRequest => ({
  model: 'invoke-model-gateway',
  messages: [{ role: 'user', content }],
});

// ─── complete() ─────────────────────────────────────────────────────

describe('complete() — one POST to /model/{id}/invoke', () => {
  it('posts the Messages body with anthropic_version and no model field, and maps tool_use back', async () => {
    const seen: Seen[] = [];
    const provider = gateway(seen, [json(MESSAGE_REPLY)]);
    const res = await provider.complete({ ...ask('find r-7'), tools: [LOOKUP] });

    expect(seen[0]!.url).toBe(
      `${BASE.replace(/\/$/, '')}/model/${encodeURIComponent(HAIKU)}/invoke`,
    );
    expect(seen[0]!.headers).toStrictEqual({
      'content-type': 'application/json',
      'api-key': 'key-one',
    });
    expect(seen[0]!.body['anthropic_version']).toBe(INVOKE_MODEL_ANTHROPIC_VERSION);
    expect('model' in seen[0]!.body).toBe(false);
    expect(seen[0]!.body['tools']).toStrictEqual([
      { name: 'lookup', description: 'Look a record up', input_schema: LOOKUP.inputSchema },
    ]);

    expect(res.content).toBe('Looking it up.');
    expect(res.toolCalls).toStrictEqual([{ id: 'tu_1', name: 'lookup', args: { id: 'r-7' } }]);
    expect(res.stopReason).toBe('tool_use');
    expect(res.usage).toStrictEqual({ input: 31, output: 12 });
    expect(res.providerRef).toBe('msg_1');
    expect(res.wireManifest).toStrictEqual({ toolNames: ['lookup'] });
  });

  it('sends a prior tool call as tool_use and its result as a tool_result on a user turn', async () => {
    const seen: Seen[] = [];
    await gateway(seen, [
      json({ ...MESSAGE_REPLY, content: [{ type: 'text', text: 'done' }] }),
    ]).complete({
      model: 'invoke-model-gateway',
      tools: [LOOKUP],
      messages: [
        { role: 'user', content: 'find r-1 and r-2' },
        {
          role: 'assistant',
          content: '',
          toolCalls: [
            { id: 'a', name: 'lookup', args: { id: 'r-1' } },
            { id: 'b', name: 'lookup', args: { id: 'r-2' } },
          ],
        },
        { role: 'tool', content: 'one', toolCallId: 'a' },
        { role: 'tool', content: 'two', toolCallId: 'b' },
      ],
    });
    expect(seen[0]!.body['messages']).toStrictEqual([
      { role: 'user', content: 'find r-1 and r-2' },
      {
        role: 'assistant',
        content: [
          { type: 'tool_use', id: 'a', name: 'lookup', input: { id: 'r-1' } },
          { type: 'tool_use', id: 'b', name: 'lookup', input: { id: 'r-2' } },
        ],
      },
      {
        role: 'user',
        content: [
          { type: 'tool_result', tool_use_id: 'a', content: 'one' },
          { type: 'tool_result', tool_use_id: 'b', content: 'two' },
        ],
      },
    ]);
  });

  it('forces a named tool with tool_choice and declares that it can', async () => {
    const seen: Seen[] = [];
    const provider = gateway(seen, [json(MESSAGE_REPLY)]);
    await provider.complete({ ...ask(), tools: [LOOKUP], toolChoice: { name: 'lookup' } });
    expect(seen[0]!.body['tool_choice']).toStrictEqual({ type: 'tool', name: 'lookup' });
    expect(provider.carriesForcedToolChoice).toBe(true);
  });
});

// ─── system prompt ──────────────────────────────────────────────────

describe('the system prompt rides the top-level field', () => {
  it('sends LLMRequest.systemPrompt as `system` and drops a system-role message', async () => {
    const seen: Seen[] = [];
    await gateway(seen, [json(MESSAGE_REPLY)]).complete({
      model: 'invoke-model-gateway',
      systemPrompt: 'You are terse.',
      messages: [
        { role: 'system', content: 'never sent' },
        { role: 'user', content: 'hi' },
      ],
    });
    expect(seen[0]!.body['system']).toBe('You are terse.');
    expect(seen[0]!.body['messages']).toStrictEqual([{ role: 'user', content: 'hi' }]);
  });

  it('leaves carriesInMessages at the default, so a system-role injection is refused, not dropped', () => {
    expect(gateway([], []).carriesInMessages).toBeUndefined();
    expect(
      new InvokeModelGatewayProvider({ baseUrl: BASE, apiKeyHeader: 'api-key', apiKey: 'k' })
        .carriesInMessages,
    ).toBeUndefined();
  });
});

// ─── stream() ───────────────────────────────────────────────────────

describe('stream() — SSE from /model/{id}/invoke-with-response-stream', () => {
  it('yields text deltas and a terminal chunk carrying the response', async () => {
    const seen: Seen[] = [];
    const chunks = await drain(gateway(seen, [sse([dataLines(TEXT_EVENTS)])]).stream!(ask()));

    expect(
      seen[0]!.url.endsWith(`/model/${encodeURIComponent(HAIKU)}/invoke-with-response-stream`),
    ).toBe(true);
    expect(chunks.filter((c) => !c.done).map((c) => c.content)).toStrictEqual([
      'The code ',
      'is 42.',
    ]);
    const last = chunks[chunks.length - 1]!;
    expect(last.done).toBe(true);
    expect(last.response).toMatchObject({
      content: 'The code is 42.',
      toolCalls: [],
      usage: { input: 20, output: 7 },
      stopReason: 'stop',
      providerRef: 'msg_2',
    });
  });

  it('reassembles tool arguments from interleaved input_json_delta fragments', async () => {
    const chunks = await drain(
      gateway([], [sse([dataLines(TOOL_EVENTS)])]).stream!({ ...ask(), tools: [LOOKUP] }),
    );
    const response = chunks[chunks.length - 1]!.response!;
    expect(response.toolCalls).toStrictEqual([
      { id: 'tu_a', name: 'lookup', args: { id: 'r-1' } },
      { id: 'tu_b', name: 'lookup', args: { id: 'r-2' } },
    ]);
    expect(response.stopReason).toBe('tool_use');
    expect(response.wireManifest).toStrictEqual({ toolNames: ['lookup'] });
  });

  it('reads `event:` + `data:` framing and CRLF line ends the same way', async () => {
    const framed = TEXT_EVENTS.map(
      (e) => `event: ${e.type}\r\ndata: ${JSON.stringify(e)}\r\n\r\n`,
    ).join('');
    const a = await drain(gateway([], [sse([framed])]).stream!(ask()));
    const b = await drain(gateway([], [sse([dataLines(TEXT_EVENTS)])]).stream!(ask()));
    expect(a).toStrictEqual(b);
  });

  it('a tool called with no arguments streams as args: {}', async () => {
    const events = [
      {
        type: 'content_block_start',
        index: 0,
        content_block: { type: 'tool_use', id: 't', name: 'lookup', input: {} },
      },
      { type: 'content_block_stop', index: 0 },
      { type: 'message_delta', delta: { stop_reason: 'tool_use' } },
    ];
    const chunks = await drain(gateway([], [sse([dataLines(events)])]).stream!(ask()));
    expect(chunks[chunks.length - 1]!.response!.toolCalls).toStrictEqual([
      { id: 't', name: 'lookup', args: {} },
    ]);
  });

  it('streams the same answer complete() returns for the same message', async () => {
    const reply = {
      id: 'msg_2',
      model: HAIKU,
      role: 'assistant',
      content: [{ type: 'text', text: 'The code is 42.' }],
      stop_reason: 'end_turn',
      usage: { input_tokens: 20, output_tokens: 7 },
    };
    const complete = await gateway([], [json(reply)]).complete(ask());
    const chunks = await drain(gateway([], [sse([dataLines(TEXT_EVENTS)])]).stream!(ask()));
    const { wireManifest: _w1, ...streamed } = chunks[chunks.length - 1]!.response!;
    const { wireManifest: _w2, ...completed } = complete;
    expect(streamed).toStrictEqual(completed);
  });
});

// ─── property: re-chunking never changes the answer ─────────────────

/** Mulberry32 — a seeded generator, so a failure names its seed. */
function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Cut the ENCODED bytes — a cut may land inside a multi-byte character. */
function splitAt(whole: string, random: () => number): Uint8Array[] {
  const bytes = new TextEncoder().encode(whole);
  const pieces: Uint8Array[] = [];
  let i = 0;
  while (i < bytes.length) {
    const n = 1 + Math.floor(random() * 40);
    pieces.push(bytes.slice(i, i + n));
    i += n;
  }
  return pieces;
}

describe('property: the stream answer does not depend on where the bytes were cut', () => {
  it('200 seeded re-chunkings of text and tool streams give the same chunks', async () => {
    const script = dataLines([
      ...TOOL_EVENTS.slice(0, -2),
      ...TEXT_EVENTS.slice(1, 5).map((e) => ('index' in e ? { ...e, index: 5 } : e)),
      ...TOOL_EVENTS.slice(-2),
    ]).replace('r-1', 'r-1 “ü” 🚀');
    const whole = await drain(gateway([], [sse([script])]).stream!(ask()));
    for (let seed = 1; seed <= 200; seed++) {
      const pieces = splitAt(script, rng(seed));
      const cut = await drain(gateway([], [sse(pieces)]).stream!(ask()));
      expect(cut, `seed ${seed}`).toStrictEqual(whole);
    }
    expect(whole[whole.length - 1]!.response!.toolCalls[0]!.args).toStrictEqual({
      id: 'r-1 “ü” 🚀',
    });
  });
});

// ─── keys chosen per model ──────────────────────────────────────────

describe('the key is chosen per model id', () => {
  it('a map sends each model its own key', async () => {
    const seen: Seen[] = [];
    const provider = gateway(seen, [json(MESSAGE_REPLY), json(MESSAGE_REPLY)], {
      apiKey: { [HAIKU]: 'haiku-key', [SONNET]: 'sonnet-key' },
    });
    await provider.complete(ask());
    await provider.complete({ ...ask(), model: SONNET });
    expect(seen.map((s) => s.headers['api-key'])).toStrictEqual(['haiku-key', 'sonnet-key']);
    expect(seen[1]!.url).toContain(`/model/${encodeURIComponent(SONNET)}/invoke`);
  });

  it('a function is asked with the model id before every request (a rotated key is picked up)', async () => {
    const seen: Seen[] = [];
    const asked: string[] = [];
    let version = 1;
    const provider = gateway(seen, [json(MESSAGE_REPLY), sse([dataLines(TEXT_EVENTS)])], {
      apiKey: async (modelId) => {
        asked.push(modelId);
        return `key-v${version++}`;
      },
    });
    await provider.complete(ask());
    await drain(provider.stream!({ ...ask(), model: SONNET }));
    expect(asked).toStrictEqual([HAIKU, SONNET]);
    expect(seen.map((s) => s.headers['api-key'])).toStrictEqual(['key-v1', 'key-v2']);
  });

  it('a model the map does not name is refused by name before any request, and no key is printed', async () => {
    const seen: Seen[] = [];
    const provider = gateway(seen, [], { apiKey: { [HAIKU]: 'secret-haiku-key' } });
    const err = (await caught(
      provider.complete({ ...ask(), model: SONNET }),
    )) as InvokeModelGatewayError;
    expect(err).toBeInstanceOf(InvokeModelGatewayError);
    expect(err.reason).toBe('no-key');
    expect(err.modelId).toBe(SONNET);
    expect(err.message).toContain(SONNET);
    expect(err.message).toContain(HAIKU); // which ids the map DOES name
    expect(err.message).not.toContain('secret-haiku-key');
    expect(seen).toHaveLength(0);
  });

  it('the header name is the caller’s', async () => {
    const seen: Seen[] = [];
    await gateway(seen, [json(MESSAGE_REPLY)], { apiKeyHeader: 'x-gateway-key' }).complete(ask());
    expect(seen[0]!.headers['x-gateway-key']).toBe('key-one');
    expect(seen[0]!.headers['api-key']).toBeUndefined();
  });
});

// ─── errors, typed ──────────────────────────────────────────────────

describe('errors are typed and name the model', () => {
  const FORBIDDEN =
    '{"message":"You do not currently have access to model <us.anthropic.claude-sonnet-4-6> using product <p>"}';

  it('a 403 names the model, carries the status and the gateway’s reason, and never the key', async () => {
    const err = (await caught(
      gateway([], [text(FORBIDDEN, 403)], { apiKey: 'secret-key' }).complete({
        ...ask(),
        model: SONNET,
      }),
    )) as InvokeModelGatewayError;
    expect(err).toBeInstanceOf(InvokeModelGatewayError);
    expect(err.reason).toBe('http-status');
    expect(err.status).toBe(403);
    expect(err.modelId).toBe(SONNET);
    expect(err.message).toContain(`HTTP 403 for model ${SONNET}`);
    expect(err.message).toContain('its own key');
    expect(err.bodyExcerpt).toBe(FORBIDDEN);
    expect(err.message).not.toContain('secret-key');
  });

  it('a 403 on stream() is raised before any chunk', async () => {
    const stream = gateway([], [text(FORBIDDEN, 403)]).stream!(ask());
    const err = (await caught(drain(stream))) as InvokeModelGatewayError;
    expect(err.status).toBe(403);
    expect(err.message).toContain(HAIKU);
  });

  it('a 429 carries Retry-After in seconds', async () => {
    const err = (await caught(
      gateway([], [text('Rate limit is exceeded.', 429, { 'retry-after': '4' })]).complete(ask()),
    )) as InvokeModelGatewayError;
    expect(err.status).toBe(429);
    expect(err.retryAfterSeconds).toBe(4);
  });

  it('a network failure is reason network, with no status and the cause kept', async () => {
    const boom = new TypeError('fetch failed');
    const provider = invokeModelGateway({
      baseUrl: BASE,
      apiKeyHeader: 'api-key',
      apiKey: 'k',
      model: HAIKU,
      fetch: async () => {
        throw boom;
      },
    });
    const err = (await caught(provider.complete(ask()))) as InvokeModelGatewayError;
    expect(err.reason).toBe('network');
    expect(err.status).toBeUndefined();
    expect(err.cause).toBe(boom);
  });

  it('an abort passes through as the AbortError it is', async () => {
    const abort = new DOMException('aborted', 'AbortError');
    const provider = invokeModelGateway({
      baseUrl: BASE,
      apiKeyHeader: 'api-key',
      apiKey: 'k',
      model: HAIKU,
      fetch: async () => {
        throw abort;
      },
    });
    expect(await caught(provider.complete(ask()))).toBe(abort);
  });

  it('"prompt is too long" becomes ContextWindowExceededError', async () => {
    const body = '{"message":"prompt is too long: 250000 tokens > 200000 maximum"}';
    const err = await caught(gateway([], [text(body, 400)]).complete(ask()));
    expect(err).toBeInstanceOf(ContextWindowExceededError);
  });

  it('an error event mid-stream ends the stream as reason stream', async () => {
    const events = [
      TEXT_EVENTS[0],
      { type: 'error', error: { type: 'overloaded_error', message: 'Overloaded' } },
    ];
    const err = (await caught(
      drain(gateway([], [sse([dataLines(events)])]).stream!(ask())),
    )) as InvokeModelGatewayError;
    expect(err.reason).toBe('stream');
    expect(err.message).toContain('overloaded_error');
    expect(err.message).toContain(HAIKU);
  });

  it('a forwarded AWS exception object ends the stream as reason stream', async () => {
    const events = [{ throttlingException: { message: 'Too many tokens, please wait.' } }];
    const err = (await caught(
      drain(gateway([], [sse([dataLines(events)])]).stream!(ask())),
    )) as InvokeModelGatewayError;
    expect(err.reason).toBe('stream');
    expect(err.message).toContain('throttlingException');
  });

  it('streamed tool arguments that are not JSON are refused, never run as {}', async () => {
    const events = [
      {
        type: 'content_block_start',
        index: 0,
        content_block: { type: 'tool_use', id: 't', name: 'lookup', input: {} },
      },
      {
        type: 'content_block_delta',
        index: 0,
        delta: { type: 'input_json_delta', partial_json: '{"id":' },
      },
      { type: 'content_block_stop', index: 0 },
    ];
    const err = (await caught(
      drain(gateway([], [sse([dataLines(events)])]).stream!(ask())),
    )) as InvokeModelGatewayError;
    expect(err.reason).toBe('malformed-tool-args');
    expect(err.toolName).toBe('lookup');
  });

  it('an event that never parses is refused rather than dropped', async () => {
    const err = (await caught(
      drain(gateway([], [sse(['data: {"type":"content_block_delta"\n\n'])]).stream!(ask())),
    )) as InvokeModelGatewayError;
    expect(err.reason).toBe('stream');
  });

  it('a 2xx body that is not a Messages response is refused, never read as an empty answer', async () => {
    const err = (await caught(
      gateway([], [text('<html>signed out</html>', 200)]).complete(ask()),
    )) as InvokeModelGatewayError;
    expect(err.reason).toBe('unreadable-response');
    expect(err.bodyExcerpt).toBe('<html>signed out</html>');
    expect(err.message).toContain(HAIKU);
  });

  it('the shorthand with no model configured is refused by name', async () => {
    const err = (await caught(
      gateway([], [], { model: undefined }).complete(ask()),
    )) as InvokeModelGatewayError;
    expect(err.reason).toBe('no-model');
  });

  it('options that cannot make a request are refused at construction', () => {
    const base = { baseUrl: BASE, apiKeyHeader: 'api-key', apiKey: 'k' };
    const reasonOf = (fn: () => unknown): string | undefined => {
      try {
        fn();
      } catch (err) {
        return (err as InvokeModelGatewayError).reason;
      }
      return undefined;
    };
    expect(reasonOf(() => invokeModelGateway({ ...base, baseUrl: 'not a url' }))).toBe(
      'invalid-options',
    );
    expect(reasonOf(() => invokeModelGateway({ ...base, baseUrl: 'ftp://x' }))).toBe(
      'invalid-options',
    );
    expect(reasonOf(() => invokeModelGateway({ ...base, apiKeyHeader: 'bad header' }))).toBe(
      'invalid-options',
    );
    expect(reasonOf(() => invokeModelGateway({ ...base, apiKey: '' }))).toBe('invalid-options');
    expect(reasonOf(() => invokeModelGateway({ ...base, apiKey: {} }))).toBe('invalid-options');
  });
});

// ─── withRetry owns the retries ─────────────────────────────────────

describe('contract: withRetry composes on the typed status', () => {
  it('retries a 429 and a 503 on complete(), then succeeds', async () => {
    const seen: Seen[] = [];
    const provider = withRetry(
      gateway(seen, [
        text('slow down', 429),
        text('Internal Server Error', 503),
        json(MESSAGE_REPLY),
      ]),
      { initialDelayMs: 0 },
    );
    const res = await provider.complete(ask());
    expect(res.providerRef).toBe('msg_1');
    expect(seen).toHaveLength(3);
  });

  it('does not retry a 403 — a key scoped away from the model is an answer, not weather', async () => {
    const seen: Seen[] = [];
    const provider = withRetry(gateway(seen, [text('no', 403), json(MESSAGE_REPLY)]), {
      initialDelayMs: 0,
    });
    await caught(provider.complete(ask()));
    expect(seen).toHaveLength(1);
  });
});

describe('contract: withRetry never repeats what asking again cannot mend', () => {
  // A delay nobody would wait out: if the default policy retried, the test
  // would time out instead of passing.
  const patient = { maxAttempts: 3, initialDelayMs: 60_000 };

  it('a key function that returns none is read once, refused once, with no request and no wait', async () => {
    const seen: Seen[] = [];
    let reads = 0;
    const provider = withRetry(
      gateway(seen, [json(MESSAGE_REPLY)], {
        apiKey: () => {
          reads++;
          return undefined;
        },
      }),
      patient,
    );
    const err = (await caught(provider.complete(ask()))) as InvokeModelGatewayError;
    expect(err.reason).toBe('no-key');
    expect(err.retryable).toBe(false);
    expect(reads).toBe(1);
    expect(seen).toHaveLength(0);
  });

  it('a 2xx it cannot read is POSTed once — the model may already have run', async () => {
    const seen: Seen[] = [];
    const provider = withRetry(
      gateway(seen, [text('<html>signed out</html>', 200), json(MESSAGE_REPLY)]),
      patient,
    );
    const err = (await caught(provider.complete(ask()))) as InvokeModelGatewayError;
    expect(err.reason).toBe('unreadable-response');
    expect(seen).toHaveLength(1);
  });

  it('no model to ask is refused once, with no request', async () => {
    const seen: Seen[] = [];
    const provider = withRetry(gateway(seen, [], { model: undefined }), patient);
    const err = (await caught(provider.complete(ask()))) as InvokeModelGatewayError;
    expect(err.reason).toBe('no-model');
    expect(seen).toHaveLength(0);
  });

  it('a network failure IS retried', async () => {
    const seen: Seen[] = [];
    const dropped: Reply = () => {
      throw new TypeError('fetch failed');
    };
    const provider = withRetry(gateway(seen, [dropped, json(MESSAGE_REPLY)]), {
      initialDelayMs: 0,
    });
    const res = await provider.complete(ask());
    expect(res.providerRef).toBe('msg_1');
    expect(seen).toHaveLength(2);
  });

  it('retryable is true for exactly a 429, a 5xx and a network failure', () => {
    const reasons = [
      'invalid-options',
      'no-model',
      'no-key',
      'http-status',
      'network',
      'unreadable-response',
      'stream',
      'malformed-tool-args',
    ] as const;
    const statuses = [undefined, 400, 401, 403, 404, 408, 429, 499, 500, 503, 599];
    for (const reason of reasons) {
      for (const status of statuses) {
        const err = new InvokeModelGatewayError({
          reason,
          message: 'x',
          ...(status !== undefined && { status }),
        });
        const expected =
          reason === 'network' ||
          (reason === 'http-status' && status !== undefined && (status === 429 || status >= 500));
        expect({ reason, status, retryable: err.retryable }).toStrictEqual({
          reason,
          status,
          retryable: expected,
        });
      }
    }
  });
});

// ─── wiring ─────────────────────────────────────────────────────────

describe('wiring', () => {
  it("createProvider({ kind: 'invoke-model-gateway' }) builds the same adapter", async () => {
    const seen: Seen[] = [];
    const provider = createProvider({
      kind: 'invoke-model-gateway',
      baseUrl: BASE,
      apiKeyHeader: 'api-key',
      apiKey: 'k',
      model: HAIKU,
      fetch: scriptedFetch([json(MESSAGE_REPLY)], seen),
    });
    expect(provider.name).toBe('invoke-model-gateway');
    await provider.complete(ask());
    expect(seen[0]!.url).toContain('/invoke');
  });

  it('the class form forwards to the factory', async () => {
    const seen: Seen[] = [];
    const provider = new InvokeModelGatewayProvider({
      baseUrl: BASE,
      apiKeyHeader: 'api-key',
      apiKey: 'k',
      model: HAIKU,
      fetch: scriptedFetch([json(MESSAGE_REPLY), sse([dataLines(TEXT_EVENTS)])], seen),
    });
    expect((await provider.complete(ask())).providerRef).toBe('msg_1');
    const chunks = await drain(provider.stream(ask()));
    expect(chunks[chunks.length - 1]!.response!.content).toBe('The code is 42.');
  });
});

// ─── scenario: an agent tool loop ───────────────────────────────────

describe('scenario: an Agent runs a tool loop over the gateway', () => {
  it('calls the tool, sends the result back as tool_result, and answers', async () => {
    const seen: Seen[] = [];
    // The agent streams when the provider can, so both turns are SSE.
    const callTool = [
      {
        type: 'message_start',
        message: { id: 'msg_8', usage: { input_tokens: 30, output_tokens: 1 } },
      },
      {
        type: 'content_block_start',
        index: 0,
        content_block: { type: 'tool_use', id: 'tu_1', name: 'lookup', input: {} },
      },
      {
        type: 'content_block_delta',
        index: 0,
        delta: { type: 'input_json_delta', partial_json: '{"id":"r-7"}' },
      },
      { type: 'content_block_stop', index: 0 },
      { type: 'message_delta', delta: { stop_reason: 'tool_use' }, usage: { output_tokens: 9 } },
    ];
    const answerTurn = [
      {
        type: 'message_start',
        message: { id: 'msg_9', usage: { input_tokens: 50, output_tokens: 1 } },
      },
      {
        type: 'content_block_delta',
        index: 0,
        delta: { type: 'text_delta', text: 'Record r-7 is active.' },
      },
      { type: 'message_delta', delta: { stop_reason: 'end_turn' }, usage: { output_tokens: 6 } },
    ];
    const provider = gateway(seen, [sse([dataLines(callTool)]), sse([dataLines(answerTurn)])]);
    const lookup = defineTool<{ id: string }, string>({
      name: 'lookup',
      description: LOOKUP.description,
      inputSchema: LOOKUP.inputSchema,
      execute: ({ id }) => `${id}: active`,
    });
    const agent = Agent.create({ provider, model: 'invoke-model-gateway' })
      .system('You look records up.')
      .tool(lookup)
      .build();
    const answer = await agent.run({ message: 'is r-7 active?' });

    expect(answer).toBe('Record r-7 is active.');
    expect(seen).toHaveLength(2);
    expect(seen[1]!.body['system']).toContain('You look records up.');
    const lastTurn = (seen[1]!.body['messages'] as Array<{ role: string; content: unknown }>).at(
      -1,
    )!;
    expect(lastTurn.role).toBe('user');
    expect(lastTurn.content).toStrictEqual([
      { type: 'tool_result', tool_use_id: 'tu_1', content: 'r-7: active' },
    ]);
  });
});
