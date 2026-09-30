/**
 * invokeModelGateway — the stated wait and the per-request deadline.
 *
 * Two field bugs, found when an app moved off its hand-written adapter:
 *   1. the gateway states its wait in the 429 BODY ("Try again in 4 seconds"),
 *      often with no Retry-After header, and nothing read it — `withRetry`
 *      backed off by its own schedule and ran out of attempts inside the wait;
 *   2. there was no per-request timeout — a gateway that never answered held
 *      the run until the caller's own signal (if any) fired.
 *
 * Every test drives a SCRIPTED fetch; nothing leaves the process.
 *
 * Test types (Convention 3): unit (the declared wait, each deadline phase) ·
 * boundary (header beats body, the caller's signal beats the deadline, a stream
 * that keeps talking is never cut off) · contract (no timeoutMs = the fetch gets
 * exactly the caller's signal; a timeout is retryable and withRetry re-opens a
 * stream that timed out before its first chunk) · scenario (withRetry waits
 * what the body said).
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  invokeModelGateway,
  InvokeModelGatewayError,
  type InvokeModelGatewayFetch,
  type InvokeModelGatewayOptions,
} from '../../../src/adapters/llm/InvokeModelGatewayProvider.js';
import { withRetry } from '../../../src/resilience/withRetry.js';
import type { LLMChunk, LLMRequest } from '../../../src/adapters/types.js';

const REQ: LLMRequest = {
  model: 'invoke-model-gateway',
  messages: [{ role: 'user', content: 'hi' }],
};
const MESSAGE = {
  id: 'm',
  model: 'x',
  role: 'assistant',
  content: [{ type: 'text', text: 'ok' }],
  stop_reason: 'end_turn',
  usage: { input_tokens: 1, output_tokens: 1 },
};

const gateway = (fetch: InvokeModelGatewayFetch, extra: Partial<InvokeModelGatewayOptions> = {}) =>
  invokeModelGateway({
    baseUrl: 'https://gw.example.com',
    apiKeyHeader: 'api-key',
    apiKey: 'k',
    model: 'm1',
    fetch,
    ...extra,
  });

async function failure(promise: Promise<unknown>): Promise<InvokeModelGatewayError> {
  try {
    await promise;
  } catch (err) {
    return err as InvokeModelGatewayError;
  }
  throw new Error('expected a failure');
}

async function drain(stream: AsyncIterable<LLMChunk>): Promise<LLMChunk[]> {
  const out: LLMChunk[] = [];
  for await (const c of stream) out.push(c);
  return out;
}

const never = <T>(): Promise<T> => new Promise<T>(() => undefined);

/** A stream reply: the given SSE pieces, then silence (never closes) when `stall`. */
function sseReply(pieces: string[], stall: boolean): Response {
  const encoder = new TextEncoder();
  return new Response(
    new ReadableStream<Uint8Array>({
      start(controller) {
        for (const p of pieces) controller.enqueue(encoder.encode(p));
        if (!stall) controller.close();
      },
    }),
    { status: 200, headers: { 'content-type': 'text/event-stream' } },
  );
}

const data = (e: unknown): string => `data: ${JSON.stringify(e)}\n\n`;
const START = data({ type: 'message_start', message: { id: 'm', usage: { input_tokens: 1 } } });
const TEXT = data({
  type: 'content_block_delta',
  index: 0,
  delta: { type: 'text_delta', text: 'Hel' },
});
const END = [
  data({ type: 'message_delta', delta: { stop_reason: 'end_turn' }, usage: { output_tokens: 1 } }),
  data({ type: 'message_stop' }),
];

afterEach(() => {
  vi.useRealTimers();
});

// ─── The stated wait ────────────────────────────────────────────────

describe('the stated wait is declared as retryAfterMs', () => {
  const refuse = (body: string, headers: Record<string, string> = {}) =>
    gateway(async () => new Response(body, { status: 429, headers })).complete(REQ);

  it("reads the body's 'Try again in N seconds' when there is no header", async () => {
    const err = await failure(refuse('Rate limit is exceeded. Try again in 4 seconds.'));
    expect(err.status).toBe(429);
    expect(err.retryAfterMs).toBe(4000);
    // The header-only field keeps its meaning: no header, no value.
    expect(err.retryAfterSeconds).toBeUndefined();
  });

  it('the Retry-After header wins over the body', async () => {
    const err = await failure(refuse('Try again in 9 seconds.', { 'retry-after': '2' }));
    expect(err.retryAfterMs).toBe(2000);
    expect(err.retryAfterSeconds).toBe(2);
  });

  it('reads a singular and a fractional wording', async () => {
    expect((await failure(refuse('try again in 1 second'))).retryAfterMs).toBe(1000);
    expect((await failure(refuse('Try again in 1.5 seconds'))).retryAfterMs).toBe(1500);
  });

  it('states nothing: no wait is declared', async () => {
    const err = await failure(refuse('slow down'));
    expect(err.retryAfterMs).toBeUndefined();
  });

  it('withRetry waits what the body said — four short attempts no longer run out inside it', async () => {
    vi.useFakeTimers();
    const replies = [
      () => new Response('Rate limit is exceeded. Try again in 4 seconds.', { status: 429 }),
      () => new Response(JSON.stringify(MESSAGE), { status: 200 }),
    ];
    let calls = 0;
    const provider = withRetry(
      gateway(async () => {
        calls++;
        return replies.shift()!();
      }),
      { maxAttempts: 4 },
    );
    const done = provider.complete(REQ);
    await vi.advanceTimersByTimeAsync(3999);
    expect(calls).toBe(1);
    await vi.advanceTimersByTimeAsync(1);
    expect(calls).toBe(2);
    expect((await done).content).toBe('ok');
  });
});

