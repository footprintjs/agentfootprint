/**
 * One retry series per MCP call — the AgentCore defaults, the budget the 429
 * and session-busy retries share, the deadline, `Retry-After`, cancellation, and
 * what `onRetry` may say.
 *
 *   P1 Unit         — the backoff law; the AgentCore defaults' total waits
 *   P2 Boundary     — Retry-After honoured to the millisecond, and capped
 *   P3 Scenario     — through the REAL mcpClient: one series, not two
 *   P4 Property     — the overall attempt limit; the deadline
 *   P5 Security     — cancellation; `onRetry` carries no payload
 *
 * Every wait runs on a FAKE clock: `vi.useFakeTimers()` fakes `Date` and
 * `setTimeout`, which footprintjs's attempt runner reads for its waits and its
 * deadline. Every jittered draw comes from an injected random source — passed
 * to `exponentialBackoff` directly, or `Math.random` pinned on the wire.
 * Nothing leaves the process: the runtime's endpoint is a stand-in `fetch`.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { mcpClient } from '../../src/tool-providers/index.js';
import {
  agentCoreRuntimeMcpTransport,
  SESSION_BUSY_RETRY_DEFAULTS,
  type AgentCoreRuntimeRetryOptions,
} from '../../src/adapters/mcp/agentcoreRuntime/transport.js';
import { exponentialBackoff } from '../../src/mcp/exponentialBackoff.js';
import {
  retryingFetch,
  type ThrottleFetch,
  type ThrottleRetryInfo,
} from '../../src/mcp/throttleRetry.js';
import { staticTokens } from '../../src/identity/staticTokens.js';

const ARN = 'arn:aws:bedrock-agentcore:us-west-2:123456789012:runtime/orders_mcp-a1b2c3';
const REGION = 'us-west-2';
const URL_ = 'http://example.test/mcp';
const POST: RequestInit = {
  method: 'POST',
  body: '{"jsonrpc":"2.0","id":1,"method":"tools/call"}',
};
const BUSY = { code: -32005, message: 'Session operation in progress, please retry' };

// ── Replies ──────────────────────────────────────────────────────────

const busy = (): Response =>
  new Response(JSON.stringify({ jsonrpc: '2.0', id: 1, error: BUSY }), {
    headers: { 'content-type': 'application/json' },
  });

const throttle = (retryAfter?: string): Response =>
  new Response('{}', {
    status: 429,
    headers: {
      'content-type': 'application/json',
      ...(retryAfter !== undefined && { 'retry-after': retryAfter }),
    },
  });

const served = (): Response =>
  new Response(JSON.stringify({ jsonrpc: '2.0', id: 1, result: {} }), {
    headers: { 'content-type': 'application/json' },
  });

/** A stand-in endpoint answering `replies(n)` on request n (1-based); it records what it was sent. */
function endpoint(replies: (n: number) => Response | Promise<Response>) {
  const inits: (RequestInit | undefined)[] = [];
  const fetch: ThrottleFetch = async (_input, init) => {
    inits.push(init);
    return replies(inits.length);
  };
  return { fetch, calls: () => inits.length, inits };
}

/** An AgentCore Runtime transport (bearer path) over a stand-in endpoint. */
function runtime(
  replies: (n: number) => Response | Promise<Response>,
  retry?: boolean | AgentCoreRuntimeRetryOptions,
) {
  const stand = endpoint(replies);
  const transport = agentCoreRuntimeMcpTransport({
    agentRuntimeArn: ARN,
    region: REGION,
    ...(retry !== undefined && { retry }),
    auth: { bearer: staticTokens({ runtime: 'TOKEN-SECRET-9f2' }), fetch: stand.fetch },
  });
  return { ...stand, transport, fetch: transport.fetch as ThrottleFetch };
}

/** Run `pending` to the end on the fake clock: one timer at a time, real ticks between. */
async function drive<T>(pending: Promise<T>): Promise<T> {
  let done = false;
  pending.then(
    () => (done = true),
    () => (done = true),
  );
  for (let i = 0; i < 500 && !done; i++) await vi.advanceTimersToNextTimerAsync();
  return pending;
}

