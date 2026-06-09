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
 *   - a returned access token → `{ status: 'issued', credential: bearer(token) }`
 *   - a returned auth URL     → `{ status: 'authorization-required' }` (3LO consent)
 *
 * The token vault + refresh-token handling live in AgentCore, so repeat calls
 * usually return a token directly (no consent round-trip).
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

/** The minimal client surface the adapter calls — wraps `GetResourceOauth2Token`.
 *  The real AWS SDK client is adapted to this; tests inject a fake via `_client`. */
export interface AgentCoreIdentityClientLike {
  getResourceOauth2Token(input: {
    readonly resourceCredentialProviderName: string;
    readonly scopes: readonly string[];
    readonly oauth2Flow: 'M2M' | 'USER_FEDERATION';
    readonly forceAuthentication: boolean;
    readonly workloadIdentityToken?: string;
  }): Promise<AgentCoreOauthResponse>;
}

export interface AgentCoreIdentityOptions {
  readonly region?: string;
  /** The agent's workload access token (AgentCore Runtime injects one in-container;
   *  supply it explicitly when running elsewhere). */
  readonly workloadIdentityToken?: string;
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
  };
}

/** Build a {@link CredentialProvider} backed by AWS Bedrock AgentCore Identity. */
export function agentCoreIdentity(options: AgentCoreIdentityOptions = {}): CredentialProvider {
  let client: AgentCoreIdentityClientLike | undefined;
  const getClient = (): AgentCoreIdentityClientLike => (client ??= resolveClient(options));

  return {
    id: options.id ?? 'agentcore-identity',
    async getCredential(req: CredentialRequest): Promise<CredentialResult> {
      // NOTE: `req.identity` (principal/tenant) is intentionally NOT forwarded
      // yet — tenant isolation here derives solely from `workloadIdentityToken`
      // (the AgentCore-injected workload identity). Don't assume the threaded
      // principal/tenant is enforced at the IdP until a future release maps it
      // onto the user-federation subject.
      const res = await getClient().getResourceOauth2Token({
        resourceCredentialProviderName: req.service,
        scopes: req.scopes ?? [],
        oauth2Flow: req.mode === 'user' ? 'USER_FEDERATION' : 'M2M',
        forceAuthentication: req.forceReauth ?? false,
        ...(options.workloadIdentityToken && {
          workloadIdentityToken: options.workloadIdentityToken,
        }),
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
