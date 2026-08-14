/**
 * gatewayTransport — an MCP transport whose auth headers are vended per
 * request, not per connection.
 *
 *   const gateway = await mcpClient({
 *     name: 'gateway',
 *     transport: gatewayTransport({ url, credentials, service: 'gateway' }),
 *   });
 *
 * ── Why this exists ──────────────────────────────────────────────────────────
 * The `http` transport takes headers once and reuses them for the life of the
 * connection. That is right for a static API key and wrong for anything with an
 * expiry: a standing agent outlives its bearer token, and the failure mode is a
 * burst of 401s an hour into a session that worked perfectly when you tested
 * it. Managed gateways — AgentCore's among them — hand out exactly that kind of
 * token, so "get a fresh one before each request" is not an optimisation, it is
 * the only way the connection stays up.
 *
 * Nothing here is vendor-specific. It is the {@link CredentialProvider} port on
 * one side and Streamable HTTP on the other; who vends is your choice.
 *
 * ── The secrecy invariant, and how it is kept ────────────────────────────────
 * **A vended token is used once and dropped.** It is not cached between
 * requests, not stored on the transport object, not put in an event payload,
 * not written to a log, and not included in any error this module throws —
 * including the errors it throws WHILE holding one. A test asserts that: a
 * hostile logger subscribed to everything the library can say never sees the
 * header value.
 *
 * That is why the vend happens inside `fetch` rather than at construction. A
 * token resolved at construction has to live somewhere for the connection to
 * use it later, and "somewhere" is what leaks.
 *
 * Pattern: Adapter + Decorator over `fetch`. Role: Layer-3 tool integration.
 */

import { isCredentialIssued, type CredentialProvider } from '../../identity/types.js';
import type { McpGatewayTransport } from './types.js';

/** Options for {@link gatewayTransport}. */
export interface GatewayTransportOptions {
  /** The MCP endpoint URL. */
  readonly url: string;
  /** Who vends the token — any `CredentialProvider`. */
  readonly credentials: CredentialProvider;
  /**
   * The downstream service id the provider understands. Default `'gateway'`.
   * `staticTokens({ gateway: '...' })` and `agentCoreIdentity()` both key on it.
   */
  readonly service?: string;
  /** OAuth scopes to request, when the provider uses them. */
  readonly scopes?: readonly string[];
  /** `machine` (2-legged, the default) or `user` (3-legged, on behalf of a user). */
  readonly mode?: 'machine' | 'user';
  /**
   * Extra headers sent alongside the vended ones. Applied FIRST, so a vended
   * auth header always wins. **Put no secrets here** — these are held for the
   * life of the transport, which is what the vended ones exist to avoid.
   */
  readonly headers?: Readonly<Record<string, string>>;
  /**
   * Your own `fetch`, called UNDERNEATH the per-request vending (9.32.0).
   *
   * ── The gap this closes ──────────────────────────────────────────────────
   * Some gateways do not authenticate with a bearer alone. A managed identity
   * path may want a client certificate (mTLS) or a proof-of-possession
   * signature over the request itself (DPoP) — things computed FROM the
   * request, which no header fixed at construction can express. Until this
   * existed the only workaround was to abandon this transport for the generic
   * `http` one, which has a `fetch` seam and fixes its headers at connect
   * time — so a caller traded away token rotation to get a client certificate.
   * That is a bad trade, and it was the shape an independent field trial
   * reported (2026-08-13): *"exposes bearer-credential, header and scope
   * options, but no certificate, DPoP or custom-fetch seam."*
   *
   * ── The composition, and its order ───────────────────────────────────────
   * The credential is vended FIRST and applied to the request; your function is
   * then called with that request. So a signer sees the final headers and has
   * the last word over the bytes, exactly as it does on the `http` transport —
   * and the vending still happens on every request, so rotation is not lost.
   *
   * **Zero vendor code lives here.** This library ships no signer, no
   * certificate loader and no DPoP implementation; a scheme this repo has never
   * heard of works on the day you write it. Whatever you do inside is between
   * you and the server.
   *
   * ── What the secrecy invariant still guarantees ──────────────────────────
   * Your function sees the request it is asked to send, headers included —
   * which is what makes signing possible and is the whole point of the seam.
   * What is still true is everything this module controls: the vended value is
   * never cached, never stored on the transport, and never enters an event, an
   * error or a log. A `fetch` you inject that logs its own headers is
   * publishing your credential, and that is your decision to make in your code
   * rather than something this library can do behind you.
   *
   * @example  mTLS, through an agent you own
   *   gatewayTransport({
   *     url, credentials, service: 'gateway',
   *     fetch: (input, init) => fetch(input, { ...init, dispatcher: mtlsAgent }),
   *   })
   *
   * @example  Proof-of-possession over the request
   *   gatewayTransport({
   *     url, credentials,
   *     fetch: async (input, init) => {
   *       const headers = new Headers(init?.headers);
   *       headers.set('dpop', await sign(init?.method ?? 'POST', String(input)));
   *       return fetch(input, { ...init, headers });
   *     },
   *   })
   */
  readonly fetch?: FetchLike;
}

