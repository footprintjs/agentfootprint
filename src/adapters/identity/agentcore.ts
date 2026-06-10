/**
 * agentCoreIdentity — AWS Bedrock AgentCore Identity adapter (peer-dep
 * `@aws-sdk/client-bedrock-agentcore`).
 *
 *   import { agentCoreIdentity } from 'agentfootprint/identity';
 *   const credentials = agentCoreIdentity({ region: 'us-east-1' });
 *
 * Maps the {@link CredentialProvider} port onto AgentCore Identity's
 * `GetResourceOauth2Token` (the SDK's `@requires_access_token` underneath):
 *   - request.mode 'machine' → `M2M`; 'user' → `USER_FEDERATION`
 *   - request.service        → the configured OAuth2 credential-provider name
 *   - request.identity       → (per-request workload identity scoping; see below)
 *   - a returned access token → `{ status: 'issued', credential: bearer(token) }`
 *   - a returned auth URL     → `{ status: 'authorization-required' }` (3LO consent)
 *
 * The token vault + refresh-token handling live in AgentCore, so repeat calls
 * usually return a token directly (no consent round-trip).
 *
 * **Per-request identity forwarding (workload identity scoping).**
 * `GetResourceOauth2Token` carries NO user/tenant field — in AgentCore the
 * user identity is bound EARLIER, at workload-token acquisition:
 * `GetWorkloadAccessTokenForUserId(workloadName, userId)` returns a workload
 * access token scoped to that user, and AgentCore keys its token vault + 3LO
 * grants per (workload, user). So this adapter forwards `req.identity` (the
 * `runIdentity` that the agent threads through `getCredential`) by resolving a
 * per-user workload token first, then vending with it. Engages only when ALL of:
 *   - `req.mode === 'user'` (USER_FEDERATION — M2M is the workload's own identity),
 *   - a userId derives from `req.identity` (default `identity.principal`;
 *     override via `userIdFor`), and
 *   - `options.workloadName` is configured (the opt-in).
 * Otherwise the static `options.workloadIdentityToken` flows exactly as before.
 * `tenant` has no native AgentCore field and is NOT forwarded by default —
 * tenant isolation derives from the workload identity itself (per-tenant
 * workloads), or encode it via `userIdFor` (e.g. `${tenant}:${principal}`).
 *
 * Pattern: Adapter (GoF) + lazy peer-dep load — the AWS SDK is required only when
 * `getCredential` first runs (or never, if you inject `_client`). NOTE: confirm
 * the SDK command/field names against your installed
 * `@aws-sdk/client-bedrock-agentcore` version — this adapter targets the
 * `GetResourceOauth2Token` shape and is structured so the request→result mapping
 * is unit-tested via the `_client` seam independent of the SDK.
 */

import { lazyRequire } from '../../lib/lazyRequire.js';
import type {
  CredentialProvider,
  CredentialRequest,
  CredentialResult,
} from '../../identity/types.js';
import { bearer } from '../../identity/kinds.js';

/** Raw result shape we consume from the AgentCore identity client. */
export interface AgentCoreOauthResponse {
  readonly accessToken?: string;
  readonly authorizationUrl?: string;
  readonly sessionId?: string;
  /** Unix seconds. */
  readonly expiresAt?: number;
}

/** The minimal client surface the adapter calls — wraps `GetResourceOauth2Token`
 *  and (for per-user workload scoping) `GetWorkloadAccessTokenForUserId`.
 *  The real AWS SDK client is adapted to this; tests inject a fake via `_client`. */
export interface AgentCoreIdentityClientLike {
  getResourceOauth2Token(input: {
    readonly resourceCredentialProviderName: string;
    readonly scopes: readonly string[];
    readonly oauth2Flow: 'M2M' | 'USER_FEDERATION';
    readonly forceAuthentication: boolean;
    readonly workloadIdentityToken?: string;
  }): Promise<AgentCoreOauthResponse>;
  /** Optional — required only when `workloadName` is configured. Exchanges
   *  (workloadName, userId) for a USER-SCOPED workload access token; AgentCore
   *  keys its token vault + 3LO grants per (workload, user). */
  getWorkloadAccessTokenForUserId?(input: {
    readonly workloadName: string;
    readonly userId: string;
  }): Promise<{ readonly workloadAccessToken?: string }>;
}

export interface AgentCoreIdentityOptions {
  readonly region?: string;
  /** The agent's workload access token (AgentCore Runtime injects one in-container;
   *  supply it explicitly when running elsewhere). Used as-is unless a per-user
   *  workload token is resolved (see `workloadName`). */
  readonly workloadIdentityToken?: string;
  /** The AgentCore workload identity name — the OPT-IN for per-request identity
   *  scoping. When set, `mode: 'user'` requests carrying `req.identity` resolve a
   *  per-user workload access token via `GetWorkloadAccessTokenForUserId(workloadName,
   *  userId)` before vending, so AgentCore's token vault + 3LO grants are keyed per
   *  (workload, user) instead of per workload. Omit → today's static-token behavior. */
  readonly workloadName?: string;
  /** Map `req.identity` → the AgentCore `userId`. Default: `identity.principal`.
   *  `tenant` has no native AgentCore field — encode it here if you need
   *  tenant-scoped vault entries (e.g. ``({ tenant, principal }) =>
   *  tenant && principal ? `${tenant}:${principal}` : principal``). Return
   *  `undefined` to skip per-user scoping for that request. */
  readonly userIdFor?: (identity: {
    readonly principal?: string;
    readonly tenant?: string;
  }) => string | undefined;
  /** Stable provider id (default 'agentcore-identity'). */
  readonly id?: string;
  /** Test seam — inject a client implementing {@link AgentCoreIdentityClientLike}. */
  readonly _client?: AgentCoreIdentityClientLike;
}

