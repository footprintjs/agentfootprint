/**
 * Saved retry evidence — an MCP request's retry series, filed into the run that
 * dispatched the call, and still there after the run is saved and re-read.
 *
 * Every test here goes through a REAL `Agent`, the REAL `mcpClient` and the
 * REAL MCP SDK transport; only the server is a stand-in `fetch` in this
 * process. Each run is written to disk by `persistRecording` and parsed back,
 * so what is asserted is what a reader of the archive gets.
 *
 *   S1 Scenario  — every attempt, its reason and its wait, and how it ended
 *   S2 Scenario  — a cancellation DURING A WAIT is in the saved run
 *   S3 Scenario  — a cancellation during a request in flight, too
 *   S4 Boundary  — a 503 received is `answered` + 503, never success, never retried
 *   S5 Property  — concurrent runs on ONE connection never mix their attempts
 *   S6 Boundary  — past 100 attempts, the rest are COUNTED, never dropped
 *   S7 Security  — a thrown error's text and the URL's path never reach the run
 *   S8 ROI       — AgentCore Runtime's session-busy series files the same way
 *   S9 Unit      — concurrent calls on one connection, each to its own port
 *   S10 Security — under the app's redaction rule the evidence keeps its words
 *                  and numbers; the names the app declared are its to serve
 *   S11 Boundary — the deadline cuts a request: `timed-out`, `no-time-left`
 *   S12 Boundary — a stated wait past the budget is never shortened: `wait-limit`
 *
 * The series is the one retry owner (`mcp/throttleRetry.ts` · `Series`); these
 * tests pin that its OWN attempt records reach the call's run — no second loop.
 */

import { afterEach, describe, expect, it } from 'vitest';
import { mkdtempSync, readFileSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { Agent } from '../../src/index.js';
import { mock } from '../../src/adapters/llm/MockProvider.js';
import { mcpClient } from '../../src/tool-providers/index.js';
import { agentCoreRuntimeMcpTransport } from '../../src/adapters/mcp/agentcoreRuntime/transport.js';
import { staticTokens } from '../../src/identity/staticTokens.js';
import { recordRun, type RunRecorder } from '../../src/recorders/observability/recordRun.js';
import { persistRecording } from '../../src/recorders/observability/recordingEnvelope.js';
import { fileRecordingSink } from '../../src/recorders/observability/fileRecordingSink.js';
import { REQUEST_EVIDENCE, type RequestEvidence } from '../../src/tools/requestEvidence.js';
import type { McpClient } from '../../src/mcp/types.js';
import type { ToolsRequestAttemptsPayload } from '../../src/events/payloads.js';
import type { ToolExecutionContext } from '../../src/tools/tools.js';

const URL_ = 'http://mcp.example.test/mcp';
const EVIDENCE = 'agentfootprint.tools.request_attempts';

const TOOL = {
  name: 'search_tickets',
  description: 'Search the ticket system',
  inputSchema: { type: 'object', properties: { q: { type: 'string' } } },
};

// ── The stand-in server ──────────────────────────────────────────────

const json = (body: unknown, status = 200, headers: Record<string, string> = {}): Response =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json', ...headers },
  });

const answered = (id: unknown): Response =>
  json({ jsonrpc: '2.0', id, result: { content: [{ type: 'text', text: 'ticket-42' }] } });

const throttled = (retryAfter?: string): Response =>
  json(
    { message: 'Too many requests' },
    429,
    retryAfter === undefined ? {} : { 'retry-after': retryAfter },
  );

const unavailable = (): Response => json({ message: 'upstream unavailable' }, 503);

const busy = (id: unknown): Response =>
  json({
    jsonrpc: '2.0',
    id,
    error: { code: -32005, message: 'Session operation in progress, please retry' },
  });

/** One `tools/call` as the stand-in sees it: its id, its `q`, and its count per `q`. */
interface Call {
  readonly id: unknown;
  readonly q: unknown;
  readonly n: number;
  readonly signal: AbortSignal | null | undefined;
}