// ─── The deadline ───────────────────────────────────────────────────

describe('timeoutMs — a per-request deadline', () => {
  it('complete(): a gateway that never answers raises a typed, retryable timeout', async () => {
    vi.useFakeTimers();
    let signal: AbortSignal | undefined;
    const provider = gateway(
      async (_u, init) => {
        signal = init?.signal ?? undefined;
        return never<Response>();
      },
      { timeoutMs: 1000 },
    );
    const settled = failure(provider.complete(REQ));
    await vi.advanceTimersByTimeAsync(1000);
    const err = await settled;
    expect(err).toBeInstanceOf(InvokeModelGatewayError);
    expect(err.reason).toBe('timeout');
    expect(err.retryable).toBe(true);
    expect(err.modelId).toBe('m1');
    expect(err.message).toContain('within 1000 ms');
    // The request was aborted, so a real fetch drops the connection.
    expect(signal?.aborted).toBe(true);
  });

  it('complete(): a body that never finishes times out too', async () => {
    vi.useFakeTimers();
    const provider = gateway(async () => sseReply(['{"id":'], true), { timeoutMs: 500 });
    const settled = failure(provider.complete(REQ));
    await vi.advanceTimersByTimeAsync(500);
    expect((await settled).reason).toBe('timeout');
  });

  it('stream(): no first chunk within the deadline', async () => {
    vi.useFakeTimers();
    const provider = gateway(async () => sseReply([], true), { timeoutMs: 800 });
    const settled = failure(drain(provider.stream!(REQ)));
    await vi.advanceTimersByTimeAsync(800);
    const err = await settled;
    expect(err.reason).toBe('timeout');
    expect(err.message).toContain('the first stream chunk');
  });

  it('stream(): a stall BETWEEN chunks times out after the chunks already delivered', async () => {
    vi.useFakeTimers();
    const provider = gateway(async () => sseReply([START, TEXT], true), { timeoutMs: 800 });
    const got: string[] = [];
    const settled = failure(
      (async () => {
        for await (const c of provider.stream!(REQ)) got.push(c.content);
      })(),
    );
    await vi.advanceTimersByTimeAsync(800);
    const err = await settled;
    expect(got).toEqual(['Hel']);
    expect(err.reason).toBe('timeout');
    expect(err.message).toContain('the next stream chunk');
  });

  it('stream(): a stream that keeps talking is never cut off (the deadline is per read)', async () => {
    vi.useFakeTimers();
    const encoder = new TextEncoder();
    const pieces = [START, TEXT, TEXT, TEXT, ...END];
    const body = new ReadableStream<Uint8Array>({
      async pull(controller) {
        const next = pieces.shift();
        if (next === undefined) return controller.close();
        await new Promise((r) => setTimeout(r, 600)); // each gap < 1000, total > 1000
        controller.enqueue(encoder.encode(next));
      },
    });
    const provider = gateway(async () => new Response(body, { status: 200 }), {
      timeoutMs: 1000,
    });
    const done = drain(provider.stream!(REQ));
    await vi.advanceTimersByTimeAsync(600 * 8);
    const chunks = await done;
    expect(chunks.map((c) => c.content).join('')).toBe('HelHelHel');
    expect(chunks.at(-1)!.done).toBe(true);
  });

  it("the caller's signal wins over the deadline", async () => {
    vi.useFakeTimers();
    const controller = new AbortController();
    const provider = gateway(async () => never<Response>(), { timeoutMs: 10_000 });
    const settled = provider.complete({ ...REQ, signal: controller.signal }).catch((e) => e);
    await vi.advanceTimersByTimeAsync(100);
    controller.abort();
    const err = (await settled) as Error;
    expect(err.name).toBe('AbortError');
    expect(err).not.toBeInstanceOf(InvokeModelGatewayError);
  });

  it('a caller signal already aborted refuses at once', async () => {
    const controller = new AbortController();
    controller.abort();
    const provider = gateway(async () => never<Response>(), { timeoutMs: 10_000 });
    const err = (await provider
      .complete({ ...REQ, signal: controller.signal })
      .catch((e) => e)) as Error;
    expect(err.name).toBe('AbortError');
  });

  it('withRetry re-opens a stream that timed out before its first chunk', async () => {
    vi.useFakeTimers();
    let calls = 0;
    const provider = withRetry(
      gateway(
        async () => {
          calls++;
          return calls === 1 ? sseReply([], true) : sseReply([START, TEXT, ...END], false);
        },
        { timeoutMs: 500 },
      ),
    );
    const done = drain(provider.stream!(REQ));
    await vi.advanceTimersByTimeAsync(500 + 200);
    const chunks = await done;
    expect(calls).toBe(2);
    expect(chunks.map((c) => c.content).join('')).toBe('Hel');
  });

  it('no timeoutMs: the fetch gets exactly the caller signal (or none) — unchanged', async () => {
    const seen: (AbortSignal | undefined | null)[] = [];
    const keys: boolean[] = [];
    const provider = gateway(async (_u, init) => {
      seen.push(init?.signal);
      keys.push(init !== undefined && 'signal' in init);
      return new Response(JSON.stringify(MESSAGE), { status: 200 });
    });
    const controller = new AbortController();
    await provider.complete({ ...REQ, signal: controller.signal });
    await provider.complete(REQ);
    expect(seen[0]).toBe(controller.signal);
    expect(keys).toEqual([true, false]);
  });

  it('refuses a timeoutMs that is not a positive number, by name', () => {
    for (const bad of [0, -1, NaN, Infinity]) {
      expect(() => gateway(async () => new Response(''), { timeoutMs: bad })).toThrow(/timeoutMs/);
    }
  });
});