function resolveClient(options: AgentCoreIdentityOptions): AgentCoreIdentityClientLike {
  if (options._client) return options._client;
  // Lazy peer-dep: only loaded when no _client is injected and getCredential runs.
  const sdk = lazyRequire<Record<string, unknown>>('@aws-sdk/client-bedrock-agentcore');
  const Ctor = sdk.BedrockAgentCoreClient as
    | (new (cfg: { region?: string }) => Record<string, unknown>)
    | undefined;
  if (!Ctor) {
    throw new Error(
      'agentCoreIdentity: @aws-sdk/client-bedrock-agentcore did not expose BedrockAgentCoreClient. ' +
        'Install/upgrade the SDK, or pass `_client` for a custom integration.',
    );
  }
  const client = new Ctor({ ...(options.region && { region: options.region }) }) as {
    getResourceOauth2Token?: (input: unknown) => Promise<AgentCoreOauthResponse>;
    getWorkloadAccessTokenForUserId?: (input: unknown) => Promise<{ workloadAccessToken?: string }>;
  };
  if (typeof client.getResourceOauth2Token !== 'function') {
    throw new Error(
      'agentCoreIdentity: the SDK client has no getResourceOauth2Token. Confirm the ' +
        '@aws-sdk/client-bedrock-agentcore version, or pass `_client`.',
    );
  }
  return {
    getResourceOauth2Token: (input) =>
      client.getResourceOauth2Token!(input) as Promise<AgentCoreOauthResponse>,
    // Duck-typed like the primary call — only wired when the SDK exposes it
    // (used only when `workloadName` is configured).
    ...(typeof client.getWorkloadAccessTokenForUserId === 'function' && {
      getWorkloadAccessTokenForUserId: (input: { workloadName: string; userId: string }) =>
        client.getWorkloadAccessTokenForUserId!(input),
    }),
  };
}

const defaultUserIdFor = (identity: { readonly principal?: string }): string | undefined =>
  identity.principal;

/** Build a {@link CredentialProvider} backed by AWS Bedrock AgentCore Identity. */
export function agentCoreIdentity(options: AgentCoreIdentityOptions = {}): CredentialProvider {
  let client: AgentCoreIdentityClientLike | undefined;
  const getClient = (): AgentCoreIdentityClientLike => (client ??= resolveClient(options));
  const userIdFor = options.userIdFor ?? defaultUserIdFor;

  // Per-request identity forwarding (workload identity scoping) — see module
  // header. `GetResourceOauth2Token` has no user field; the user is bound at
  // workload-token acquisition, so a `mode: 'user'` request carrying an
  // identity exchanges (workloadName, userId) for a USER-SCOPED workload token
  // and vends with that. Requires `workloadName` (the opt-in); without it the
  // static `workloadIdentityToken` flows unchanged (pre-forwarding behavior).
  const resolveWorkloadToken = async (req: CredentialRequest): Promise<string | undefined> => {
    const userId =
      req.mode === 'user' && req.identity !== undefined ? userIdFor(req.identity) : undefined;
    if (userId === undefined || !options.workloadName) return options.workloadIdentityToken;

    const c = getClient();
    if (typeof c.getWorkloadAccessTokenForUserId !== 'function') {
      // Explicit config must not silently degrade to workload-level tokens.
      throw new Error(
        'agentCoreIdentity: `workloadName` is configured for per-user workload scoping, ' +
          'but the client has no getWorkloadAccessTokenForUserId. Confirm the ' +
          '@aws-sdk/client-bedrock-agentcore version, or pass `_client`.',
      );
    }
    const res = await c.getWorkloadAccessTokenForUserId({
      workloadName: options.workloadName,
      userId,
    });
    if (!res.workloadAccessToken) {
      throw new Error(
        'agentCoreIdentity: GetWorkloadAccessTokenForUserId returned no workloadAccessToken ' +
          'for per-user scoped vending.',
      );
    }
    return res.workloadAccessToken;
  };

  return {
    id: options.id ?? 'agentcore-identity',
    async getCredential(req: CredentialRequest): Promise<CredentialResult> {
      const workloadIdentityToken = await resolveWorkloadToken(req);
      const res = await getClient().getResourceOauth2Token({
        resourceCredentialProviderName: req.service,
        scopes: req.scopes ?? [],
        oauth2Flow: req.mode === 'user' ? 'USER_FEDERATION' : 'M2M',
        forceAuthentication: req.forceReauth ?? false,
        ...(workloadIdentityToken && { workloadIdentityToken }),
      });

      if (res.accessToken) {
        // AgentCore Identity vends OAuth access tokens → a bearer credential.
        return {
          status: 'issued',
          credential: bearer(res.accessToken),
          ...(res.expiresAt !== undefined && { expiresAt: res.expiresAt }),
        };
      }
      if (res.authorizationUrl) {
        return {
          status: 'authorization-required',
          authorizationUrl: res.authorizationUrl,
          sessionId: res.sessionId ?? '',
        };
      }
      throw new Error(
        `agentCoreIdentity: GetResourceOauth2Token for '${req.service}' returned neither ` +
          'an access token nor an authorization URL.',
      );
    },
  };
}