/** An MCP endpoint in this process: the handshake, the tool list, and `reply` for each call. */
function mcpEndpoint(reply: (call: Call) => Response | Promise<Response>) {
  const perQ = new Map<unknown, number>();
  let calls = 0;
  // Typed for both doors it is handed to: the MCP SDK's fetch and AgentCore's auth fetch.
  const fetch = async (_input: unknown, init?: RequestInit): Promise<Response> => {
    if ((init?.method ?? 'GET').toUpperCase() !== 'POST')
      return new Response(null, { status: 405 });
    const message = JSON.parse(String(init?.body)) as {
      method?: string;
      id?: unknown;
      params?: { arguments?: { q?: unknown } };
    };
    const result = (value: unknown): Response =>
      json({ jsonrpc: '2.0', id: message.id, result: value });
    switch (message.method) {
      case 'initialize':
        return result({
          protocolVersion: '2025-06-18',
          capabilities: { tools: {} },
          serverInfo: { name: 'tickets', version: '1.0.0' },
        });
      case 'notifications/initialized':
        return new Response(null, { status: 202 });
      case 'tools/list':
        return result({ tools: [TOOL] });
      case 'tools/call': {
        calls += 1;
        const q = message.params?.arguments?.q;
        const n = (perQ.get(q) ?? 0) + 1;
        perQ.set(q, n);
        return reply({ id: message.id, q, n, signal: init?.signal });
      }
      default:
        return new Response(null, { status: 404 });
    }
  };
  return { fetch, toolCalls: () => calls };
}

/** A request that hangs until its signal fires — the way a real fetch ends then. */
const hangs = (signal: AbortSignal | null | undefined): Promise<Response> =>
  new Promise((_resolve, reject) => {
    signal?.addEventListener('abort', () => reject(signal.reason), { once: true });
  });

// ── The agent, the run, the archive ──────────────────────────────────

async function agentFor(
  client: McpClient,
  toolCallId: string,
  q: string,
  redact?: { readonly keys: readonly string[] },
): Promise<Agent> {
  return Agent.create({
    provider: mock({
      replies: [
        { toolCalls: [{ id: toolCallId, name: 'search_tickets', args: { q } }] },
        { content: 'done' },
      ],
    }),
    model: 'mock',
    maxIterations: 3,
    ...(redact !== undefined && { redact: { keys: [...redact.keys] } }),
  })
    .system('You search tickets.')
    .tools(await client.tools())
    .build();
}

interface Row {
  readonly type: string;
  readonly payload: Record<string, unknown>;
  readonly meta: { readonly runId: string };
}

const dirs: string[] = [];
afterEach(() => {
  while (dirs.length > 0) rmSync(dirs.pop() as string, { recursive: true, force: true });
});

/** Write the run to disk the way an app archives it, and read the bytes back. */
async function savedAndReloaded(rec: RunRecorder): Promise<readonly Row[]> {
  const directory = mkdtempSync(join(tmpdir(), 'afp-request-evidence-'));
  dirs.push(directory);
  await persistRecording(rec, { sink: fileRecordingSink({ directory }), run: { complete: true } });
  rec.stop();
  const files = readdirSync(directory).filter((f) => f.endsWith('.json'));
  expect(files).toHaveLength(1);
  const envelope = JSON.parse(readFileSync(join(directory, files[0] as string), 'utf8')) as {
    recording: { events: Row[] };
  };
  return envelope.recording.events;
}

const filedIn = (events: readonly Row[]) => events.filter((e) => e.type === EVIDENCE);

const payloadOf = (row: Row | undefined): ToolsRequestAttemptsPayload => {
  expect(row, 'no request_attempts event in the saved run').toBeDefined();
  return row?.payload as unknown as ToolsRequestAttemptsPayload;
};

/** Resolves the first time `onRetry` fires — the series is then waiting. */
function firstWait(): { readonly onRetry: () => void; readonly entered: Promise<void> } {
  let resolve!: () => void;
  const entered = new Promise<void>((r) => (resolve = r));
  return { onRetry: () => resolve(), entered };
}

