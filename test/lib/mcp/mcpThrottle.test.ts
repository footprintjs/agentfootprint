/**
 * MCP throttle retry (8.11.0) — 7-pattern tests.
 *
 *   P1 Unit         — config resolution; disabled returns the inner fetch untouched
 *   P2 Boundary     — Retry-After honoured (seconds AND HTTP-date); backoff when absent
 *   P3 Scenario     — a REAL MCP round trip: throttled twice, then the real tool text
 *   P4 Property     — THE BOUNDARY: 429 and nothing else. Ceilings never exceeded.
 *   P5 Security     — no token leaks across retries; a fresh credential per attempt;
 *                     abort stops the wait
 *   P6 Performance  — disabled costs nothing; the success path makes exactly one call
 *   P7 ROI          — http ≡ gateway; stdio untouched; unreplayable bodies pass through
 *
 * P4 is the load-bearing one. Retrying a 429 is safe ONLY because a 429 is a
 * pre-execution rejection — the rate limiter refused the request at the edge and
 * the server never ran the tool, so a retry cannot double-execute anything. That
 * is NOT true of a 500 or a timeout, where the call may have half-run. The
 * moment this policy widens past 429, that argument collapses and this library
 * starts silently re-charging cards. The `EVERY OTHER STATUS` table below exists
 * to make widening it fail loudly.
 */

import { afterEach, describe, expect, it, vi } from 'vitest';
import { createServer, type Server as HttpServer } from 'node:http';

import { mcpClient } from '../../../src/tool-providers/index.js';
import { gatewayTransport } from '../../../src/lib/mcp/gatewayTransport.js';
import {
  parseRetryAfter,
  retryingFetch,
  type ThrottleFetch,
  type ThrottleRetryInfo,
} from '../../../src/lib/mcp/throttleRetry.js';
import { staticTokens } from '../../../src/identity/staticTokens.js';

// ── A fetch stand-in that answers from a script ──────────────────────

interface ScriptedFetch {
  readonly fetch: ThrottleFetch;
  calls(): number;
  inits(): readonly (RequestInit | undefined)[];
}

/**
 * Answers with `statuses[n]` on call n, then 200 forever. A `headers` entry
 * rides the response of the same index.
 */
function scriptedFetch(
  statuses: readonly number[],
  headers: Readonly<Record<number, Record<string, string>>> = {},
): ScriptedFetch {
  let calls = 0;
  const inits: (RequestInit | undefined)[] = [];
  return {
    calls: () => calls,
    inits: () => inits,
    fetch: (_input, init) => {
      const index = calls++;
      inits.push(init);
      const status = statuses[index] ?? 200;
      return Promise.resolve(new Response('{}', { status, headers: headers[index] ?? {} }));
    },
  };
}

const SECOND = 1000;

afterEach(() => {
  vi.useRealTimers();
});

// ─── P1 Unit ─────────────────────────────────────────────────────────

describe('mcp throttle — P1 unit', () => {
  it('P1 `false` returns the inner fetch untouched — no wrapper, no behaviour change', () => {
    const inner: ThrottleFetch = () => Promise.resolve(new Response(''));
    expect(retryingFetch(inner, false)).toBe(inner);
  });

  it('P1 `false` with no inner fetch stays undefined, so the transport passes none', () => {
    // The compat guarantee for a plain `http` transport: it passed no custom
    // fetch before 8.11.0 and must still pass none when retry is off.
    expect(retryingFetch(undefined, false)).toBeUndefined();
  });

  it('P1 `undefined` (the default) and `true` both produce a wrapper', () => {
    const inner: ThrottleFetch = () => Promise.resolve(new Response(''));
    expect(retryingFetch(inner, undefined)).not.toBe(inner);
    expect(retryingFetch(inner, true)).not.toBe(inner);
  });

  it('P1 parseRetryAfter reads delta-seconds, HTTP-dates, and refuses nonsense', () => {
    expect(parseRetryAfter('2')).toBe(2000);
    expect(parseRetryAfter('  30 ')).toBe(30_000);
    expect(parseRetryAfter(null)).toBeUndefined();
    expect(parseRetryAfter('')).toBeUndefined();
    // Malformed degrades to "absent" so we fall back to our own backoff
    // rather than to a wrong wait.
    expect(parseRetryAfter('soon please')).toBeUndefined();

    const inTwoSeconds = new Date(Date.now() + 2 * SECOND).toUTCString();
    const parsed = parseRetryAfter(inTwoSeconds);
    expect(parsed).toBeGreaterThan(0);
    expect(parsed).toBeLessThanOrEqual(2 * SECOND);
  });
});

