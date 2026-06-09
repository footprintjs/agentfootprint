/**
 * agentfootprint/identity — the CredentialProvider port.
 *
 * OUTBOUND auth: vend a credential/token so a tool can call a downstream service
 * (GitHub, Slack, Google…) on behalf of the agent or the end user. This is
 * DISTINCT from `agentfootprint/security` (authorization — "is this tool
 * allowed"); identity answers "get me a token to call X".
 *
 * Pattern: Port (Hexagonal). Vendors plug in as adapters:
 *   - `agentCoreIdentity()` — AWS Bedrock AgentCore Identity (token vault + OAuth)
 *   - `staticTokens()`      — dev/test (canned tokens, no network)
 *
 * Two flows, mirroring OAuth (and AgentCore's `M2M` vs `USER_FEDERATION`):
 *   - `mode: 'machine'` (2-legged) — client-credentials; returns a token directly.
 *   - `mode: 'user'`    (3-legged) — user-delegated; may need consent. When it
 *     does, the provider returns `authorization-required` with a URL; the agent
 *     surfaces it to the human (e.g. via pause/resume) and retries after consent.
 *     (Most calls skip consent — providers cache refresh tokens.)
 *
 * **Security invariant:** a vended token is a SECRET. Callers MUST use it locally
 * (e.g. as an HTTP header inside a tool's `execute`) and MUST NOT write it to
 * tracked scope (`setValue`) — tracked writes flow to the commit log, recorders,
 * and observability exporters, which would leak the token into the trace. Pair
 * with `RedactionPolicy` for defence in depth.
 */

/** What a tool/agent asks for. `service` ↔ the provider's downstream service id. */
export interface CredentialRequest {
  /** Downstream service id, e.g. 'github', 'slack', 'google'. */
  readonly service: string;
  /** OAuth scopes to request. */
  readonly scopes?: readonly string[];
  /** `machine` = 2-legged (M2M); `user` = 3-legged (on behalf of a user). Default `machine`. */
  readonly mode?: 'machine' | 'user';
  /** The principal/tenant the token is for (the agent + end-user identity). */
  readonly identity?: { readonly principal?: string; readonly tenant?: string };
  /** Force a fresh authorization, bypassing any cached/refresh token. */
  readonly forceReauth?: boolean;
}

/** A ready-to-use credential. `token` is a SECRET — see the security invariant. */
export interface CredentialToken {
  readonly status: 'token';
  readonly token: string;
  /** Unix seconds when the token expires, if known. */
  readonly expiresAt?: number;
}

/** 3-legged consent is required: surface `authorizationUrl` to the user, then
 *  retry `getCredential` after they authorize (`sessionId` correlates the flow). */
export interface CredentialAuthorizationRequired {
  readonly status: 'authorization-required';
  readonly authorizationUrl: string;
  readonly sessionId: string;
}

export type CredentialResult = CredentialToken | CredentialAuthorizationRequired;

/** The port. An adapter implements this against a specific identity backend. */
export interface CredentialProvider {
  /** Stable id (for logging / "which provider vended this"). */
  readonly id: string;
  getCredential(req: CredentialRequest): Promise<CredentialResult>;
}

/** Narrow a {@link CredentialResult} to the token branch. */
export function isCredentialToken(r: CredentialResult): r is CredentialToken {
  return r.status === 'token';
}