async function until(condition: () => boolean): Promise<void> {
  for (let i = 0; i < 2000 && !condition(); i++) {
    await new Promise<void>((r) => setImmediate(r));
  }
  expect(condition(), 'the condition never held').toBe(true);
}

const RATE_LIMITED = {
  outcome: 'refused',
  reason: 'retryable',
  status: 429,
  kind: 'throttle',
  failure: 'rate-limited',
} as const;

// ─── S1 every attempt, its reason and its wait ───────────────────────

describe('saved retry evidence — S1 the saved run gives back every attempt', () => {
  it('every attempt with its reason and its wait, and how the request ended', async () => {
    const endpoint = mcpEndpoint(({ id, n }) => (n <= 2 ? throttled() : answered(id)));
    const client = await mcpClient({
      name: 'tickets',
      transport: { transport: 'http', url: URL_, fetch: endpoint.fetch },
      retryOnThrottle: { baseDelayMs: 10, jitter: 'none', endpointLabel: 'tickets-gateway' },
    });
    try {
      const agent = await agentFor(client, 'tc-1', 'printer');
      const rec = recordRun(agent);
      await agent.run({ message: 'find the printer ticket' });
      const events = await savedAndReloaded(rec);

      const filed = filedIn(events);
      expect(filed).toHaveLength(1);
      const start = events.find((e) => e.type === 'agentfootprint.stream.tool_start');
      expect(payloadOf(filed[0])).toEqual({
        toolCallId: 'tc-1',
        toolName: 'search_tickets',
        iteration: start?.payload.iteration ?? 1,
        endpoint: 'tickets-gateway',
        attempts: [
          { attempt: 1, ...RATE_LIMITED, waitMs: 10 },
          { attempt: 2, ...RATE_LIMITED, waitMs: 20 },
          { attempt: 3, outcome: 'answered', reason: 'answered', status: 200 },
        ],
        omitted: 0,
        end: { outcome: 'answered', reason: 'answered', status: 200 },
      });
      expect(endpoint.toolCalls()).toBe(3);
      // The same run, the same call: stamped from the dispatch, never by the series.
      expect(filed[0]?.meta.runId).toBe(start?.meta.runId);
      // Filed while the call ran — before its `tool_end`.
      const at = (type: string) => events.findIndex((e) => e.type === type);
      expect(at(EVIDENCE)).toBeGreaterThan(at('agentfootprint.stream.tool_start'));
      expect(at(EVIDENCE)).toBeLessThan(at('agentfootprint.stream.tool_end'));
    } finally {
      await client.close();
    }
  });
});

// ─── S2 / S3 cancellation ────────────────────────────────────────────

