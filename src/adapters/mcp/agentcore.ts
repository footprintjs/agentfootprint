/**
 * adapters/mcp/agentcore — reaching an AWS Bedrock **AgentCore Gateway**.
 *
 * ── What lives here, and why it is one file ──────────────────────────────────
 * A Gateway is an MCP server, and `mcpClient` + `gatewayTransport` already know
 * how to talk to one of those. Neither knows — and neither should learn — the
 * handful of facts that are AgentCore's alone: the hostname its endpoints take,
 * the name of the tool that searches its catalogue, the header that groups a
 * caller's requests into one policy session, and the service name a SigV4
 * signature is computed against. Those four facts are this file, and this file
 * is the only place in the library that holds them.
 *
 * `gatewayTransport` says of itself: *"Nothing here is vendor-specific."* That
 * stays true precisely because this exists next to it.
 *
 * ── What it does NOT do ──────────────────────────────────────────────────────
 * It does not manage a Gateway. Creating one, adding targets, attaching a
 * policy engine, enabling semantic search — all control-plane operations on
 * `bedrock-agentcore-control`, all things an operator does once with the
 * console, the CLI or their IaC. This is the CLIENT side: an agent using a
 * gateway somebody already stood up.
 *
 * @example  An agent whose tools come from a Gateway
 *   import { mcpClient } from 'agentfootprint/providers';
 *   import { agentCoreGatewayTransport } from 'agentfootprint/providers';
 *   import { agentCoreIdentity } from 'agentfootprint/security';
 *
 *   const gateway = await mcpClient({
 *     name: 'gateway',
 *     transport: agentCoreGatewayTransport({
 *       gatewayId: 'my-gateway-a1b2c3d4e5',
 *       region: 'us-east-1',
 *       credentials: agentCoreIdentity({ region: 'us-east-1' }),
 *     }),
 *   });
 *   const tools = await gateway.tools();
 */

import { gatewayTransport, type FetchLike } from '../../lib/mcp/gatewayTransport.js';
import type { McpGatewayTransport } from '../../lib/mcp/types.js';
import type { CredentialProvider } from '../../identity/types.js';
import type { Tool } from '../../core/tools.js';

/**
 * The Gateway's built-in semantic tool search, by its exact wire name.
 *
 * It is an ordinary MCP tool — `tools/call` with `{ query }` — that returns the
 * catalogue entries closest to a natural-language description. It matters at
 * the scale where listing every tool into a prompt stops being sensible.
 *
 * **It can only be enabled when the Gateway is CREATED**, never afterwards, so
 * its absence from a catalogue is a fact about that gateway rather than a
 * transient condition to retry.
 */
export const AGENTCORE_GATEWAY_SEARCH_TOOL = 'x_amz_bedrock_agentcore_search';

/**
 * The header that groups a caller's requests into ONE policy session.
 *
 * AgentCore's temporal policies decide on SEQUENCES of actions — "not after
 * three refunds", "only once this was approved" — and a sequence needs a
 * boundary. This header is that boundary, and without it every request is its
 * own history of one, which quietly makes every sequence rule unenforceable.
 */
export const AGENTCORE_POLICY_SESSION_HEADER = 'x-amzn-bedrock-agentcore-policy-session-id';

/** The service name a SigV4 signature for a Gateway is computed against. */
export const AGENTCORE_SIGV4_SERVICE = 'bedrock-agentcore';

export interface AgentCoreGatewayUrlOptions {
  /** The gateway's id, as the console and `CreateGateway`'s response give it. */
  readonly gatewayId: string;
  /** The region it lives in, e.g. `'us-east-1'`. */
  readonly region: string;
}

/**
 * The MCP endpoint of a Gateway.
 *
 * `https://{gatewayId}.gateway.bedrock-agentcore.{region}.amazonaws.com/mcp` —
 * a shape nobody remembers correctly, which is the entire reason it is a
 * function and not a line in a README.
 */
export function agentCoreGatewayUrl(options: AgentCoreGatewayUrlOptions): string {
  const { gatewayId, region } = options;
  if (!gatewayId || !region) {
    throw new TypeError(
      'agentCoreGatewayUrl: both `gatewayId` and `region` are required — the endpoint hostname ' +
        'is built from the two.',
    );
  }
  return `https://${gatewayId}.gateway.bedrock-agentcore.${region}.amazonaws.com/mcp`;
}