/** Let every promise that can settle without the clock moving, settle. */
async function flush(): Promise<void> {
  for (let i = 0; i < 5; i++) await vi.advanceTimersByTimeAsync(0);
}

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

// ─── P1 Unit ─────────────────────────────────────────────────────────

describe('retry series — P1 the backoff law and the AgentCore defaults', () => {
  const sumOfWaits = (random: () => number): number => {
    const { baseDelayMs, multiplier, jitter, maxAttempts } = SESSION_BUSY_RETRY_DEFAULTS;
    const waitAfter = exponentialBackoff({ baseDelayMs, multiplier, jitter, random });
    let total = 0;
    for (let n = 1; n < maxAttempts; n++) total += waitAfter(n);
    return total;
  };

  it('the default minimum total wait is above 3.4 s, and the maximum inside the 10 s ceiling', () => {
    expect(sumOfWaits(() => 0)).toBe(3750);
    expect(sumOfWaits(() => 0)).toBeGreaterThan(3400);
    expect(sumOfWaits(() => 0.999_999)).toBe(7500);
    expect(sumOfWaits(() => 0.999_999)).toBeLessThanOrEqual(SESSION_BUSY_RETRY_DEFAULTS.maxWaitMs);
  });

  it('on the wire, the shortest draw waits 250, 500, 1000, 2000 ms — 3.75 s before the fifth attempt', async () => {
    vi.spyOn(Math, 'random').mockReturnValue(0);
    const retries: ThrottleRetryInfo[] = [];
    const { fetch, calls } = runtime(busy, { onRetry: (info) => retries.push(info) });

    const startedAt = Date.now();
    await drive(fetch(URL_, POST));

    expect(calls()).toBe(5);
    expect(retries.map((r) => [r.kind, r.attempt, r.waitMs])).toEqual([
      ['session-busy', 2, 250],
      ['session-busy', 3, 500],
      ['session-busy', 4, 1000],
      ['session-busy', 5, 2000],
    ]);
    expect(Date.now() - startedAt).toBe(3750);
    expect(Date.now() - startedAt).toBeGreaterThan(3400);
  });

  it('equal jitter draws between half the ceiling and all of it; full from zero; none the ceiling', () => {
    const at = (jitter: 'none' | 'equal' | 'full', r: number) =>
      exponentialBackoff({ baseDelayMs: 400, multiplier: 2, jitter, random: () => r })(2);
    expect([at('equal', 0), at('equal', 0.5), at('equal', 0.999_999)]).toEqual([400, 600, 800]);
    expect([at('full', 0), at('full', 0.5), at('full', 0.999_999)]).toEqual([0, 400, 800]);
    expect([at('none', 0), at('none', 0.7)]).toEqual([800, 800]);
  });

  it('a cap bounds the ceiling BEFORE the draw, so capped waits keep their jitter', () => {
    const capped = (r: number) =>
      exponentialBackoff({
        baseDelayMs: 500,
        multiplier: 2,
        jitter: 'equal',
        maxBackoffMs: 1000,
        random: () => r,
      })(6);
    // 500 × 2^5 = 16 s, capped to 1 s: the draw still spreads over 500–1000 ms.
    expect([capped(0), capped(0.5), capped(0.999_999)]).toEqual([500, 750, 1000]);
  });

  it('an option outside its range is refused when the fetch is BUILT, by name', () => {
    expect(() => retryingFetch(undefined, { multiplier: 0.5 })).toThrow(
      /retryOnThrottle: `multiplier`/,
    );
    expect(() => retryingFetch(undefined, { baseDelayMs: -1 })).toThrow(/`baseDelayMs`/);
    expect(() => retryingFetch(undefined, { maxElapsedMs: 0 })).toThrow(/`maxElapsedMs`/);
    expect(() => retryingFetch(undefined, { maxAttempts: Number.NaN })).toThrow(/`maxAttempts`/);
    expect(() =>
      agentCoreRuntimeMcpTransport({
        agentRuntimeArn: ARN,
        region: REGION,
        retry: { jitter: 'some' as never },
        auth: { bearer: staticTokens({ runtime: 't' }), fetch: async () => served() },
      }),
    ).toThrow(/agentCoreRuntimeMcpTransport: `retry`: `jitter`/);
  });
});