describe('saved retry evidence — S2/S3 a cancelled run still carries its request', () => {
  it('S2 a cancellation DURING A WAIT: the stated wait, then `cancelled` during `wait`', async () => {
    const endpoint = mcpEndpoint(({ id, n }) => (n === 1 ? throttled('30') : answered(id)));
    const wait = firstWait();
    const client = await mcpClient({
      name: 'tickets',
      transport: { transport: 'http', url: URL_, fetch: endpoint.fetch },
      retryOnThrottle: { maxWaitMs: 60_000, onRetry: wait.onRetry },
    });
    try {
      const agent = await agentFor(client, 'tc-wait', 'printer');
      const rec = recordRun(agent);
      const controller = new AbortController();
      const run = agent.run({ message: 'find it' }, { signal: controller.signal });
      await wait.entered;
      // The host cancels the run and saves it IN THE SAME BREATH — what a
      // disconnect handler does. The cancellation must already be on the record.
      controller.abort(new Error('the person left'));
      const saving = savedAndReloaded(rec);
      await expect(run).rejects.toThrow('the person left');
      const events = await saving;

      expect(filedIn(events).map(payloadOf)).toEqual([
        {
          toolCallId: 'tc-wait',
          toolName: 'search_tickets',
          iteration: expect.any(Number),
          origin: 'http://mcp.example.test',
          attempts: [{ attempt: 1, ...RATE_LIMITED, waitMs: 30_000, retryAfterMs: 30_000 }],
          omitted: 0,
          end: { outcome: 'cancelled', reason: 'cancelled', during: 'wait' },
        },
      ]);
      expect(endpoint.toolCalls()).toBe(1);
    } finally {
      await client.close();
    }
  });

  it('S3 a cancellation during a request in flight: `cancelled` during `request`', async () => {
    const endpoint = mcpEndpoint(({ n, signal }) => (n === 1 ? throttled() : hangs(signal)));
    const client = await mcpClient({
      name: 'tickets',
      transport: { transport: 'http', url: URL_, fetch: endpoint.fetch },
      retryOnThrottle: { baseDelayMs: 5, jitter: 'none' },
    });
    try {
      const agent = await agentFor(client, 'tc-flight', 'printer');
      const rec = recordRun(agent);
      const controller = new AbortController();
      const run = agent.run({ message: 'find it' }, { signal: controller.signal });
      await until(() => endpoint.toolCalls() === 2);
      controller.abort(new Error('deadline for the person'));
      const saving = savedAndReloaded(rec);
      await expect(run).rejects.toThrow('deadline for the person');
      const events = await saving;

      const evidence = payloadOf(filedIn(events)[0]);
      expect(evidence.attempts).toEqual([{ attempt: 1, ...RATE_LIMITED, waitMs: 5 }]);
      expect(evidence.end).toEqual({
        outcome: 'cancelled',
        reason: 'cancelled',
        during: 'request',
      });
    } finally {
      await client.close();
    }
  });
});

// ─── S4 a response received is not success ───────────────────────────

describe('saved retry evidence — S4 a 503 received is not an operation that succeeded', () => {
  it('a 503 is `answered` with its status — never success, and never retried', async () => {
    const endpoint = mcpEndpoint(() => unavailable());
    const client = await mcpClient({
      name: 'tickets',
      transport: { transport: 'http', url: URL_, fetch: endpoint.fetch },
    });
    try {
      const agent = await agentFor(client, 'tc-503', 'printer');
      const rec = recordRun(agent);
      await agent.run({ message: 'find it' });
      const evidence = payloadOf(filedIn(await savedAndReloaded(rec))[0]);

      expect(evidence.attempts).toEqual([
        { attempt: 1, outcome: 'answered', reason: 'answered', status: 503 },
      ]);
      expect(evidence.end).toEqual({ outcome: 'answered', reason: 'answered', status: 503 });
      expect(JSON.stringify(evidence)).not.toMatch(/succe|"ok"/);
      // The boundary never moves: a 503 is delivered, not asked again.
      expect(endpoint.toolCalls()).toBe(1);
    } finally {
      await client.close();
    }
  });
});

// ─── S5 concurrent runs on one connection ────────────────────────────

describe('saved retry evidence — S5 concurrent runs on one connection stay separate', () => {
  it('two runs sharing one MCP client each save exactly their own attempts', async () => {
    // `alpha` is throttled twice while `beta` is sent and answered: their
    // requests interleave on ONE connection, and each run must get its own.
    const endpoint = mcpEndpoint(({ id, q, n }) =>
      q === 'alpha' && n <= 2 ? throttled() : answered(id),
    );
    const client = await mcpClient({
      name: 'tickets',
      transport: { transport: 'http', url: URL_, fetch: endpoint.fetch },
      retryOnThrottle: { baseDelayMs: 15, jitter: 'none' },
    });
    try {
      const alpha = await agentFor(client, 'tc-alpha', 'alpha');
      const beta = await agentFor(client, 'tc-beta', 'beta');
      const recAlpha = recordRun(alpha);
      const recBeta = recordRun(beta);
      await Promise.all([alpha.run({ message: 'a' }), beta.run({ message: 'b' })]);
      const savedAlpha = filedIn(await savedAndReloaded(recAlpha));
      const savedBeta = filedIn(await savedAndReloaded(recBeta));

      expect(savedAlpha.map((e) => e.payload.toolCallId)).toEqual(['tc-alpha']);
      expect(payloadOf(savedAlpha[0]).attempts.map((r) => r.outcome)).toEqual([
        'refused',
        'refused',
        'answered',
      ]);
      expect(savedBeta.map((e) => e.payload.toolCallId)).toEqual(['tc-beta']);
      expect(payloadOf(savedBeta[0]).attempts).toEqual([
        { attempt: 1, outcome: 'answered', reason: 'answered', status: 200 },
      ]);
      expect(savedAlpha[0]?.meta.runId).not.toBe(savedBeta[0]?.meta.runId);
      expect(endpoint.toolCalls()).toBe(4);
    } finally {
      await client.close();
    }
  });
});