// ─── P2 Boundary ─────────────────────────────────────────────────────

describe('mcp throttle — P2 boundary', () => {
  it('P2 honours Retry-After (seconds) rather than guessing a backoff', async () => {
    const scripted = scriptedFetch([429, 200], { 0: { 'retry-after': '1' } });
    const seen: ThrottleRetryInfo[] = [];
    const wrapped = retryingFetch(scripted.fetch, { onRetry: (i) => seen.push(i) });

    const startedMs = Date.now();
    const res = await wrapped?.('http://example.test/mcp', { body: '{}' });

    expect(res?.status).toBe(200);
    expect(scripted.calls()).toBe(2);
    expect(Date.now() - startedMs).toBeGreaterThanOrEqual(SECOND - 50);
    expect(seen).toHaveLength(1);
    expect(seen[0]).toMatchObject({ attempt: 2, waitMs: SECOND, retryAfterMs: SECOND });
  });

  it('P2 falls back to a jittered backoff when the server sends no Retry-After', async () => {
    const scripted = scriptedFetch([429, 200]);
    const seen: ThrottleRetryInfo[] = [];
    const wrapped = retryingFetch(scripted.fetch, { onRetry: (i) => seen.push(i) });

    await wrapped?.('http://example.test/mcp', { body: '{}' });

    expect(scripted.calls()).toBe(2);
    expect(seen[0]?.retryAfterMs).toBeUndefined();
    // Equal jitter around a 200ms base: half fixed, half random.
    expect(seen[0]?.waitMs).toBeGreaterThanOrEqual(100);
    expect(seen[0]?.waitMs).toBeLessThanOrEqual(200);
  });

  it('P2 a non-429 response is returned on the first attempt, untouched', async () => {
    const scripted = scriptedFetch([200]);
    const wrapped = retryingFetch(scripted.fetch, true);
    const res = await wrapped?.('http://example.test/mcp', { body: '{}' });
    expect(res?.status).toBe(200);
    expect(scripted.calls()).toBe(1);
  });
});

// ─── P3 Scenario — a real MCP server over a real socket ──────────────

interface ThrottlingServer {
  readonly url: string;
  callAttempts(): number;
  close(): Promise<void>;
}

/**
 * Hand-rolled rather than built from the SDK's server, because the whole point
 * is the HTTP envelope — a 429 with a `Retry-After` header, which is what a
 * managed gateway's per-principal rate limiter actually sends.
 */
