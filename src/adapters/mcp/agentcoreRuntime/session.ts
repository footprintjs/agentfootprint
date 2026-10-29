/**
 * session — the session strategies: which AgentCore Runtime session a request
 * lands in.
 *
 * ── The facts they rest on ───────────────────────────────────────────────────
 * From the AgentCore Runtime MCP protocol contract and the `InvokeAgentRuntime`
 * API reference:
 *
 *   - The runtime routes by `Mcp-Session-Id` and always returns one. A client
 *     "must capture the Mcp-Session-Id returned in the response and include it
 *     in all subsequent requests" for microVM affinity; without it "each request
 *     may be routed to a new microVM".
 *   - `InvokeAgentRuntime` also carries `runtimeSessionId`
 *     (`X-Amzn-Bedrock-AgentCore-Runtime-Session-Id`, 33–256 characters), and
 *     the AWS SDK models it as an idempotency token — it fills a FRESH random id
 *     on every call that leaves it unset.
 *
 * ── 'per-call' (the default) ─────────────────────────────────────────────────
 * Every request in a session of its own: this strategy sends a FRESH runtime
 * session id with every request and no `Mcp-Session-Id`, and the
 * `Mcp-Session-Id` a response carries is not handed to the MCP client, so
 * nothing can carry one call's session into the next. Isolation by
 * construction: a client shared by every user of a process (tools built once at
 * startup — the common shape) never puts two users in one microVM. The price is
 * a cold start per call, and it needs a STATELESS server (`stateless_http=True`,
 * the runtime's recommended default) — a stateful one sees every request as a
 * stranger.
 *
 * ── 'reuse' ──────────────────────────────────────────────────────────────────
 * One session per CONNECTION (per `mcpClient` built on the transport), and the
 * TRANSPORT owns the key. A request with no `Mcp-Session-Id` (a client's
 * `initialize`) opens a connection with a fresh runtime session id; the
 * `Mcp-Session-Id` the server returns for it is stored WITH that connection,
 * and the client is handed an opaque handle of the transport's own in its
 * place. Every later request carrying the handle is sent in that connection's
 * runtime session with the server's own id. A handle the transport does not
 * know — one it never issued, or one it forgot — is never sent: the request
 * fails with `LocalSessionHandleLostError`, thrown from the transport's
 * `fetch`. It is not a 404: no server said anything, and the runtime session
 * behind a forgotten handle may still run — it can no longer be stopped from
 * here, because its id went with the handle.
 *
 * Why a handle and not the server's id: the server's ids are unique only as far
 * as the server makes them. One that numbers sessions per process hands every
 * fresh microVM the same first id, and a map keyed by it would send the second
 * client into the first one's microVM. A handle is ours, random, and per
 * connection, so two clients on one transport are two sessions whatever the
 * server returns — while ONE client is still one session for whoever calls
 * through it. Build a client per conversation; never share a 'reuse' client
 * between users.
 *
 * At most {@link MAX_CONNECTIONS} connections are remembered, least recently
 * used forgotten first. A client's `DELETE` — sent by `terminate()`, never by
 * `close()`, which ends only the local side — forgets its own handle first, and
 * then becomes `StopRuntimeSession` for that connection's runtime session
 * (`transport.ts`), answered like a server would answer the `DELETE`.
 *
 * Pattern: Strategy. Role: outer ring, vendor fact. Holds no credential.
 */

import { LocalSessionHandleLostError } from '../../../tools/toolSessions.js';

/** The runtime session header, as `InvokeAgentRuntime` binds `runtimeSessionId` to it. */
export const AGENTCORE_RUNTIME_SESSION_HEADER = 'X-Amzn-Bedrock-AgentCore-Runtime-Session-Id';

/** The MCP Streamable HTTP session header. */
export const MCP_SESSION_HEADER = 'Mcp-Session-Id';

/** Which session a request lands in. See the module note for each. */
export type AgentCoreRuntimeSession = 'reuse' | 'per-call';

/**
 * What a strategy does with one request: answer it here, unsent; let it go —
 * with its session headers fixed in place — and say what the MCP client may see
 * of the response; or, for a `'reuse'` connection's `DELETE`, stop that
 * connection's runtime session (`stop`, its runtime session id).
 */
export type SessionStep =
  | { readonly answer: Response }
  | { readonly settle: (response: Response) => Response }
  | { readonly stop: string };

