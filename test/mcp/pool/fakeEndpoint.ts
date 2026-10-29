/**
 * An in-memory MCP Streamable HTTP endpoint — "the network" for the pool's tests.
 *
 * The REAL MCP SDK client talks to it through a `fetch` (no socket), so time can
 * be driven with fake timers and every request that reaches the network is
 * recorded, with the session it named. A test can:
 *
 *   - give each session its own tool list (`toolsFor`);
 *   - decide what a call answers, or stall it (`onCall`);
 *   - decide how a DELETE is answered, per session (`deleteStatus`);
 *   - end a session server-side, so its next request is a 404 (`endSession`);
 *   - HOLD requests matching a predicate until released (`hold`), ignoring their
 *     abort — an app `fetch` that ignores its signal;
 *   - answer a call as an SSE stream whose event arrives later (`streamNext`).
 */

import { randomUUID } from 'node:crypto';

export interface NetRequest {
  readonly method: string;
  readonly rpc?: string;
  readonly session?: string;
  readonly tool?: string;
  /** The order it reached the network in. */
  readonly seq: number;
}

export interface ListedToolDef {
  readonly name: string;
  readonly description?: string;
  readonly inputSchema?: Record<string, unknown>;
  readonly outputSchema?: Record<string, unknown>;
  readonly _meta?: Record<string, unknown>;
}

export type CallAnswer = {
  readonly content: readonly { readonly type: 'text'; readonly text: string }[];
  readonly isError?: boolean;
};

export interface Hold {
  /** Requests held so far. */
  readonly held: number;
  /** Let every held request (and every later one) through. */
  release(): void;
}

export interface FakeEndpoint {
  readonly url: string;
  /** Hand this to a transport as its `fetch`. */
  readonly fetch: (input: string | URL | Request, init?: RequestInit) => Promise<Response>;
  /** Every request that reached the network, in order. */
  readonly requests: NetRequest[];
  sessions(): readonly string[];
  endSession(session: string): void;
  /** Hold every request `matches` selects until released — its abort ignored. */
  hold(matches: (request: NetRequest) => boolean): Hold;
  /** The next tools/call is answered as SSE; resolve the returned function to send its event. */
  streamNext(): { readonly send: () => void };
  /** Requests that named `session`, or that opened it. */
  servedBy(session: string): readonly NetRequest[];
}

export interface FakeEndpointOptions {
  readonly toolsFor?: (session: string) => readonly ListedToolDef[];
  readonly onCall?: (
    session: string,
    name: string,
    args: Record<string, unknown>,
  ) => CallAnswer | Promise<CallAnswer>;
  /** How a DELETE for `session` is answered. Default 200 (ended). */
  readonly deleteStatus?: (session: string) => number;
  /** Issue session ids. Default true. */
  readonly issueSessions?: boolean;
  readonly url?: string;
}

const DEFAULT_TOOLS: readonly ListedToolDef[] = [{ name: 'status', description: 'Order status' }];