export interface AgentCoreGatewayTransportOptions extends AgentCoreGatewayUrlOptions {
  /** Who vends the token. `agentCoreIdentity()` is the usual answer. */
  readonly credentials: CredentialProvider;
  /** The downstream service id your provider keys on. Default `'gateway'`. */
  readonly service?: string;
  /** OAuth scopes, when the provider uses them. */
  readonly scopes?: readonly string[];
  /** `machine` (default) or `user`, for a gateway that acts on someone's behalf. */
  readonly mode?: 'machine' | 'user';
  /**
   * The policy session this caller's requests belong to — a string, or a
   * function consulted PER REQUEST.
   *
   * **Prefer the function on any transport more than one person shares.** A
   * fixed string on a shared transport merges every caller's action history
   * into a single policy session, which is not a small mistake: it makes one
   * person's earlier actions count against another person's rule. Passing
   * `() => currentSessionId` keeps the boundary where it belongs, and returning
   * `undefined` sends no header at all.
   */
  readonly policySessionId?: string | (() => string | undefined);
  /** Extra static headers. **No secrets** — these live as long as the transport. */
  readonly headers?: Readonly<Record<string, string>>;
  /** Your own `fetch`, called underneath the per-request vending. */
  readonly fetch?: FetchLike;
}

/**
 * An MCP transport pointed at an AgentCore Gateway.
 *
 * A configuration of {@link gatewayTransport}: the endpoint built from your
 * gateway's id and region, and — when you name one — the policy session header
 * stamped on every request. Token vending, the once-and-dropped secrecy rule
 * and the rotation behaviour are all the neutral transport's, unchanged.
 */
export function agentCoreGatewayTransport(
  options: AgentCoreGatewayTransportOptions,
): McpGatewayTransport {
  const { policySessionId, fetch: innerFetch } = options;

  // The header is stamped in the `fetch` seam rather than in `headers` because
  // the seam runs per request. That is what lets the session id come from a
  // function, which is what keeps two people on one transport in two sessions.
  const stampPolicySession: FetchLike | undefined =
    policySessionId === undefined
      ? innerFetch
      : async (input, init) => {
          const id = typeof policySessionId === 'function' ? policySessionId() : policySessionId;
          const next =
            id === undefined || id === ''
              ? init
              : {
                  ...init,
                  headers: {
                    ...(init?.headers as Record<string, string>),
                    [AGENTCORE_POLICY_SESSION_HEADER]: id,
                  },
                };
          return innerFetch ? innerFetch(input, next) : globalThis.fetch(input, next);
        };

  return gatewayTransport({
    url: agentCoreGatewayUrl(options),
    credentials: options.credentials,
    ...(options.service !== undefined && { service: options.service }),
    ...(options.scopes !== undefined && { scopes: options.scopes }),
    ...(options.mode !== undefined && { mode: options.mode }),
    ...(options.headers !== undefined && { headers: options.headers }),
    ...(stampPolicySession !== undefined && { fetch: stampPolicySession }),
  });
}

/**
 * The Gateway's semantic search tool, if this gateway has one.
 *
 * Returns `undefined` rather than throwing, because absence is a legitimate and
 * PERMANENT answer: semantic search is enabled when a Gateway is created and
 * cannot be turned on afterwards, so there is nothing to retry.
 *
 * ── Why this finds the tool instead of calling it ────────────────────────────
 * The obvious convenience would be `search(gateway, 'refund an order')`, and it
 * is deliberately not here. Executing a tool needs a `ToolExecutionContext` —
 * the call id, the iteration, the credential seam, the artifact store — and
 * that object belongs to the agent loop. A helper would have to invent one,
 * and a call made on an invented context is a call that appears in no trace:
 * the model would be handed a shortlist nobody can later explain the origin of,
 * which is the opposite of what this library is for.
 *
 * So the search tool is registered like any other tool, the model calls it when
 * the catalogue is too large to reason about, and that call is an ordinary
 * tool call in the trace — visible, attributable, and replayable.
 *
 * @example  Give the model the catalogue's own search
 *   const tools = await gateway.tools();
 *   const search = gatewaySearchTool(tools);
 *   Agent.create({ provider, model })
 *     .tools(search ? [search] : tools)   // search it, or list it
 *     .build();
 */
export function gatewaySearchTool(tools: readonly Tool[]): Tool | undefined {
  return tools.find((t) => t.schema.name === AGENTCORE_GATEWAY_SEARCH_TOOL);
}

/** Whether this gateway's catalogue can be searched rather than listed. */
export function hasGatewaySearch(tools: readonly Tool[]): boolean {
  return gatewaySearchTool(tools) !== undefined;
}