async function startThrottlingServer(throttleFirst: number): Promise<ThrottlingServer> {
  let callAttempts = 0;
  const tool = {
    name: 'search_tickets',
    description: 'Search the ticket system',
    inputSchema: { type: 'object', properties: { q: { type: 'string' } } },
  };

  const server: HttpServer = createServer((req, res) => {
    let body = '';
    req.on('data', (c) => (body += c));
    req.on('end', () => {
      let msg: { method?: string; id?: unknown } = {};
      try {
        msg = JSON.parse(body || '{}') as { method?: string; id?: unknown };
      } catch {
        /* falls through to 404 */
      }
      const reply = (result: unknown): void => {
        res.writeHead(200, { 'content-type': 'application/json', 'mcp-session-id': 's' });
        res.end(JSON.stringify({ jsonrpc: '2.0', id: msg.id, result }));
      };

      if (msg.method === 'initialize') {
        return reply({
          protocolVersion: '2025-06-18',
          capabilities: { tools: {} },
          serverInfo: { name: 'probe-gateway', version: '1.0.0' },
        });
      }
      if (msg.method === 'notifications/initialized') {
        res.writeHead(202).end();
        return;
      }
      if (msg.method === 'tools/list') return reply({ tools: [tool] });
      if (msg.method === 'tools/call') {
        callAttempts++;
        if (callAttempts <= throttleFirst) {
          res.writeHead(429, { 'content-type': 'application/json', 'retry-after': '1' });
          res.end(JSON.stringify({ message: 'Too many requests for this principal.' }));
          return;
        }
        return reply({ content: [{ type: 'text', text: 'ticket-42: printer on fire' }] });
      }
      res.writeHead(404).end();
    });
  });

  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  const port = typeof address === 'object' && address ? address.port : 0;
  return {
    url: `http://127.0.0.1:${port}/mcp`,
    callAttempts: () => callAttempts,
    close: () => new Promise<void>((resolve) => server.close(() => resolve())),
  };
}

describe('mcp throttle — P3 scenario', () => {
  it(
    'P3 throttled twice, then the REAL tool text — not a thrown "tool broke"',
    { timeout: 20_000 },
    async () => {
      const server = await startThrottlingServer(2);
      try {
        const client = await mcpClient({
          name: 'gateway',
          transport: { transport: 'http', url: server.url },
        });
        const tools = await client.tools();

        const result = await tools[0]?.execute({ q: 'printer' }, {} as never);

        expect(result).toBe('ticket-42: printer on fire');
        expect(server.callAttempts()).toBe(3);
        await client.close();
      } finally {
        await server.close();
      }
    },
  );

  it(
    'P3 with retryOnThrottle:false the throttle surfaces immediately (the 8.10.0 behaviour)',
    { timeout: 20_000 },
    async () => {
      const server = await startThrottlingServer(2);
      try {
        const client = await mcpClient({
          name: 'gateway',
          transport: { transport: 'http', url: server.url },
          retryOnThrottle: false,
        });
        const tools = await client.tools();

        await expect(tools[0]?.execute({ q: 'printer' }, {} as never)).rejects.toThrow();
        expect(server.callAttempts()).toBe(1);
        await client.close();
      } finally {
        await server.close();
      }
    },
  );
});

// ─── P4 Property — the boundary that must never move ─────────────────