// ─── P2 Boundary — Retry-After ──────────────────────────────────────

describe('retry series — P2 Retry-After is honoured, and capped', () => {
  it('honoured: the wait is exactly the stated one, not the backoff', async () => {
    const stand = endpoint((n) => (n === 1 ? throttle('2') : served()));
    const retries: ThrottleRetryInfo[] = [];
    const fetch = retryingFetch(stand.fetch, {
      baseDelayMs: 10,
      jitter: 'none',
      onRetry: (info) => retries.push(info),
    }) as ThrottleFetch;

    const pending = fetch(URL_, POST);
    await flush();
    await vi.advanceTimersByTimeAsync(1999);
    expect(stand.calls()).toBe(1);
    await vi.advanceTimersByTimeAsync(1);
    expect((await pending).status).toBe(200);
    expect(stand.calls()).toBe(2);
    expect(retries).toEqual([
      { kind: 'throttle', attempt: 2, maxAttempts: 3, waitMs: 2000, retryAfterMs: 2000, url: URL_ },
    ]);
  });

  it('capped by the deadline: a stated wait that would end past it is never begun', async () => {
    const stand = endpoint((n) => (n === 1 ? throttle('30') : served()));
    const retries: ThrottleRetryInfo[] = [];
    const fetch = retryingFetch(stand.fetch, {
      maxElapsedMs: 5_000,
      maxWaitMs: 60_000,
      onRetry: (info) => retries.push(info),
    }) as ThrottleFetch;

    const startedAt = Date.now();
    const res = await drive(fetch(URL_, POST));

    expect(res.status).toBe(429);
    expect(stand.calls()).toBe(1);
    expect(retries).toEqual([]);
    expect(Date.now() - startedAt).toBe(0);
  });

  it('capped by maxBackoffMs WITHOUT being shortened: the 429 is delivered, never asked again early', async () => {
    const stand = endpoint((n) => (n === 1 ? throttle('3') : served()));
    const fetch = retryingFetch(stand.fetch, {
      maxBackoffMs: 1_000,
      maxWaitMs: 60_000,
    }) as ThrottleFetch;

    const startedAt = Date.now();
    const res = await drive(fetch(URL_, POST));

    expect(res.status).toBe(429);
    expect(stand.calls()).toBe(1);
    expect(Date.now() - startedAt).toBe(0);
  });
});

// ─── P3 Scenario — the real mcpClient ───────────────────────────────

describe('retry series — P3 through the REAL mcpClient, one series per call', () => {
  it('a tool call meeting session-busy and 429 by turns makes the transport’s attempts, not their product', async () => {
    // Real timers: the MCP SDK keeps its own request timer, which a fake clock
    // driven to "the next timer" would fire. The waits here are a few ms.
    vi.useRealTimers();
    let toolCalls = 0;
    const server = async (_input: string | URL, init?: RequestInit): Promise<Response> => {
      if ((init?.method ?? 'GET').toUpperCase() !== 'POST')
        return new Response(null, { status: 405 });
      const rpc = JSON.parse(String(init?.body)) as {
        id?: number;
        method: string;
        params?: { protocolVersion?: string };
      };
      const reply = (result: unknown) =>
        new Response(JSON.stringify({ jsonrpc: '2.0', id: rpc.id, result }), {
          headers: { 'content-type': 'application/json' },
        });
      if (rpc.method === 'initialize') {
        return reply({
          protocolVersion: rpc.params?.protocolVersion,
          capabilities: { tools: {} },
          serverInfo: { name: 'orders', version: '1.0.0' },
        });
      }
      if (rpc.method === 'notifications/initialized') return new Response(null, { status: 202 });
      if (rpc.method === 'tools/list') {
        return reply({ tools: [{ name: 'lookup', inputSchema: { type: 'object' } }] });
      }
      toolCalls++;
      return toolCalls % 2 === 1
        ? new Response(JSON.stringify({ jsonrpc: '2.0', id: rpc.id, error: BUSY }), {
            headers: { 'content-type': 'application/json' },
          })
        : throttle();
    };
    const fast = { baseDelayMs: 1, jitter: 'none' as const };
    const client = await mcpClient({
      name: 'orders',
      transport: agentCoreRuntimeMcpTransport({
        agentRuntimeArn: ARN,
        region: REGION,
        retry: { ...fast, maxAttempts: 4 },
        auth: { bearer: staticTokens({ runtime: 't' }), fetch: server },
      }),
      // Its own limit is generous on purpose: the transport's is the call's.
      retryOnThrottle: { ...fast, maxAttempts: 10 },
    });
    const [lookup] = await client.tools();

    await expect(lookup?.execute({ id: 'A-1' }, {} as never)).rejects.toThrow();
    await client.close();

    expect(toolCalls).toBe(4);
  });
});