/** One strategy, applied once per request the MCP client makes. */
export interface SessionStrategy {
  /**
   * @throws `LocalSessionHandleLostError` for a handle this strategy does not
   *   hold: nothing is sent
   */
  request(headers: Headers, method: string): SessionStep;
}

/** How many connections a 'reuse' transport remembers before it forgets the least recently used. */
export const MAX_CONNECTIONS = 256;

/**
 * A fresh runtime session id — `crypto.randomUUID()`, 36 characters, inside the
 * 33–256 the API takes. Never injectable: freshness IS the isolation, and a
 * source that repeated itself would put two requests (or two clients) in one
 * session.
 */
const newId = (): string => globalThis.crypto.randomUUID();

/**
 * Build the strategy for one transport.
 *
 * @throws when `kind` is not one of the two strategies.
 */
export function sessionStrategy(kind: AgentCoreRuntimeSession): SessionStrategy {
  if (kind === 'reuse') return reuse();
  if (kind === 'per-call') return perCall();
  throw new TypeError(
    `agentCoreRuntimeMcpTransport: \`session\` must be 'reuse' or 'per-call' — got ` +
      `${JSON.stringify(kind)}. 'per-call' gives every request its own session (safe to share); ` +
      `'reuse' keeps one runtime session per client (build one client per conversation).`,
  );
}

/** One client's connection: its runtime session, and the server's own session id once known. */
interface Connection {
  readonly runtimeId: string;
  serverSessionId?: string;
}

function reuse(): SessionStrategy {
  const connections = new Map<string, Connection>();
  const remember = (handle: string, connection: Connection): void => {
    connections.delete(handle);
    connections.set(handle, connection); // most recently used last
    while (connections.size > MAX_CONNECTIONS) {
      const oldest = connections.keys().next().value;
      if (oldest === undefined) break;
      connections.delete(oldest);
    }
  };
  return {
    request(headers, method) {
      const handle = headers.get(MCP_SESSION_HEADER);
      const known = handle === null ? undefined : connections.get(handle);
      // A handle this transport did not issue, or has forgotten: fail closed,
      // and say what happened — nothing was sent, and nothing answered.
      if (handle !== null && known === undefined) throw new LocalSessionHandleLostError();
      const connection: Connection = known ?? { runtimeId: newId() };
      if (handle !== null) {
        // Ending the session: the handle is forgotten FIRST, so nothing more is
        // ever sent under it, then the runtime session is stopped.
        if (method === 'DELETE') {
          connections.delete(handle);
          return { stop: connection.runtimeId };
        }
        remember(handle, connection);
      }
      // Set, not merged: these are the only session ids this request sends.
      headers.set(AGENTCORE_RUNTIME_SESSION_HEADER, connection.runtimeId);
      if (connection.serverSessionId !== undefined) {
        headers.set(MCP_SESSION_HEADER, connection.serverSessionId);
      } else {
        headers.delete(MCP_SESSION_HEADER);
      }
      return {
        settle: (response) => {
          const returned = response.headers.get(MCP_SESSION_HEADER);
          if (returned === null) return response;
          if (handle === null) {
            // A new connection: bound under a handle of our own, shown in the server's id's place.
            const issued = newId();
            remember(issued, { ...connection, serverSessionId: returned });
            return withSessionHeader(response, issued);
          }
          connection.serverSessionId = returned;
          return withSessionHeader(response, handle);
        },
      };
    },
  };
}

function perCall(): SessionStrategy {
  return {
    request(headers) {
      headers.delete(MCP_SESSION_HEADER);
      // A fresh runtime session of our own for every request — as fresh as the
      // SDK's own default, and set the same way on both auth paths.
      headers.set(AGENTCORE_RUNTIME_SESSION_HEADER, newId());
      return { settle: (response) => withSessionHeader(response, undefined) };
    },
  };
}

/**
 * The response with its `Mcp-Session-Id` replaced by `value`, or removed when
 * `value` is undefined. A fetched Response's headers are immutable, so the copy
 * is rebuilt around the same body rather than edited.
 */
function withSessionHeader(response: Response, value: string | undefined): Response {
  const current = response.headers.get(MCP_SESSION_HEADER);
  if (current === (value ?? null)) return response;
  const headers = new Headers(response.headers);
  if (value === undefined) headers.delete(MCP_SESSION_HEADER);
  else headers.set(MCP_SESSION_HEADER, value);
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}
