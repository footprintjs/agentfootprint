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
 * One session per CONNECTION (per `mcpClient` built on the transport): the
 * first request of a connection carries no `Mcp-Session-Id`, so it gets a fresh
 * runtime session id; the `Mcp-Session-Id` the runtime returns for it is then
 * bound to that runtime id, and every later request carrying it is sent in the
 * same runtime session. So two clients built from one transport object are two
 * sessions — but ONE client is one session for whoever calls through it. Build
 * a client per conversation; never share a 'reuse' client between users.
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
 * One strategy: fix a request's session headers in place, and say what the
 * MCP client may see of that request's response.
 */
export interface SessionStrategy {
  request(headers: Headers): (response: Response) => Response;
}

/** How many connections a 'reuse' transport remembers before it forgets the oldest. */
const MAX_CONNECTIONS = 256;

/**
 * Build the strategy for one transport.
 *
 * @param newId the runtime-session-id source, for tests; the default is
 *   `crypto.randomUUID()` — 36 characters, inside the 33–256 the API takes.
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

function reuse(newId: () => string): SessionStrategy {
  // The runtime session each CONNECTION was given, keyed by the Mcp-Session-Id
  // the runtime returned to it — so two clients on one transport stay apart.
  const runtimeIdOf = new Map<string, string>();
  const remember = (mcpSessionId: string, runtimeId: string): void => {
    if (runtimeIdOf.has(mcpSessionId)) return;
    if (runtimeIdOf.size >= MAX_CONNECTIONS) {
      const oldest = runtimeIdOf.keys().next().value;
      if (oldest !== undefined) runtimeIdOf.delete(oldest);
    }
    runtimeIdOf.set(mcpSessionId, runtimeId);
  };
  return {
    request(headers) {
      const carried = headers.get(MCP_SESSION_HEADER);
      // A request with no Mcp-Session-Id opens a connection: it gets a session
      // of its own, never the one another connection is using.
      const runtimeId = (carried !== null ? runtimeIdOf.get(carried) : undefined) ?? newId();
      if (carried !== null) remember(carried, runtimeId);
      // Set, not merged: this is the only runtime session id this request sends.
      headers.set(AGENTCORE_RUNTIME_SESSION_HEADER, runtimeId);
      return (response) => {
        const returned = response.headers.get(MCP_SESSION_HEADER);
        if (returned !== null) remember(returned, runtimeId);
        return response;
      };
    },
  };
}

const PER_CALL: SessionStrategy = {
  request(headers) {
    headers.delete(MCP_SESSION_HEADER);
    headers.delete(AGENTCORE_RUNTIME_SESSION_HEADER);
    return hideSession;
  },
};

/** The response with its Mcp-Session-Id removed, so the MCP client never carries one. */
function hideSession(response: Response): Response {
  if (!response.headers.has(MCP_SESSION_HEADER)) return response;
  // A fetched Response's headers are immutable, so the copy is rebuilt
  // around the same body rather than edited.
  const headers = new Headers(response.headers);
  headers.delete(MCP_SESSION_HEADER);
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}
