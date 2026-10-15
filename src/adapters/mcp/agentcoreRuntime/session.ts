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
 * Every request in a session of its own: this strategy sends no session id of
 * its own — on SigV4 the SDK then fills a fresh random `runtimeSessionId` per
 * call — and the `Mcp-Session-Id` a response carries is not handed to the MCP
 * client, so nothing can carry one call's session into the next. Isolation by
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
 * runtime session with the server's own id; a handle the transport does not
 * know is answered 404 "Session not found" here, never sent.
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
 * used forgotten first; a client's `DELETE` (its `close()`) forgets its own.
 *
 * Pattern: Strategy. Role: outer ring, vendor fact. Holds no credential.
 */

/** The runtime session header, as `InvokeAgentRuntime` binds `runtimeSessionId` to it. */
export const AGENTCORE_RUNTIME_SESSION_HEADER = 'X-Amzn-Bedrock-AgentCore-Runtime-Session-Id';

/** The MCP Streamable HTTP session header. */
export const MCP_SESSION_HEADER = 'Mcp-Session-Id';

/** Which session a request lands in. See the module note for each. */
export type AgentCoreRuntimeSession = 'reuse' | 'per-call';

/**
 * What a strategy does with one request: either answer it here, unsent, or
 * let it go — with its session headers fixed in place — and say what the MCP
 * client may see of the response.
 */
export type SessionStep =
  | { readonly answer: Response }
  | { readonly settle: (response: Response) => Response };

/** One strategy, applied once per request the MCP client makes. */
export interface SessionStrategy {
  request(headers: Headers, method: string): SessionStep;
}

/** How many connections a 'reuse' transport remembers before it forgets the least recently used. */
export const MAX_CONNECTIONS = 256;

/**
 * Build the strategy for one transport.
 *
 * @param newId the source of runtime session ids, for tests; the default is
 *   `crypto.randomUUID()` — 36 characters, inside the 33–256 the API takes.
 *   Connection handles always come from `crypto.randomUUID()`: they are the
 *   isolation key, and no caller supplies them.
 * @throws when `kind` is not one of the two strategies.
 */
export function sessionStrategy(
  kind: AgentCoreRuntimeSession,
  newId: () => string = () => globalThis.crypto.randomUUID(),
): SessionStrategy {
  if (kind === 'reuse') return reuse(newId);
  if (kind === 'per-call') return PER_CALL;
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

function reuse(newId: () => string): SessionStrategy {
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
      // A handle this transport did not issue, or has forgotten: fail closed.
      if (handle !== null && known === undefined) return { answer: sessionNotFound() };
      const connection: Connection = known ?? { runtimeId: newId() };
      if (handle !== null) {
        if (method === 'DELETE') connections.delete(handle);
        else remember(handle, connection);
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
            const issued = globalThis.crypto.randomUUID();
            remember(issued, { ...connection, serverSessionId: returned });
            return withSessionHeader(response, issued);
          }
          if (method !== 'DELETE') connection.serverSessionId = returned;
          return withSessionHeader(response, handle);
        },
      };
    },
  };
}

const PER_CALL: SessionStrategy = {
  request(headers) {
    headers.delete(MCP_SESSION_HEADER);
    headers.delete(AGENTCORE_RUNTIME_SESSION_HEADER);
    return { settle: (response) => withSessionHeader(response, undefined) };
  },
};

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

/**
 * The MCP Streamable HTTP answer to a session the server does not know: 404,
 * after which a client starts a new session with `initialize`.
 */
function sessionNotFound(): Response {
  return new Response(
    JSON.stringify({
      jsonrpc: '2.0',
      id: null,
      error: { code: -32001, message: 'Session not found' },
    }),
    { status: 404, headers: { 'content-type': 'application/json' } },
  );
}