// ─── S6 the cap counts what it does not list ─────────────────────────

describe('saved retry evidence — S6 omitted attempts are counted', () => {
  it('105 attempts: the first 100 listed, 5 counted in `omitted`, the end kept', async () => {
    const endpoint = mcpEndpoint(() => throttled());
    const client = await mcpClient({
      name: 'tickets',
      transport: { transport: 'http', url: URL_, fetch: endpoint.fetch },
      retryOnThrottle: { maxAttempts: 105, baseDelayMs: 0, jitter: 'none' },
    });
    try {
      const agent = await agentFor(client, 'tc-many', 'printer');
      const rec = recordRun(agent);
      await agent.run({ message: 'find it' });
      const evidence = payloadOf(filedIn(await savedAndReloaded(rec))[0]);

      expect(endpoint.toolCalls()).toBe(105);
      expect(evidence.attempts).toHaveLength(100);
      expect(evidence.attempts[99]?.attempt).toBe(100);
      expect(evidence.omitted).toBe(5);
      expect(evidence.attempts.length + evidence.omitted).toBe(endpoint.toolCalls());
      expect(evidence.end).toEqual({
        outcome: 'refused',
        reason: 'exhausted',
        status: 429,
        kind: 'throttle',
        failure: 'rate-limited',
      });
    } finally {
      await client.close();
    }
  });
});

// ─── S7 what the record may hold ─────────────────────────────────────

describe('saved retry evidence — S7 allow-listed metadata only', () => {
  it("a thrown error is a fixed sentence and a code; the URL is its origin; neither's text is kept", async () => {
    const endpoint = mcpEndpoint(() => {
      throw new TypeError('fetch failed: connect ECONNREFUSED 10.0.0.7:8443 token=SECRET-ERR');
    });
    const client = await mcpClient({
      name: 'tickets',
      transport: {
        transport: 'http',
        url: 'https://mcp.example.test:8443/tenant/acme/mcp?token=SECRET-QUERY',
        fetch: endpoint.fetch,
      },
    });
    try {
      const agent = await agentFor(client, 'tc-thrown', 'printer');
      const rec = recordRun(agent);
      await agent.run({ message: 'find it' });
      const evidence = payloadOf(filedIn(await savedAndReloaded(rec))[0]);

      expect(evidence.origin).toBe('https://mcp.example.test:8443');
      expect(evidence.endpoint).toBeUndefined();
      const [row] = evidence.attempts;
      expect(row).toMatchObject({ attempt: 1, outcome: 'failed', reason: 'not-retryable' });
      expect(row?.error).toEqual({
        message: 'The request failed before an answer arrived. Its error is not kept.',
        code: row?.failure,
      });
      expect(evidence.end).toMatchObject({ outcome: 'failed', reason: 'not-retryable' });
      const text = JSON.stringify(evidence);
      for (const leaked of [
        'SECRET',
        'acme',
        'tenant',
        '10.0.0.7',
        'ECONNREFUSED',
        'fetch failed',
      ]) {
        expect(text).not.toContain(leaked);
      }
      expect(endpoint.toolCalls()).toBe(1);
    } finally {
      await client.close();
    }
  });
});

// ─── S8 the AgentCore Runtime series ─────────────────────────────────

