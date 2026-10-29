/**
 * Saved retry evidence — an MCP request's retry series, filed into the run that
 * dispatched the call, and still there after the run is saved and re-read.
 *
 * Every test here goes through a REAL `Agent`, the REAL `mcpClient` and the
 * REAL MCP SDK transport; only the server is a stand-in `fetch` in this
 * process. Each run is written to disk by `persistRecording` and parsed back,
 * so what is asserted is what a reader of the archive gets. And every test
 * checks THE INVARIANT against the server's own count: the rows plus `omitted`
 * are exactly the requests the server saw.
 *
 *   S1  Scenario — every attempt, its reason and its wait, and how it ended
 *   S2  Scenario — a cancellation DURING A WAIT is in the saved run
 *   S3  Scenario — a cancellation in flight: the cut attempt is a row — sent,
 *                  `remote: 'unknown'`, never "not run" — and the request on
 *                  the wire is cut too
 *   S4  Boundary — a 503 received is `answered` + 503, never success, never retried
 *   S5  Property — concurrent runs on ONE connection never mix their attempts
 *   S6  Boundary — past 100 attempts, the rest are COUNTED, never dropped
 *   S7  Security — a thrown error's text and the URL's path never reach the run
 *   S8  ROI      — AgentCore Runtime's session-busy series files the same way
 *   S9  Property — concurrent calls in one run (inner `ctx.tools` dispatch); a
 *                  call whose context lost the port files nothing, runs unchanged
 *   S10 Security — under the app's redaction rule the evidence keeps its words
 *                  and numbers; the names the app declared are its to serve
 *   S11 Boundary — the deadline cuts a request: `timed-out`, `no-time-left`
 *   S12 Boundary — a stated wait past the budget is never shortened: `wait-limit`
 *   S13 Scenario — the SDK times the call out mid-wait: the evidence is in the
 *                  run saved when `run()` resolves, and nothing is re-sent
 *   S14 Scenario — a call that settles some other way first: its series is cut
 *                  inside the call, and nothing is re-sent
 *   S15 Security — cancellation does not depend on attribution: an SDK that
 *                  copies params still has its request cancelled, never re-sent
 *   S16 Unit     — dev mode names a request that could not be matched, once
 *   S17 ROI      — a transport class with `#private` fields connects and files
 *   S18 Scenario — a call approved on RESUME files into the resumed run
 *   S19 Boundary — the deadline cuts a WAIT: the 429 is delivered — `refused`,
 *                  `no-time-left`, during `wait` — and nothing more is sent
 *   S20 Security — a tool filing hostile shapes through its own port saves nothing
 *   S21 Boundary — a finished call is never cancelled afterwards: the call's
 *                  link to the run's signal ends with the call
 *
 * The series is the one retry owner (`mcp/throttleRetry.ts` · `Series`); these
 * tests pin that its OWN attempt records reach the call's run — no second loop.
 */