export function fakeEndpoint(options: FakeEndpointOptions = {}): FakeEndpoint {
  const url = options.url ?? 'https://orders.example.test/mcp';
  const requests: NetRequest[] = [];
  const live = new Set<string>();
  const opened = new Map<string, number>();
  const holds: { matches: (r: NetRequest) => boolean; gate: Promise<void>; count: number }[] = [];
  let streamed: ((send: () => void) => void) | undefined;
  let seq = 0;

  const json = (body: unknown, status = 200, headers: Record<string, string> = {}): Response =>
    new Response(JSON.stringify(body), {
      status,
      headers: { 'content-type': 'application/json', ...headers },
    });

  const handle = async (request: NetRequest, body: unknown): Promise<Response> => {
    if (request.method === 'GET') return new Response(null, { status: 405 });
    if (request.method === 'DELETE') {
      const session = request.session;
      if (session === undefined || !live.has(session)) return json(notFound(), 404);
      const status = options.deleteStatus?.(session) ?? 200;
      if (status >= 200 && status < 300) live.delete(session);
      return new Response(null, { status });
    }
    const message = body as { id?: unknown; method?: string; params?: Record<string, unknown> };
    if (request.session !== undefined && !live.has(request.session)) {
      return json(notFound(), 404);
    }
    if (message.method === 'initialize') {
      const session = options.issueSessions === false ? undefined : randomUUID();
      if (session !== undefined) {
        live.add(session);
        opened.set(session, request.seq);
      }
      const version = (message.params?.['protocolVersion'] as string) ?? '2025-06-18';
      return json(
        {
          jsonrpc: '2.0',
          id: message.id,
          result: {
            protocolVersion: version,
            capabilities: { tools: { listChanged: true } },
            serverInfo: { name: 'orders-desk', version: '1.0.0' },
          },
        },
        200,
        session === undefined ? {} : { 'mcp-session-id': session },
      );
    }
    if (message.id === undefined) return new Response(null, { status: 202 });
    const session = request.session ?? 'stateless';
    if (message.method === 'tools/list') {
      const tools = (options.toolsFor?.(session) ?? DEFAULT_TOOLS).map((t) => ({
        name: t.name,
        description: t.description ?? t.name,
        inputSchema: t.inputSchema ?? { type: 'object' },
        ...(t.outputSchema !== undefined && { outputSchema: t.outputSchema }),
        ...(t._meta !== undefined && { _meta: t._meta }),
      }));
      return json({ jsonrpc: '2.0', id: message.id, result: { tools } });
    }
    if (message.method === 'tools/call') {
      const name = message.params?.['name'] as string;
      const args = (message.params?.['arguments'] ?? {}) as Record<string, unknown>;
      const result = (await options.onCall?.(session, name, args)) ?? {
        content: [{ type: 'text', text: `${name}@${session}` }],
      };
      if (streamed !== undefined) {
        const wait = streamed;
        streamed = undefined;
        return sse(message.id, result, wait);
      }
      return json({ jsonrpc: '2.0', id: message.id, result });
    }
    return json({
      jsonrpc: '2.0',
      id: message.id,
      error: { code: -32601, message: 'Method not found' },
    });
  };

  const fetch = async (input: string | URL | Request, init?: RequestInit): Promise<Response> => {
    const headers = new Headers(init?.headers);
    const text = typeof init?.body === 'string' ? init.body : undefined;
    const body = text === undefined ? undefined : (JSON.parse(text) as unknown);
    const message = body as { method?: string; params?: { name?: unknown } } | undefined;
    const session = headers.get('mcp-session-id') ?? undefined;
    const request: NetRequest = {
      method: (init?.method ?? 'GET').toUpperCase(),
      ...(message?.method !== undefined && { rpc: message.method }),
      ...(session !== undefined && { session }),
      ...(message?.method === 'tools/call' &&
        typeof message.params?.name === 'string' && { tool: message.params.name }),
      seq: ++seq,
    };
    // Held requests ignore their abort: an app fetch that does not listen.
    for (const hold of holds) {
      if (hold.matches(request)) {
        hold.count += 1;
        await hold.gate;
      }
    }
    // Only now has it reached the network.
    requests.push(request);
    void input;
    return handle(request, body);
  };

  return {
    url,
    fetch,
    requests,
    sessions: () => [...live],
    endSession: (session) => {
      live.delete(session);
    },
    hold: (matches) => {
      let release!: () => void;
      const gate = new Promise<void>((resolve) => {
        release = resolve;
      });
      const entry = { matches, gate, count: 0 };
      holds.push(entry);
      return {
        get held() {
          return entry.count;
        },
        release: () => {
          holds.splice(holds.indexOf(entry), 1);
          release();
        },
      };
    },
    streamNext: () => {
      let fire!: () => void;
      const ready = new Promise<void>((resolve) => {
        fire = resolve;
      });
      streamed = (send) => void ready.then(send);
      return { send: () => fire() };
    },
    servedBy: (session) =>
      requests.filter((r) => r.session === session || opened.get(session) === r.seq),
  };
}

function notFound(): unknown {
  return { jsonrpc: '2.0', error: { code: -32001, message: 'Session not found' }, id: null };
}

/** A tools/call answered as SSE: the stream starts at once; its one event comes when `wait` fires. */
function sse(id: unknown, result: CallAnswer, wait: (send: () => void) => void): Response {
  const encoder = new TextEncoder();
  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      wait(() => {
        const event = JSON.stringify({ jsonrpc: '2.0', id, result });
        controller.enqueue(encoder.encode(`event: message\ndata: ${event}\n\n`));
        controller.close();
      });
    },
  });
  return new Response(body, { status: 200, headers: { 'content-type': 'text/event-stream' } });
}