// ─── P4 Property — one budget, one deadline ─────────────────────────

describe('retry series — P4 the overall limit and the deadline hold by construction', () => {
  it('the overall attempt limit holds when 429 and session-busy alternate', async () => {
    const busyReports: ThrottleRetryInfo[] = [];
    const throttleReports: ThrottleRetryInfo[] = [];
    const { transport, calls } = runtime((n) => (n % 2 === 1 ? busy() : throttle('0')), {
      maxAttempts: 4,
      onRetry: (info) => busyReports.push(info),
    });
    // What mcpClient applies to every http transport's fetch.
    const fetch = retryingFetch(transport.fetch, {
      maxAttempts: 10,
      onRetry: (info) => throttleReports.push(info),
    }) as ThrottleFetch;

    const res = await drive(fetch(transport.url, POST));

    expect(calls()).toBe(4);
    expect(res.status).toBe(429);
    expect(busyReports.map((r) => [r.kind, r.attempt])).toEqual([
      ['session-busy', 2],
      ['session-busy', 4],
    ]);
    expect(throttleReports.map((r) => [r.kind, r.attempt])).toEqual([['throttle', 3]]);
  });

  it('a joined rule’s own maxAttempts limits only its own refusals inside the series', async () => {
    const { transport, calls } = runtime((n) => (n < 3 ? busy() : throttle('0')), {
      maxAttempts: 5,
    });
    const fetch = retryingFetch(transport.fetch, { maxAttempts: 2 }) as ThrottleFetch;

    const res = await drive(fetch(transport.url, POST));

    // Two busy refusals retried under the transport's 5; the 429 on attempt 3
    // is past its own limit of 2, so it is delivered.
    expect(calls()).toBe(3);
    expect(res.status).toBe(429);
  });

  it('the deadline stops retries: a wait that would end past maxElapsedMs is never begun', async () => {
    const retries: ThrottleRetryInfo[] = [];
    const { fetch, calls } = runtime(busy, {
      maxElapsedMs: 2_000,
      baseDelayMs: 500,
      jitter: 'none',
      maxAttempts: 10,
      maxWaitMs: 60_000,
      onRetry: (info) => retries.push(info),
    });

    const res = await drive(fetch(URL_, POST));

    // Waits of 500 and 1000 ms fit; the next, 2000 ms from t = 1500, would not.
    expect(retries.map((r) => r.waitMs)).toEqual([500, 1_000]);
    expect(calls()).toBe(3);
    // The last refusal is delivered as the server sent it.
    expect(((await res.json()) as { error: { code: number } }).error.code).toBe(-32005);
  });

  it('the deadline counts the requests too — time a slow request spends is time the retries lose', async () => {
    const slowBusy = async (): Promise<Response> => {
      await new Promise((resolve) => setTimeout(resolve, 600));
      return busy();
    };
    const { fetch, calls } = runtime(slowBusy, {
      maxElapsedMs: 2_000,
      baseDelayMs: 500,
      jitter: 'none',
      maxAttempts: 10,
      maxWaitMs: 60_000,
    });

    await drive(fetch(URL_, POST));

    // 600 + 500 + 600 = 1700 ms in; the next wait (1000 ms) would end at 2700.
    expect(calls()).toBe(2);
  });

  it('a request still waiting for its answer at the deadline is cut — its own signal aborts', async () => {
    const hanging = (): Promise<Response> => new Promise(() => undefined);
    const { fetch, inits } = runtime(hanging, { maxElapsedMs: 1_000 });

    // The caller's own signal never fires: only the deadline can stop this request.
    const pending = fetch(URL_, { ...POST, signal: new AbortController().signal });
    pending.catch(() => undefined);
    await flush();
    const signal = inits[0]?.signal;
    expect(signal?.aborted).toBe(false);

    await expect(drive(pending)).rejects.toThrow(/deadline/);
    expect(signal?.aborted).toBe(true);
  });
});