describe('saved retry evidence — S8 a transport that retries its own refusal files too', () => {
  it("AgentCore Runtime's session-busy retries are rows of the same one series", async () => {
    const endpoint = mcpEndpoint(({ id, n }) => (n <= 2 ? busy(id) : answered(id)));
    const transport = agentCoreRuntimeMcpTransport({
      agentRuntimeArn: 'arn:aws:bedrock-agentcore:us-west-2:123456789012:runtime/orders_mcp-a1b2c3',
      region: 'us-west-2',
      retry: { baseDelayMs: 5, jitter: 'none', endpointLabel: 'orders-runtime' },
      auth: { bearer: staticTokens({ runtime: 'TOKEN-SECRET-9f2' }), fetch: endpoint.fetch },
    });
    const client = await mcpClient({ name: 'orders', transport });
    try {
      const agent = await agentFor(client, 'tc-busy', 'printer');
      const rec = recordRun(agent);
      await agent.run({ message: 'find it' });
      const evidence = payloadOf(filedIn(await savedAndReloaded(rec))[0]);

      expect(evidence.endpoint).toBe('orders-runtime');
      expect(evidence.attempts.map((r) => [r.attempt, r.outcome, r.kind, r.waitMs])).toEqual([
        [1, 'refused', 'session-busy', 5],
        [2, 'refused', 'session-busy', 10],
        [3, 'answered', undefined, undefined],
      ]);
      expect(evidence.end).toEqual({ outcome: 'answered', reason: 'answered', status: 200 });
      expect(JSON.stringify(evidence)).not.toContain('TOKEN-SECRET');
    } finally {
      await client.close();
    }
  });
});

// ─── S9 concurrent calls, one connection ─────────────────────────────

describe('saved retry evidence — S9 concurrent calls on one connection', () => {
  it('two calls in flight at once each file only their own attempts, to their own port', async () => {
    const endpoint = mcpEndpoint(({ id, q, n }) =>
      q === 'slow' && n <= 2 ? throttled() : answered(id),
    );
    const client = await mcpClient({
      name: 'tickets',
      transport: { transport: 'http', url: URL_, fetch: endpoint.fetch },
      retryOnThrottle: { baseDelayMs: 10, jitter: 'none' },
    });
    try {
      const [tool] = await client.tools();
      // Each call's own port, as the dispatcher builds one per call: what lands
      // in it is what that call's run would get.
      const filings: { readonly port: string; readonly evidence: RequestEvidence }[] = [];
      const ctxFor = (toolCallId: string) =>
        ({
          toolCallId,
          iteration: 1,
          [REQUEST_EVIDENCE]: {
            file: (evidence: RequestEvidence) => filings.push({ port: toolCallId, evidence }),
          },
        } as unknown as ToolExecutionContext);
      await Promise.all([
        tool?.execute({ q: 'slow' }, ctxFor('call-slow')),
        tool?.execute({ q: 'fast' }, ctxFor('call-fast')),
      ]);

      expect(filings.map((f) => f.port).sort()).toEqual(['call-fast', 'call-slow']);
      const slow = filings.find((f) => f.port === 'call-slow')?.evidence;
      const fast = filings.find((f) => f.port === 'call-fast')?.evidence;
      expect(slow?.attempts.map((r) => r.outcome)).toEqual(['refused', 'refused', 'answered']);
      expect(fast?.attempts.map((r) => r.outcome)).toEqual(['answered']);
      expect(endpoint.toolCalls()).toBe(4);
    } finally {
      await client.close();
    }
  });

  it('a call with no port — a direct `execute`, `mcpServe` — files nothing and runs unchanged', async () => {
    const endpoint = mcpEndpoint(({ id, n }) => (n === 1 ? throttled() : answered(id)));
    const client = await mcpClient({
      name: 'tickets',
      transport: { transport: 'http', url: URL_, fetch: endpoint.fetch },
      retryOnThrottle: { baseDelayMs: 1, jitter: 'none' },
    });
    try {
      const [tool] = await client.tools();
      await expect(tool?.execute({ q: 'x' }, {} as never)).resolves.toBe('ticket-42');
      expect(endpoint.toolCalls()).toBe(2);
    } finally {
      await client.close();
    }
  });
});

// ─── S10 under the app's redaction rule ──────────────────────────────

