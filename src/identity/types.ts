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

/**
 * A credential, ready to apply to a downstream request. It carries its `kind`
 * (so you can read the raw value when you must) AND a **universal applicator**
 * `toHeaders()` — the way to USE it without switching on `kind`. Built-in kinds
 * (`bearer`/`apiKey`/`basic`/`headers`) live in `./kinds`; a custom kind is any
 * object implementing this protocol — so new credential types plug in with no
 * library change.
 *
 * **SECRET.** Use it locally (e.g. `headers: cred.toHeaders()`) inside a tool;
 * never write it to tracked scope. It is a live object (carries `toHeaders`),
 * so it is intentionally NOT serializable — credentials are used immediately
 * and never persisted/traced.
 */
export interface Credential {
  /** Discriminator: 'bearer' | 'apiKey' | 'basic' | 'headers' | <your kind>. */
  readonly kind: string;
  /** The auth header(s) to add to a downstream HTTP request. Universal across kinds. */
  toHeaders(): Record<string, string>;
}

/** The provider issued a credential (the 2-legged / refreshed-3-legged happy path). */
export interface CredentialIssued {
  readonly status: 'issued';
  readonly credential: Credential;
  /** Unix seconds when it expires, if known. */
  readonly expiresAt?: number;
}

/** 3-legged consent is required: surface `authorizationUrl` to the user, then
 *  retry `getCredential` after they authorize (`sessionId` correlates the flow). */
export interface CredentialAuthorizationRequired {
  readonly status: 'authorization-required';
  readonly authorizationUrl: string;
  readonly sessionId: string;
}

export type CredentialResult = CredentialIssued | CredentialAuthorizationRequired;

/** The port. An adapter implements this against a specific identity backend. */
export interface CredentialProvider {
  /** Stable id (for logging / "which provider vended this"). */
  readonly id: string;
  getCredential(req: CredentialRequest): Promise<CredentialResult>;
}

/** Narrow a {@link CredentialResult} to the issued-credential branch. */
export function isCredentialIssued(r: CredentialResult): r is CredentialIssued {
  return r.status === 'issued';
}