// ─── P5 Security — cancellation, and what onRetry may say ───────────

describe('retry series — P5 cancellation, and what onRetry may say', () => {
  it('cancellation ends a pending wait at once, and no further request is sent', async () => {
    const { fetch, calls } = runtime(busy, {
      baseDelayMs: 60_000,
      jitter: 'none',
      maxWaitMs: 600_000,
    });
    const controller = new AbortController();
    const reason = new Error('the user closed the tab');

    const pending = fetch(URL_, { ...POST, signal: controller.signal });
    await flush();
    expect(calls()).toBe(1);
    controller.abort(reason);

    // Rejected with the caller's own reason, the 60 s wait never sat out.
    await expect(pending).rejects.toBe(reason);
    await vi.runAllTimersAsync();
    expect(calls()).toBe(1);
  });

  it('an abort that lands as the wait ends still stops the next request', async () => {
    const stand = endpoint((n) => (n === 1 ? throttle('1') : served()));
    const fetch = retryingFetch(stand.fetch, true) as ThrottleFetch;
    const controller = new AbortController();

    const pending = fetch(URL_, { ...POST, signal: controller.signal });
    pending.catch(() => undefined);
    await flush();
    // The wait's timer fires (synchronously here), and the abort lands before
    // the series can take its next step.
    vi.advanceTimersByTime(1_000);
    controller.abort();

    await expect(pending).rejects.toThrow();
    await vi.runAllTimersAsync();
    expect(stand.calls()).toBe(1);
  });

  it('onRetry carries the kind, the attempt and the wait — never the arguments, the answer or the token', async () => {
    const ARG = 'ARG-SECRET-41d7';
    const RESULT = 'RESULT-SECRET-77c0';
    const replies = [
      () =>
        new Response(
          JSON.stringify({ jsonrpc: '2.0', id: 1, error: { ...BUSY, data: { note: RESULT } } }),
          { headers: { 'content-type': 'application/json' } },
        ),
      () =>
        new Response(JSON.stringify({ message: RESULT }), {
          status: 429,
          headers: { 'content-type': 'application/json', 'retry-after': '1' },
        }),
      () =>
        new Response(JSON.stringify({ jsonrpc: '2.0', id: 1, result: { text: RESULT } }), {
          headers: { 'content-type': 'application/json' },
        }),
    ];
    const reports: ThrottleRetryInfo[] = [];
    const { transport } = runtime((n) => replies[n - 1]!(), {
      onRetry: (info) => reports.push(info),
    });
    const fetch = retryingFetch(transport.fetch, {
      onRetry: (info) => reports.push(info),
    }) as ThrottleFetch;
    const body = JSON.stringify({
      jsonrpc: '2.0',
      id: 1,
      method: 'tools/call',
      params: { name: 'lookup', arguments: { order: ARG } },
    });

    await drive(fetch(transport.url, { method: 'POST', body }));

    expect(reports.map((r) => Object.keys(r).sort())).toEqual([
      ['attempt', 'kind', 'maxAttempts', 'url', 'waitMs'],
      ['attempt', 'kind', 'maxAttempts', 'retryAfterMs', 'url', 'waitMs'],
    ]);
    expect(reports.map((r) => r.kind)).toEqual(['session-busy', 'throttle']);
    const said = JSON.stringify(reports);
    expect(said).not.toContain(ARG);
    expect(said).not.toContain(RESULT);
    expect(said).not.toContain('TOKEN-SECRET');
  });
});
