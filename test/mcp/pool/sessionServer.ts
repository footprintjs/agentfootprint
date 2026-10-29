/**
 * A STATEFUL MCP server over real Streamable HTTP, for the pool's tests.
 *
 * Built from the MCP SDK's own server primitives (never from `mcpServe`), on a
 * real socket, so the pool is tested against someone else's implementation of
 * the protocol. Every request is recorded with the session that served it, so
 * a test can assert that no request reached another conversation's session.
 *
 * Knobs a test turns:
 *   - `toolsFor(session)` — each session's own list (a session that unlocks
 *     tools lists differently from a fresh one);
 *   - `onCall` — what a tool call does (it may stall);
 *   - `deleteStatus` — how a `DELETE` is answered: `'sdk'` lets the SDK end the
 *     session, a number answers that status;
 *   - `endSession(id)` — the server forgets a session, so its next request is
 *     the SDK server's own 404;
 *   - `issueSessions: false` — a stateless server that issues no session id;
 *   - `notifyToolsChanged(id)` — send `notifications/tools/list_changed`.
 */

import { randomUUID } from 'node:crypto';
import { createServer, type IncomingMessage, type Server as HttpServer } from 'node:http';
import type { AddressInfo } from 'node:net';

import { Server as SdkServer } from '@modelcontextprotocol/sdk/server/index.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { CallToolRequestSchema, ListToolsRequestSchema } from '@modelcontextprotocol/sdk/types.js';

/** One request, as the socket received it. */
export interface SeenRequest {
  readonly httpMethod: string;
  /** The JSON-RPC method, when the body carried one. */
  readonly rpc?: string;
  /** The session the request named (`mcp-session-id`), when it named one. */
  readonly session?: string;
  /** For a `tools/call`: the tool. */
  readonly tool?: string;
  /** The session that served it — the one it named, or the one it opened. */
  servedBy?: string;
  /** What it was answered with. */
  status?: number;
}

export interface ListedToolDef {
  readonly name: string;
  readonly description?: string;
  readonly inputSchema?: Record<string, unknown>;
}

export interface SessionServerOptions {
  /** Each session's list. Default: one `status` tool. */
  readonly toolsFor?: (session: string) => readonly ListedToolDef[];
  /** What a call answers. Default: echoes the tool and the session. */
  readonly onCall?: (
    session: string,
    name: string,
    args: Record<string, unknown>,
  ) => Promise<{ content: { type: 'text'; text: string }[]; isError?: boolean }>;
  /** How a DELETE is answered. Default `'sdk'`. */
  readonly deleteStatus?: number | 'sdk';
  /** Issue session ids. Default true. */
  readonly issueSessions?: boolean;
}

export interface SessionServer {
  readonly url: string;
  readonly requests: SeenRequest[];
  /** Live sessions, in the order they opened. */
  sessions(): readonly string[];
  /** The server forgets `session`: its next request is answered 404. */
  endSession(session: string): void;
  /** Send `notifications/tools/list_changed` on `session`. */
  notifyToolsChanged(session: string): Promise<void>;
  /** How a DELETE is answered from now on. */
  setDeleteStatus(status: number | 'sdk'): void;
  close(): Promise<void>;
}

const DEFAULT_TOOLS: readonly ListedToolDef[] = [{ name: 'status', description: 'Order status' }];