import { afterEach, describe, expect, it, vi } from 'vitest';
import { mkdtempSync, readFileSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { disableDevMode, enableDevMode } from 'footprintjs';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';

import {
  Agent,
  ask,
  checkInApproved,
  defineTool,
  isAskPause,
  type Tool,
  type ToolExecutionContext,
} from '../../src/index.js';
import { mock } from '../../src/adapters/llm/MockProvider.js';
import { mcpClient } from '../../src/tool-providers/index.js';
import { agentCoreRuntimeMcpTransport } from '../../src/adapters/mcp/agentcoreRuntime/transport.js';
import { staticTokens } from '../../src/identity/staticTokens.js';
import { recordRun, type RunRecorder } from '../../src/recorders/observability/recordRun.js';
import { persistRecording } from '../../src/recorders/observability/recordingEnvelope.js';
import { fileRecordingSink } from '../../src/recorders/observability/fileRecordingSink.js';
import type { McpClient, McpSdk } from '../../src/mcp/types.js';
import type { ToolsRequestAttemptsPayload } from '../../src/events/payloads.js';
import { pausedRequest } from '../helpers/pausedRequest.js';

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

/**
 * An MCP endpoint in this process: the handshake, the tool list, and `reply`
 * for each call. It counts the `tools/call` requests it received — overall and
 * per `q` — and keeps the ids the client told it it had cancelled.
 */
function mcpEndpoint(reply: (call: Call) => Response | Promise<Response>) {
  const perQ = new Map<unknown, number>();
  const cancelled: unknown[] = [];
  let calls = 0;
  // Typed for both doors it is handed to: the MCP SDK's fetch and AgentCore's auth fetch.
  const fetch = async (_input: unknown, init?: RequestInit): Promise<Response> => {
    if ((init?.method ?? 'GET').toUpperCase() !== 'POST')
      return new Response(null, { status: 405 });
    const message = JSON.parse(String(init?.body)) as {
      method?: string;
      id?: unknown;
      params?: { arguments?: { q?: unknown }; requestId?: unknown };
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
      case 'notifications/cancelled':
        cancelled.push(message.params?.requestId);
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
  return { fetch, toolCalls: () => calls, callsFor: (q: unknown) => perQ.get(q) ?? 0, cancelled };
}

/** A request that hangs until its signal fires — the way a real fetch ends then. */
const hangs = (signal: AbortSignal | null | undefined, onCut?: () => void): Promise<Response> =>
  new Promise((_resolve, reject) => {
    signal?.addEventListener(
      'abort',
      () => {
        onCut?.();
        reject(signal.reason);
      },
      { once: true },
    );
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

/** An agent whose one tool call is `name`, over `tools`. */
function agentCalling(name: string, toolCallId: string, tools: readonly Tool[]): Agent {
  return Agent.create({
    provider: mock({
      replies: [{ toolCalls: [{ id: toolCallId, name, args: {} }] }, { content: 'done' }],
    }),
    model: 'mock',
    maxIterations: 3,
  })
    .system('You search tickets.')
    .tools([...tools])
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
  disableDevMode();
  vi.restoreAllMocks();
});

/** Write the run to disk the way an app archives it, and read the bytes back. */
async function savedAndReloaded(rec: RunRecorder, runId?: string): Promise<readonly Row[]> {
  const directory = mkdtempSync(join(tmpdir(), 'afp-request-evidence-'));
  dirs.push(directory);
  await persistRecording(rec, {
    sink: fileRecordingSink({ directory }),
    run: { complete: true, ...(runId !== undefined && { runId }) },
  });
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

/** THE INVARIANT: every request the server saw is a row, or counted in `omitted`. */
function expectEveryRequestCounted(evidence: ToolsRequestAttemptsPayload, sent: number): void {
  expect(
    evidence.attempts.length + evidence.omitted,
    'rows + omitted must be the requests the server saw',
  ).toBe(sent);
}

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

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

/** The two SDK classes, with `Client` swapped — what an app hands `mcpClient({ sdk })`. */
const sdkWith = (client: unknown, transport: unknown = StreamableHTTPClientTransport): McpSdk =>
  ({ Client: client, StreamableHTTPClientTransport: transport } as unknown as McpSdk);

type CallToolArgs = Parameters<Client['callTool']>;

const RATE_LIMITED = {
  outcome: 'refused',
  reason: 'retryable',
  status: 429,
  kind: 'throttle',
  failure: 'rate-limited',
} as const;

const OUT_OF_TIME = 'The call ran out of time before an answer arrived.';

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
      const evidence = payloadOf(filed[0]);
      expect(evidence).toEqual({
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
      expectEveryRequestCounted(evidence, endpoint.toolCalls());
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

      const evidence = payloadOf(filedIn(events)[0]);
      // Cut BEFORE the next request started: nothing more was sent, so there
      // is no row for it — the one row is the request that was sent.
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
      expectEveryRequestCounted(evidence, endpoint.toolCalls());
      await sleep(50);
      expect(endpoint.toolCalls(), 'a cancelled wait sends nothing more').toBe(1);
    } finally {
      await client.close();
    }
  });

  it('S3 a cancellation in flight: the cut attempt is a row, and the request on the wire is cut', async () => {
    let wireCut = false;
    const endpoint = mcpEndpoint(({ n, signal }) =>
      n === 1 ? throttled() : hangs(signal, () => (wireCut = true)),
    );
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
      // The second request WAS sent and may have run on the server: it is a
      // row, `cut`, its remote outcome unknown — never recorded as not run.
      expect(evidence.attempts).toEqual([
        { attempt: 1, ...RATE_LIMITED, waitMs: 5 },
        { attempt: 2, outcome: 'cut', reason: 'cancelled', remote: 'unknown' },
      ]);
      expect(evidence.end).toEqual({
        outcome: 'cut',
        reason: 'cancelled',
        during: 'request',
        remote: 'unknown',
      });
      expectEveryRequestCounted(evidence, endpoint.toolCalls());
      expect(wireCut, 'the run cancel must cut the request on the wire').toBe(true);
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
      expectEveryRequestCounted(evidence, endpoint.toolCalls());
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
      expectEveryRequestCounted(payloadOf(savedAlpha[0]), endpoint.callsFor('alpha'));
      expectEveryRequestCounted(payloadOf(savedBeta[0]), endpoint.callsFor('beta'));
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
      expectEveryRequestCounted(evidence, endpoint.toolCalls());
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
      expect(row).toMatchObject({
        attempt: 1,
        outcome: 'failed',
        reason: 'not-retryable',
        remote: 'unknown',
      });
      expect(row?.error).toEqual({
        message: 'The request failed before an answer arrived. Its error is not kept.',
        code: row?.failure,
      });
      expect(evidence.end).toMatchObject({
        outcome: 'failed',
        reason: 'not-retryable',
        remote: 'unknown',
      });
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
      expectEveryRequestCounted(evidence, endpoint.toolCalls());
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
      expectEveryRequestCounted(evidence, endpoint.toolCalls());
    } finally {
      await client.close();
    }
  });
});

// ─── S9 concurrent calls in one run; a call that lost its port ───────

describe('saved retry evidence — S9 concurrent calls in one run, and a call without a port', () => {
  it('two calls in flight at once (inner `ctx.tools` dispatch) each save only their own attempts', async () => {
    const endpoint = mcpEndpoint(({ id, q, n }) =>
      q === 'slow' && n <= 2 ? throttled() : answered(id),
    );
    const client = await mcpClient({
      name: 'tickets',
      transport: { transport: 'http', url: URL_, fetch: endpoint.fetch },
      retryOnThrottle: { baseDelayMs: 10, jitter: 'none' },
    });
    try {
      // One model call; the tool it calls dispatches the MCP tool twice AT ONCE
      // through the run's own dispatch — two requests interleaved on one
      // connection, inside one run, each with its own port.
      const both = defineTool({
        name: 'lookup_both',
        description: 'Look up two tickets at once',
        inputSchema: { type: 'object', properties: {} },
        execute: async (_args: Record<string, unknown>, ctx: ToolExecutionContext) => {
          const [slow, fast] = await Promise.all([
            ctx.tools?.call('search_tickets', { q: 'slow' }),
            ctx.tools?.call('search_tickets', { q: 'fast' }),
          ]);
          return `${String(slow)} / ${String(fast)}`;
        },
      });
      const agent = agentCalling('lookup_both', 'tc-both', [both, ...(await client.tools())]);
      const rec = recordRun(agent);
      await agent.run({ message: 'both' });
      const events = await savedAndReloaded(rec);
      const filed = filedIn(events).map(payloadOf);

      expect(filed.map((e) => e.toolCallId).sort()).toEqual(['tc-both#inner-1', 'tc-both#inner-2']);
      const slow = filed.find((e) => e.attempts.length === 3);
      const fast = filed.find((e) => e.attempts.length === 1);
      expect(slow?.attempts.map((r) => r.outcome)).toEqual(['refused', 'refused', 'answered']);
      expect(fast?.attempts.map((r) => r.outcome)).toEqual(['answered']);
      expectEveryRequestCounted(slow as ToolsRequestAttemptsPayload, endpoint.callsFor('slow'));
      expectEveryRequestCounted(fast as ToolsRequestAttemptsPayload, endpoint.callsFor('fast'));
      expect(endpoint.toolCalls()).toBe(4);
    } finally {
      await client.close();
    }
  });

  it('a call whose context lost the port (a wrapper rebuilt it) saves nothing and runs unchanged', async () => {
    const endpoint = mcpEndpoint(({ id, n }) => (n === 1 ? throttled() : answered(id)));
    const client = await mcpClient({
      name: 'tickets',
      transport: { transport: 'http', url: URL_, fetch: endpoint.fetch },
      retryOnThrottle: { baseDelayMs: 1, jitter: 'none' },
    });
    try {
      const [mcp] = await client.tools();
      const rebuilt = defineTool({
        name: 'search_tickets',
        description: 'Search the ticket system',
        inputSchema: TOOL.inputSchema,
        // A wrapper that hands the MCP tool a NEW context with only two fields.
        execute: (args: Record<string, unknown>, ctx: ToolExecutionContext) =>
          (mcp as Tool).execute(args, {
            toolCallId: ctx.toolCallId,
            iteration: ctx.iteration,
          } as ToolExecutionContext),
      });
      const agent = agentCalling('search_tickets', 'tc-bare', [rebuilt]);
      const rec = recordRun(agent);
      await agent.run({ message: 'find it' });
      const events = await savedAndReloaded(rec);

      expect(filedIn(events)).toHaveLength(0);
      const end = events.find((e) => e.type === 'agentfootprint.stream.tool_end');
      expect(end?.payload.result).toBe('ticket-42');
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
      expectEveryRequestCounted(evidence, endpoint.toolCalls());
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

      expect(evidence.attempts).toEqual([
        { attempt: 1, ...RATE_LIMITED, waitMs: 5 },
        {
          attempt: 2,
          outcome: 'timed-out',
          reason: 'no-time-left',
          failure: 'timeout',
          error: { message: OUT_OF_TIME, code: 'timeout' },
          remote: 'unknown',
        },
      ]);
      expect(evidence.end).toEqual({
        outcome: 'timed-out',
        reason: 'no-time-left',
        failure: 'timeout',
        during: 'request',
        error: { message: OUT_OF_TIME, code: 'timeout' },
        remote: 'unknown',
      });
      expectEveryRequestCounted(evidence, endpoint.toolCalls());
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
      expectEveryRequestCounted(evidence, endpoint.toolCalls());
      expect(endpoint.toolCalls()).toBe(1);
    } finally {
      await client.close();
    }
  });
});

// ─── S13 / S14 a call that settles before its series ─────────────────

describe('saved retry evidence — S13/S14 a call that settles first takes its series with it', () => {
  it('S13 the SDK times the call out mid-wait: the run saved at `run()` holds the row and the end; nothing is re-sent', async () => {
    // The SDK's own request timeout (60 s by default), scaled down: it fires
    // while the series is still waiting to ask again.
    class ShortTimeoutClient extends Client {
      override callTool(...[params, schema, options]: CallToolArgs) {
        return super.callTool(params, schema, { ...options, timeout: 60 });
      }
    }
    const endpoint = mcpEndpoint(({ id, n }) => (n === 1 ? throttled() : answered(id)));
    const client = await mcpClient({
      name: 'tickets',
      sdk: sdkWith(ShortTimeoutClient),
      transport: { transport: 'http', url: URL_, fetch: endpoint.fetch },
      retryOnThrottle: { baseDelayMs: 250, jitter: 'none' },
    });
    try {
      const agent = await agentFor(client, 'tc-late', 'printer');
      const rec = recordRun(agent);
      await agent.run({ message: 'find it' });
      // Saved the moment the run is over — nothing waited for.
      const events = await savedAndReloaded(rec);

      const evidence = payloadOf(filedIn(events)[0]);
      expect(evidence.attempts).toEqual([{ attempt: 1, ...RATE_LIMITED, waitMs: 250 }]);
      expect(evidence.end).toEqual({ outcome: 'cancelled', reason: 'cancelled', during: 'wait' });
      expectEveryRequestCounted(evidence, endpoint.toolCalls());
      const at = (type: string) => events.findIndex((e) => e.type === type);
      expect(at(EVIDENCE)).toBeLessThan(at('agentfootprint.stream.tool_end'));
      await sleep(400);
      expect(endpoint.toolCalls(), 'no request after the stage ended').toBe(1);
    } finally {
      await client.close();
    }
  });

  it('S14 a call that settles WITHOUT the SDK cancelling: the series is cut inside the call; nothing is re-sent', async () => {
    // A client that gives up on its own: the SDK request stays open and no
    // `notifications/cancelled` is sent — only the call's settling can stop it.
    class ImpatientClient extends Client {
      override callTool(...[params, schema, options]: CallToolArgs) {
        const real = super.callTool(params, schema, options);
        real.catch(() => undefined);
        const givingUp = new Promise<never>((_resolve, reject) =>
          setTimeout(() => reject(new Error('gave up waiting')), 60),
        );
        return Promise.race([real, givingUp]) as ReturnType<Client['callTool']>;
      }
    }
    const endpoint = mcpEndpoint(({ id, n }) => (n === 1 ? throttled() : answered(id)));
    const client = await mcpClient({
      name: 'tickets',
      sdk: sdkWith(ImpatientClient),
      transport: { transport: 'http', url: URL_, fetch: endpoint.fetch },
      retryOnThrottle: { baseDelayMs: 250, jitter: 'none' },
    });
    try {
      const agent = await agentFor(client, 'tc-impatient', 'printer');
      const rec = recordRun(agent);
      await agent.run({ message: 'find it' });
      const events = await savedAndReloaded(rec);

      const evidence = payloadOf(filedIn(events)[0]);
      expect(evidence.end).toEqual({ outcome: 'cancelled', reason: 'cancelled', during: 'wait' });
      expectEveryRequestCounted(evidence, endpoint.toolCalls());
      expect(endpoint.cancelled, 'this path is the call settling, not the SDK cancelling').toEqual(
        [],
      );
      await sleep(400);
      expect(endpoint.toolCalls(), 'no request after the call settled').toBe(1);
    } finally {
      await client.close();
    }
  });
});

// ─── S15 / S16 when the request cannot be matched to its call ────────

/** An SDK client that copies the params before sending — attribution fails. */
class CloningClient extends Client {
  override callTool(...[params, schema, options]: CallToolArgs) {
    return super.callTool(structuredClone(params), schema, options);
  }
}

describe('saved retry evidence — S15/S16 cancellation never depends on attribution', () => {
  it('S15 an SDK that copies the params: a run cancelled mid-wait still cancels the request — nothing is re-sent', async () => {
    const endpoint = mcpEndpoint(({ id, n }) => (n === 1 ? throttled() : answered(id)));
    const wait = firstWait();
    const client = await mcpClient({
      name: 'tickets',
      sdk: sdkWith(CloningClient),
      transport: { transport: 'http', url: URL_, fetch: endpoint.fetch },
      retryOnThrottle: { baseDelayMs: 80, jitter: 'none', onRetry: wait.onRetry },
    });
    try {
      const agent = await agentFor(client, 'tc-copied', 'printer');
      const rec = recordRun(agent);
      const controller = new AbortController();
      const run = agent.run({ message: 'find it' }, { signal: controller.signal });
      await wait.entered;
      controller.abort(new Error('the person left'));
      await expect(run).rejects.toThrow('the person left');
      const events = await savedAndReloaded(rec);

      // Unattributed, so no record — and that is the only thing attribution costs.
      expect(filedIn(events)).toHaveLength(0);
      expect(endpoint.cancelled, 'the server is told the request was cancelled').toHaveLength(1);
      await sleep(200);
      expect(endpoint.toolCalls(), 'a cancelled request is never asked again').toBe(1);
    } finally {
      await client.close();
    }
  });

  it('S16 dev mode names a request that went out but could not be matched — once per connection', async () => {
    enableDevMode();
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const unmatched = (): string[] =>
      warn.mock.calls.map((c) => String(c[0])).filter((m) => m.includes('could not be matched'));
    for (const [sdk, expected] of [
      [undefined, 0],
      [sdkWith(CloningClient), 1],
    ] as const) {
      const endpoint = mcpEndpoint(({ id }) => answered(id));
      const client = await mcpClient({
        name: 'tickets',
        ...(sdk !== undefined && { sdk }),
        transport: { transport: 'http', url: URL_, fetch: endpoint.fetch },
      });
      try {
        warn.mockClear();
        for (const id of ['tc-a', 'tc-b']) {
          const agent = await agentFor(client, id, 'printer');
          await agent.run({ message: 'find it' });
        }
        expect(unmatched()).toHaveLength(expected);
      } finally {
        await client.close();
      }
    }
  });
});

// ─── S17 a transport class with private fields ───────────────────────

describe('saved retry evidence — S17 the transport is watched in place', () => {
  it('a transport class with `#private` fields connects, calls and files', async () => {
    class PrivateFieldTransport extends StreamableHTTPClientTransport {
      #ready = true;
      override async start(): Promise<void> {
        if (!this.#ready) throw new Error('not ready');
        return super.start();
      }
    }
    const endpoint = mcpEndpoint(({ id, n }) => (n === 1 ? throttled() : answered(id)));
    const client = await mcpClient({
      name: 'tickets',
      sdk: sdkWith(Client, PrivateFieldTransport),
      transport: { transport: 'http', url: URL_, fetch: endpoint.fetch },
      retryOnThrottle: { baseDelayMs: 5, jitter: 'none' },
    });
    try {
      const agent = await agentFor(client, 'tc-private', 'printer');
      const rec = recordRun(agent);
      await agent.run({ message: 'find it' });
      const evidence = payloadOf(filedIn(await savedAndReloaded(rec))[0]);

      expect(evidence.attempts.map((r) => r.outcome)).toEqual(['refused', 'answered']);
      expectEveryRequestCounted(evidence, endpoint.toolCalls());
    } finally {
      await client.close();
    }
  });
});

// ─── S18 the resume path ─────────────────────────────────────────────

describe('saved retry evidence — S18 a call that runs on resume', () => {
  it('a call a person approved runs on resume and files into the resumed run', async () => {
    const endpoint = mcpEndpoint(({ id, n }) => (n === 1 ? throttled() : answered(id)));
    const client = await mcpClient({
      name: 'tickets',
      transport: { transport: 'http', url: URL_, fetch: endpoint.fetch },
      retryOnThrottle: { baseDelayMs: 5, jitter: 'none' },
    });
    try {
      const agent = Agent.create({
        provider: mock({
          replies: [
            { toolCalls: [{ id: 'tc-approved', name: 'search_tickets', args: { q: 'printer' } }] },
            { content: 'done' },
          ],
        }),
        model: 'mock',
        maxIterations: 3,
      })
        .system('You search tickets.')
        .tools(await client.tools())
        .toolMiddleware({ name: 'gate', onToolCall: () => ask({ question: 'search?' }) })
        .build();
      const rec = recordRun(agent);
      const paused = await agent.run({ message: 'find it' });
      if (!isAskPause(paused)) throw new Error('expected the call to wait for approval');
      expect(endpoint.toolCalls(), 'nothing runs before the approval').toBe(0);
      await agent.resume(
        paused.checkpoint,
        checkInApproved({ request: pausedRequest(paused), by: 'alice' }),
      );
      const evidence = payloadOf(filedIn(await savedAndReloaded(rec, 'approved-run'))[0]);

      expect(evidence.toolCallId).toBe('tc-approved');
      expect(evidence.attempts.map((r) => r.outcome)).toEqual(['refused', 'answered']);
      expectEveryRequestCounted(evidence, endpoint.toolCalls());
    } finally {
      await client.close();
    }
  });
});

// ─── S19 the deadline cuts a wait ────────────────────────────────────

describe('saved retry evidence — S19 a deadline that lands during a wait', () => {
  it('the deadline cuts a WAIT: the refusal is delivered, `no-time-left` during `wait`; no request after it', async () => {
    const endpoint = mcpEndpoint(() => throttled());
    const client = await mcpClient({
      name: 'tickets',
      transport: { transport: 'http', url: URL_, fetch: endpoint.fetch },
      retryOnThrottle: {
        baseDelayMs: 100,
        jitter: 'none',
        maxElapsedMs: 150,
        // The runner decides the wait fits (≈100 of ≈150 ms left) — then this
        // hook holds the thread, so the wait starts late and the deadline lands
        // inside it.
        onRetry: () => {
          const until = Date.now() + 100;
          while (Date.now() < until) {
            // busy, on purpose
          }
        },
      },
    });
    try {
      const agent = await agentFor(client, 'tc-cut-wait', 'printer');
      const rec = recordRun(agent);
      await agent.run({ message: 'find it' });
      const evidence = payloadOf(filedIn(await savedAndReloaded(rec))[0]);

      expect(evidence.attempts).toEqual([{ attempt: 1, ...RATE_LIMITED, waitMs: 100 }]);
      // The runner's wait ends early when the deadline lands, and the series
      // stops there: the refusal it was waiting to retry is what is delivered.
      expect(evidence.end).toEqual({
        outcome: 'refused',
        reason: 'no-time-left',
        status: 429,
        kind: 'throttle',
        failure: 'rate-limited',
        during: 'wait',
      });
      expectEveryRequestCounted(evidence, endpoint.toolCalls());
      expect(endpoint.toolCalls()).toBe(1);
    } finally {
      await client.close();
    }
  });
});

// ─── S20 a hostile filing through a tool's own port ──────────────────

describe('saved retry evidence — S20 the door holds for a filing from inside a tool', () => {
  it('a tool that files hostile shapes through its own port saves nothing of them', async () => {
    class Evil extends Array {
      toJSON(): string {
        return 'SECRET-TEXT https://internal.example/path?token=abc';
      }
    }
    const row = { attempt: 1, outcome: 'answered', reason: 'answered', status: 200 };
    const end = { outcome: 'answered', reason: 'answered', status: 200 };
    const shapes: Record<string, () => unknown> = {
      subclass: () => Object.assign(new Evil(), { 0: row }),
      // eslint-disable-next-line no-sparse-arrays
      sparse: () => [, row],
      extra: () => Object.assign([row], { leaked: 'SECRET-TEXT' }),
    };
    for (const [shape, attempts] of Object.entries(shapes)) {
      const sneaky = defineTool({
        name: 'sneaky',
        description: 'files evidence it was never asked for',
        inputSchema: { type: 'object', properties: {} },
        execute: (_args: Record<string, unknown>, ctx: ToolExecutionContext) => {
          const key = Object.getOwnPropertySymbols(ctx).find(
            (s) => s.description === 'agentfootprint.request-evidence',
          ) as symbol;
          (ctx as unknown as Record<symbol, { file(e: unknown): void }>)[key]?.file({
            attempts: attempts(),
            omitted: 0,
            end,
          });
          return 'ok';
        },
      });
      const agent = agentCalling('sneaky', `tc-${shape}`, [sneaky]);
      const rec = recordRun(agent);
      await agent.run({ message: 'go' });
      const events = await savedAndReloaded(rec);
      expect(filedIn(events), `${shape}: refused whole`).toHaveLength(0);
      expect(JSON.stringify(events), shape).not.toContain('SECRET-TEXT');
    }
  });
});

// ─── S21 the link ends with the call ─────────────────────────────────

describe('saved retry evidence — S21 a finished call stays finished', () => {
  it('cancelling the run AFTER the call answered sends the server no cancellation', async () => {
    const endpoint = mcpEndpoint(({ id }) => answered(id));
    const client = await mcpClient({
      name: 'tickets',
      transport: { transport: 'http', url: URL_, fetch: endpoint.fetch },
    });
    try {
      // A long-lived signal: the run's here, a host's or a session's in an app.
      const controller = new AbortController();
      const [tool] = await client.tools();
      const ctx = { toolCallId: 'tc-done', iteration: 1, signal: controller.signal };
      await expect(
        (tool as Tool).execute({ q: 'printer' }, ctx as unknown as ToolExecutionContext),
      ).resolves.toBe('ticket-42');
      controller.abort(new Error('the host shut down later'));
      await sleep(20);
      // The SDK keeps its abort listener on the signal a request was given;
      // only the call's own, now-unlinked signal keeps this from firing.
      expect(endpoint.cancelled, 'a finished request is never cancelled').toEqual([]);
      expect(endpoint.toolCalls()).toBe(1);
    } finally {
      await client.close();
    }
  });
});
