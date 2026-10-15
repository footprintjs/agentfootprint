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
 * ── 'reuse' (the default) ────────────────────────────────────────────────────
 * One session for the life of the transport. A runtime session id is chosen
 * ONCE and sent on every request, and the `Mcp-Session-Id` the service hands
 * back is carried by the MCP client exactly as for any Streamable HTTP server.
 * Pinning the runtime id is what stops the SDK's per-call default from putting
 * each request in a session of its own. One transport is one session, so a
 * client built per conversation is a session per conversation — and a client
 * SHARED by two conversations is one session for both. Build per conversation.
 *
 * ── 'per-call' ───────────────────────────────────────────────────────────────
 * Every request in a session of its own: this strategy sends no session id of
 * its own — on SigV4 the SDK then fills a fresh random `runtimeSessionId` per
 * call, which is exactly what this wants — and the `Mcp-Session-Id` a response
 * carries is not handed to the MCP client, so nothing can carry one call's
 * session into the next. Isolation by
 * construction, a cold start per call, and it needs a STATELESS server
 * (`stateless_http=True`, the runtime's recommended default) — a stateful one
 * would see every request as a stranger.
 *
 * Pattern: Strategy. Role: outer ring, vendor fact. Holds no credential.
 */

/** The runtime session header, as `InvokeAgentRuntime` binds `runtimeSessionId` to it. */
export const AGENTCORE_RUNTIME_SESSION_HEADER = 'X-Amzn-Bedrock-AgentCore-Runtime-Session-Id';

/** The MCP Streamable HTTP session header. */
export const MCP_SESSION_HEADER = 'Mcp-Session-Id';

/** Which session a request lands in. See the module note for each. */
export type AgentCoreRuntimeSession = 'reuse' | 'per-call';

/** One strategy: what a request carries out, and what a response hands back. */
export interface SessionStrategy {
  /** Set or strip this request's session headers, in place. */
  request(headers: Headers): void;
  /** The response as the MCP client may see it. */
  response(response: Response): Response;
}

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
  if (kind === 'reuse') return reuse(newId());
  if (kind === 'per-call') return PER_CALL;
  throw new TypeError(
    `agentCoreRuntimeMcpTransport: \`session\` must be 'reuse' or 'per-call' — got ` +
      `${JSON.stringify(kind)}. 'reuse' keeps one runtime session for this transport ` +
      `(build one client per conversation); 'per-call' gives every request its own.`,
  );
}

function reuse(runtimeSessionId: string): SessionStrategy {
  return {
    // Set, not merged: the pinned id is the only one this transport sends.
    request: (headers) => headers.set(AGENTCORE_RUNTIME_SESSION_HEADER, runtimeSessionId),
    response: (response) => response,
  };
}

const PER_CALL: SessionStrategy = {
  request(headers) {
    headers.delete(MCP_SESSION_HEADER);
    headers.delete(AGENTCORE_RUNTIME_SESSION_HEADER);
  },
  response(response) {
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
  },
};