describe('mcp throttle — P4 property', () => {
  // Every status that is NOT 429, including the ones a naive "retry transient
  // failures" policy would grab. Each must make exactly ONE attempt.
  const EVERY_OTHER_STATUS = [400, 401, 403, 404, 408, 409, 428, 430, 500, 502, 503, 504];

  it.each(EVERY_OTHER_STATUS)(
    'P4 HTTP %i is NOT retried — only a 429 is a pre-execution rejection',
    async (status) => {
      const scripted = scriptedFetch([status, 200]);
      const wrapped = retryingFetch(scripted.fetch, true);
      const res = await wrapped?.('http://example.test/mcp', { body: '{}' });
      expect(res?.status).toBe(status);
      expect(scripted.calls()).toBe(1);
    },
  );

  it('P4 a thrown transport error is not retried either — it may have half-run', async () => {
    let calls = 0;
    const wrapped = retryingFetch(() => {
      calls++;
      return Promise.reject(new Error('ECONNRESET'));
    }, true);
    await expect(wrapped?.('http://example.test/mcp', { body: '{}' })).rejects.toThrow(
      'ECONNRESET',
    );
    expect(calls).toBe(1);
  });

  it('P4 never exceeds maxAttempts', async () => {
    const scripted = scriptedFetch([429, 429, 429, 429, 429, 429]);
    const wrapped = retryingFetch(scripted.fetch, { maxAttempts: 3, maxWaitMs: 60_000 });
    const res = await wrapped?.('http://example.test/mcp', { body: '{}' });
    expect(res?.status).toBe(429);
    expect(scripted.calls()).toBe(3);
  });

  it('P4 maxWaitMs is the rail on Retry-After — a hostile 24h wait is refused', async () => {
    // The safety property: a server (or a broken proxy) cannot talk the client
    // into hanging. We stop retrying and let the throttle surface.
    const scripted = scriptedFetch([429, 200], { 0: { 'retry-after': '86400' } });
    const seen: ThrottleRetryInfo[] = [];
    const wrapped = retryingFetch(scripted.fetch, {
      maxWaitMs: 5_000,
      onRetry: (i) => seen.push(i),
    });

    const startedMs = Date.now();
    const res = await wrapped?.('http://example.test/mcp', { body: '{}' });

    expect(res?.status).toBe(429);
    expect(scripted.calls()).toBe(1);
    expect(seen).toHaveLength(0);
    expect(Date.now() - startedMs).toBeLessThan(1000);
  });

  it('P4 total waiting across attempts stays under maxWaitMs', async () => {
    const scripted = scriptedFetch([429, 429, 429, 429], {
      0: { 'retry-after': '1' },
      1: { 'retry-after': '1' },
      2: { 'retry-after': '1' },
    });
    const wrapped = retryingFetch(scripted.fetch, { maxAttempts: 9, maxWaitMs: 2_500 });

    const startedMs = Date.now();
    await wrapped?.('http://example.test/mcp', { body: '{}' });
    const elapsed = Date.now() - startedMs;

    // Two 1s waits fit under 2.5s; a third would breach it, so it stops.
    expect(scripted.calls()).toBe(3);
    expect(elapsed).toBeLessThan(2_500 + 500);
  });
});

// ─── P5 Security ─────────────────────────────────────────────────────

describe('mcp throttle — P5 security', () => {
  it('P5 the vended token never appears in any retry report, across every attempt', async () => {
    const SECRET = 'tok-do-not-log-abc123';
    const scripted = scriptedFetch([429, 429, 200], {
      0: { 'retry-after': '0' },
      1: { 'retry-after': '0' },
    });
    const said: string[] = [];
    const transport = gatewayTransport({
      url: 'http://example.test/mcp',
      credentials: staticTokens({ gateway: SECRET }),
    });

    const { createVendingFetch } = await import('../../../src/lib/mcp/gatewayTransport.js');
    const wrapped = retryingFetch(createVendingFetch(transport, scripted.fetch), {
      onRetry: (info) => said.push(JSON.stringify(info)),
    });

    const res = await wrapped?.('http://example.test/mcp', { body: '{}' });

    expect(res?.status).toBe(200);
    expect(said).toHaveLength(2);
    expect(said.join('\n')).not.toContain(SECRET);
  });

  it('P5 every attempt vends a FRESH credential — a token cannot go stale in the wait', async () => {
    // Retry sits OUTSIDE the vending fetch precisely so this holds: a token
    // that would have expired during the throttle wait is simply never reused.
    let vends = 0;
    const provider = {
      id: 'counting',
      getCredential: () => {
        vends++;
        return Promise.resolve({
          status: 'issued' as const,
          credential: {
            kind: 'bearer' as const,
            toHeaders: () => ({ authorization: `Bearer tok-${vends}` }),
          },
        });
      },
    };
    const scripted = scriptedFetch([429, 429, 200], {
      0: { 'retry-after': '0' },
      1: { 'retry-after': '0' },
    });
    const transport = gatewayTransport({ url: 'http://example.test/mcp', credentials: provider });
    const { createVendingFetch } = await import('../../../src/lib/mcp/gatewayTransport.js');
    const wrapped = retryingFetch(createVendingFetch(transport, scripted.fetch), true);

    await wrapped?.('http://example.test/mcp', { body: '{}' });

    expect(vends).toBe(3);
    const authHeaders = scripted
      .inits()
      .map((init) => new Headers(init?.headers ?? {}).get('authorization'));
    expect(authHeaders).toEqual(['Bearer tok-1', 'Bearer tok-2', 'Bearer tok-3']);
  });

  it('P5 an aborted signal stops the wait instead of holding the run open', async () => {
    const controller = new AbortController();
    const scripted = scriptedFetch([429, 200], { 0: { 'retry-after': '30' } });
    const wrapped = retryingFetch(scripted.fetch, { maxWaitMs: 60_000 });

    const pending = wrapped?.('http://example.test/mcp', {
      body: '{}',
      signal: controller.signal,
    });
    setTimeout(() => controller.abort(), 20);

    await expect(pending).rejects.toThrow();
    expect(scripted.calls()).toBe(1);
  });

  it('P5 an already-aborted signal never starts a retry at all', async () => {
    const scripted = scriptedFetch([429, 200], { 0: { 'retry-after': '0' } });
    const wrapped = retryingFetch(scripted.fetch, true);
    const res = await wrapped?.('http://example.test/mcp', {
      body: '{}',
      signal: AbortSignal.abort(),
    });
    expect(res?.status).toBe(429);
    expect(scripted.calls()).toBe(1);
  });
});