describe("saved retry evidence — S10 the app's redaction rule serves the record", () => {
  it('a redacted run keeps every attempt, reason, wait and end; the declared label is served as the placeholder', async () => {
    const endpoint = mcpEndpoint(({ id, n }) => (n === 1 ? throttled() : answered(id)));
    const client = await mcpClient({
      name: 'tickets',
      transport: { transport: 'http', url: URL_, fetch: endpoint.fetch },
      retryOnThrottle: { baseDelayMs: 10, jitter: 'none', endpointLabel: 'tickets-gateway' },
    });
    try {
      const agent = await agentFor(client, 'tc-redacted', 'printer', { keys: ['anything'] });
      const rec = recordRun(agent);
      await agent.run({ message: 'find it' });
      const evidence = payloadOf(filedIn(await savedAndReloaded(rec))[0]);

      // The library's own words and numbers are not the app's data: they stay.
      expect(evidence.attempts).toEqual([
        { attempt: 1, ...RATE_LIMITED, waitMs: 10 },
        { attempt: 2, outcome: 'answered', reason: 'answered', status: 200 },
      ]);
      expect(evidence.end).toEqual({ outcome: 'answered', reason: 'answered', status: 200 });
      expect(evidence.omitted).toBe(0);
      // A name the app declared is not a library word: the rule serves it.
      expect(evidence.endpoint).toBe('[REDACTED]');
    } finally {
      await client.close();
    }
  });
});

// ─── S11 / S12 the limits, in the record ─────────────────────────────

describe('saved retry evidence — S11/S12 a limit that ends the series says which', () => {
  it("S11 the call's deadline cuts a request in flight: `timed-out`, `no-time-left`, a fixed sentence", async () => {
    const endpoint = mcpEndpoint(({ n, signal }) => (n === 1 ? throttled() : hangs(signal)));
    const client = await mcpClient({
      name: 'tickets',
      transport: { transport: 'http', url: URL_, fetch: endpoint.fetch },
      retryOnThrottle: { baseDelayMs: 5, jitter: 'none', maxElapsedMs: 150 },
    });
    try {
      const agent = await agentFor(client, 'tc-deadline', 'printer');
      const rec = recordRun(agent);
      await agent.run({ message: 'find it' });
      const evidence = payloadOf(filedIn(await savedAndReloaded(rec))[0]);

      const sentence = 'The call ran out of time before an answer arrived.';
      expect(evidence.attempts).toEqual([
        { attempt: 1, ...RATE_LIMITED, waitMs: 5 },
        {
          attempt: 2,
          outcome: 'timed-out',
          reason: 'no-time-left',
          failure: 'timeout',
          error: { message: sentence, code: 'timeout' },
        },
      ]);
      expect(evidence.end).toEqual({
        outcome: 'timed-out',
        reason: 'no-time-left',
        failure: 'timeout',
        during: 'request',
        error: { message: sentence, code: 'timeout' },
      });
      expect(endpoint.toolCalls()).toBe(2);
    } finally {
      await client.close();
    }
  });

  it('S12 a `Retry-After` past `maxWaitMs` is never shortened: the 429 is delivered, `wait-limit`', async () => {
    const endpoint = mcpEndpoint(() => throttled('30'));
    const client = await mcpClient({
      name: 'tickets',
      transport: { transport: 'http', url: URL_, fetch: endpoint.fetch },
    });
    try {
      const agent = await agentFor(client, 'tc-stated', 'printer');
      const rec = recordRun(agent);
      await agent.run({ message: 'find it' });
      const evidence = payloadOf(filedIn(await savedAndReloaded(rec))[0]);

      const refusedForGood = {
        outcome: 'refused',
        reason: 'wait-limit',
        status: 429,
        kind: 'throttle',
        failure: 'rate-limited',
      } as const;
      expect(evidence.attempts).toEqual([{ attempt: 1, ...refusedForGood, retryAfterMs: 30_000 }]);
      expect(evidence.end).toEqual(refusedForGood);
      expect(endpoint.toolCalls()).toBe(1);
    } finally {
      await client.close();
    }
  });
});