/** Stand up a stateful SDK server on an ephemeral port. */
export async function startSessionServer(
  options: SessionServerOptions = {},
): Promise<SessionServer> {
  const requests: SeenRequest[] = [];
  const live = new Map<string, { transport: StreamableHTTPServerTransport; server: SdkServer }>();
  let deleteStatus: number | 'sdk' = options.deleteStatus ?? 'sdk';
  const issueSessions = options.issueSessions ?? true;

  const build = (session: () => string): SdkServer => {
    const server = new SdkServer(
      { name: 'orders-desk', version: '1.0.0' },
      { capabilities: { tools: { listChanged: true } } },
    );
    server.setRequestHandler(ListToolsRequestSchema, () => ({
      tools: (options.toolsFor?.(session()) ?? DEFAULT_TOOLS).map((t) => ({
        name: t.name,
        description: t.description ?? t.name,
        inputSchema: t.inputSchema ?? { type: 'object' },
      })),
    }));
    server.setRequestHandler(CallToolRequestSchema, async (request) => {
      const args = (request.params.arguments ?? {}) as Record<string, unknown>;
      if (options.onCall) return options.onCall(session(), request.params.name, args);
      return { content: [{ type: 'text', text: `${request.params.name}@${session()}` }] };
    });
    return server;
  };

  const listener: HttpServer = createServer((req, res) => {
    void (async () => {
      const body = req.method === 'POST' ? await readBody(req) : undefined;
      const parsed = parse(body);
      const named = header(req, 'mcp-session-id');
      const seen: SeenRequest = {
        httpMethod: req.method ?? 'GET',
        ...(parsed?.method !== undefined && { rpc: parsed.method }),
        ...(named !== undefined && { session: named }),
        ...(parsed?.tool !== undefined && { tool: parsed.tool }),
      };
      requests.push(seen);
      res.on('finish', () => {
        seen.status = res.statusCode;
      });

      if (!issueSessions) {
        // Stateless: a fresh server and transport per request, no session id.
        const server = build(() => 'stateless');
        const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined });
        res.on('close', () => {
          void transport.close();
          void server.close();
        });
        await server.connect(transport);
        seen.servedBy = 'stateless';
        await transport.handleRequest(req, res, body === undefined ? undefined : JSON.parse(body));
        return;
      }

      if (named !== undefined) {
        const held = live.get(named);
        if (held === undefined) {
          // The server ended this session: the Streamable HTTP rule, as the SDK words it.
          res.writeHead(404, { 'content-type': 'application/json' });
          res.end(
            JSON.stringify({
              jsonrpc: '2.0',
              error: { code: -32001, message: 'Session not found' },
              id: null,
            }),
          );
          return;
        }
        seen.servedBy = named;
        if (req.method === 'DELETE' && deleteStatus !== 'sdk') {
          res.writeHead(deleteStatus);
          res.end();
          if (deleteStatus >= 200 && deleteStatus < 300) live.delete(named);
          return;
        }
        if (req.method === 'DELETE') live.delete(named);
        await held.transport.handleRequest(
          req,
          res,
          body === undefined ? undefined : JSON.parse(body),
        );
        return;
      }

      // A request with no session: an `initialize` opens one.
      let opened = '';
      const transport = new StreamableHTTPServerTransport({
        sessionIdGenerator: () => randomUUID(),
        onsessioninitialized: (id) => {
          opened = id;
          live.set(id, { transport, server });
        },
      });
      const server = build(() => opened);
      await server.connect(transport);
      await transport.handleRequest(req, res, body === undefined ? undefined : JSON.parse(body));
      seen.servedBy = opened;
    })().catch(() => {
      if (!res.headersSent) {
        res.statusCode = 500;
        res.end();
      }
    });
  });

  await new Promise<void>((done, fail) => {
    listener.once('error', fail);
    listener.listen(0, '127.0.0.1', done);
  });
  const { port } = listener.address() as AddressInfo;

  return {
    url: `http://127.0.0.1:${port}/mcp`,
    requests,
    sessions: () => [...live.keys()],
    endSession: (session) => {
      live.delete(session);
    },
    notifyToolsChanged: async (session) => {
      await live.get(session)?.server.sendToolListChanged();
    },
    setDeleteStatus: (status) => {
      deleteStatus = status;
    },
    close: () =>
      new Promise<void>((done, fail) => {
        for (const { transport, server } of live.values()) {
          void transport.close();
          void server.close();
        }
        listener.closeAllConnections();
        listener.close((err) => (err ? fail(err) : done()));
      }),
  };
}

function header(req: IncomingMessage, name: string): string | undefined {
  const value = req.headers[name];
  return typeof value === 'string' ? value : undefined;
}

async function readBody(req: IncomingMessage): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) chunks.push(chunk as Buffer);
  return Buffer.concat(chunks).toString('utf8');
}

function parse(body: string | undefined): { method?: string; tool?: string } | undefined {
  if (body === undefined || body === '') return undefined;
  try {
    const message = JSON.parse(body) as { method?: unknown; params?: { name?: unknown } };
    return {
      ...(typeof message.method === 'string' && { method: message.method }),
      ...(message.method === 'tools/call' &&
        typeof message.params?.name === 'string' && { tool: message.params.name }),
    };
  } catch {
    return undefined;
  }
}