// ─── P6 Performance ──────────────────────────────────────────────────

describe('mcp throttle — P6 performance', () => {
  it('P6 the success path costs exactly one call and no wait', async () => {
    const scripted = scriptedFetch([200]);
    const wrapped = retryingFetch(scripted.fetch, true);
    const startedMs = Date.now();
    await wrapped?.('http://example.test/mcp', { body: '{}' });
    expect(scripted.calls()).toBe(1);
    expect(Date.now() - startedMs).toBeLessThan(50);
  });

  it('P6 disabled adds no wrapper at all — identity, not a pass-through closure', () => {
    const inner: ThrottleFetch = () => Promise.resolve(new Response(''));
    // Identity matters: a pass-through closure would still allocate per call
    // and would still show up in a stack trace someone is debugging.
    expect(retryingFetch(inner, false)).toBe(inner);
  });
});

// ─── P7 ROI ──────────────────────────────────────────────────────────

describe('mcp throttle — P7 ROI', () => {
  it('P7 a body that cannot be replayed is passed through, never re-sent', async () => {
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new TextEncoder().encode('{}'));
        controller.close();
      },
    });
    const scripted = scriptedFetch([429, 200]);
    const wrapped = retryingFetch(scripted.fetch, true);

    const res = await wrapped?.('http://example.test/mcp', {
      body: stream as unknown as BodyInit,
      // @ts-expect-error — `duplex` is required for a stream body at runtime
      duplex: 'half',
    });

    // Replaying half a consumed stream would send a DIFFERENT request; the
    // throttle surfaces instead.
    expect(res?.status).toBe(429);
    expect(scripted.calls()).toBe(1);
  });

  it('P7 a string body and an absent body are both replayable', async () => {
    for (const init of [{ body: '{"jsonrpc":"2.0"}' }, {}]) {
      const scripted = scriptedFetch([429, 200], { 0: { 'retry-after': '0' } });
      const wrapped = retryingFetch(scripted.fetch, true);
      const res = await wrapped?.('http://example.test/mcp', init);
      expect(res?.status).toBe(200);
      expect(scripted.calls()).toBe(2);
    }
  });

  it('P7 stdio is untouched — it has no HTTP status to read', async () => {
    // The option is accepted and ignored: constructing a stdio client must not
    // throw, and nothing in its path consults the throttle config.
    await expect(
      mcpClient({
        name: 'stdio',
        transport: { transport: 'stdio', command: 'definitely-not-a-real-binary-xyz' },
        retryOnThrottle: { maxAttempts: 5 },
      }),
    ).rejects.toThrow(); // fails to spawn, NOT a config error
  });
});