const DEFAULT_SERVICE = 'gateway';

/**
 * Describe an MCP connection whose auth headers are vended per request.
 *
 * @example  A managed gateway with a token vault behind it
 *   import { agentCoreIdentity } from 'agentfootprint/security';
 *   import { gatewayTransport, mcpClient } from 'agentfootprint/providers';
 *
 *   const gateway = await mcpClient({
 *     name: 'gateway',
 *     transport: gatewayTransport({
 *       url: process.env.GATEWAY_MCP_URL!,
 *       credentials: agentCoreIdentity({ region: 'us-west-2' }),
 *       service: 'gateway',
 *     }),
 *   });
 *   const agent = Agent.create({ provider, model }).tools(await gateway.tools()).build();
 */
export function gatewayTransport(options: GatewayTransportOptions): McpGatewayTransport {
  if (!options.url) throw new Error(`gatewayTransport requires 'url'.`);
  if (!options.credentials) throw new Error(`gatewayTransport requires 'credentials'.`);
  return {
    transport: 'gateway',
    url: options.url,
    credentials: options.credentials,
    service: options.service ?? DEFAULT_SERVICE,
    ...(options.scopes !== undefined && { scopes: options.scopes }),
    ...(options.mode !== undefined && { mode: options.mode }),
    ...(options.headers !== undefined && { headers: options.headers }),
    ...(options.fetch !== undefined && { fetch: options.fetch }),
  };
}

/**
 * Raised when the provider needs a human to authorize before it can vend.
 *
 * The URL is carried so the caller can surface it (pause the run, show a
 * link); **the token is not, because there is not one yet** — that is the whole
 * meaning of this error.
 */
export class GatewayAuthorizationRequiredError extends Error {
  readonly code = 'ERR_GATEWAY_AUTHORIZATION_REQUIRED' as const;
  /** Send the user here, then retry. */
  readonly authorizationUrl: string;

  constructor(service: string, authorizationUrl: string) {
    super(
      `[mcp] the credential provider needs a person to authorize '${service}' before it can ` +
        `vend a token for this gateway. A transport cannot run a consent flow mid-request — ` +
        `surface the authorization URL to the user (pause the run), then call the tool again ` +
        `once they have authorized.`,
    );
    this.name = 'GatewayAuthorizationRequiredError';
    this.authorizationUrl = authorizationUrl;
  }
}

/** Just the part of `fetch` this module needs, so it is trivially injectable in tests. */
export type FetchLike = (input: string | URL | Request, init?: RequestInit) => Promise<Response>;

/**
 * Build the `fetch` the MCP SDK will use: one that vends a credential, applies
 * it to this one request, and keeps nothing.
 *
 * Exported for tests — the secrecy invariant is asserted against this function
 * directly, because that is where a leak would happen and driving a whole SDK
 * to reach it would test less while looking like it tested more.
 *
 * @internal
 */
export function createVendingFetch(
  transport: McpGatewayTransport,
  baseFetch: FetchLike = globalThis.fetch.bind(globalThis),
): FetchLike {
  return async (input, init) => {
    const result = await transport.credentials.getCredential({
      service: transport.service,
      ...(transport.scopes !== undefined && { scopes: transport.scopes }),
      ...(transport.mode !== undefined && { mode: transport.mode }),
    });
    if (!isCredentialIssued(result)) {
      throw new GatewayAuthorizationRequiredError(transport.service, result.authorizationUrl);
    }

    // Static headers first, vended ones last: a vended auth header always wins,
    // so a stale static one can never quietly shadow the live credential.
    const headers = new Headers(init?.headers ?? {});
    for (const [key, value] of Object.entries(transport.headers ?? {})) headers.set(key, value);
    for (const [key, value] of Object.entries(result.credential.toHeaders())) {
      headers.set(key, value);
    }

    // The vended value exists only inside this call, on this Headers object,
    // for the duration of this request. Nothing above closes over it.
    return baseFetch(input, { ...init, headers });
  };
}
