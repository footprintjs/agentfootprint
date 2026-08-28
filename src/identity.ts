/**
 * identity — outbound credential vending for agent tools.
 *
 * The {@link CredentialProvider} port + adapters. A tool calls
 * `provider.getCredential({ service })` to get a token for a downstream service;
 * `agentCoreIdentity()` backs it with AWS Bedrock AgentCore Identity, or
 * `staticTokens()` for dev/test.
 *
 * SECURITY: a vended token is a secret — use it locally inside a tool's
 * `execute` (e.g. an HTTP header); never write it to tracked scope. See
 * `./identity/types` for the full invariant.
 *
 * @example
 * ```ts
 * import { agentCoreIdentity } from 'agentfootprint/security';
 *
 * const credentials = agentCoreIdentity({ region: 'us-east-1' });
 * const r = await credentials.getCredential({ service: 'github', mode: 'user', scopes: ['repo'] });
 * if (r.status === 'authorization-required') {
 *   // surface r.authorizationUrl to the user (e.g. pause the run), then retry.
 * } else {
 *   callGitHub({ headers: r.credential.toHeaders() }); // universal applicator
 * }
 * ```
 *
 * Not an import path of its own since 9.0.0. This is the implementation barrel
 * behind `agentfootprint/security`, which re-exports every name here — same
 * symbols, one door. Import from the door.
 */

export type {
  Credential,
  CredentialProvider,
  CredentialRequest,
  CredentialResult,
  CredentialIssued,
  CredentialAuthorizationRequired,
  CredentialNeed,
} from './identity/types.js';
export { isCredentialIssued, unconfiguredCredentialProvider } from './identity/types.js';
export {
  bearer,
  apiKey,
  basic,
  headers,
  type BearerCredential,
  type ApiKeyCredential,
  type BasicCredential,
  type HeadersCredential,
} from './identity/kinds.js';
export { staticTokens, type StaticTokensOptions } from './identity/staticTokens.js';
// 3LO consent (8.6.0) — the mode, the caller-facing block, and the typed
// terminal. The authorization URL reaches a caller HERE (or on `PendingAsk`)
// and deliberately nowhere else; see the note on the error class.
export type { AuthorizationRequiredMode, ConsentRequest } from './identity/consent.js';
export {
  CredentialConsentRequiredError,
  type CredentialConsentRequiredContext,
} from './identity/CredentialConsentRequiredError.js';
export {
  withCredentialRetry,
  type WithCredentialRetryOptions,
} from './identity/withCredentialRetry.js';
export {
  agentCoreIdentity,
  // The consent handshake (9.66.0) — called from YOUR callback route, not from
  // the agent run, which is why it is a function of its own rather than a
  // method on the provider that route never sees.
  completeAgentCoreAuthorization,
  type AgentCoreIdentityOptions,
  type AgentCoreIdentityClientLike,
  type AgentCoreOauthResponse,
  type CompleteAgentCoreAuthorizationOptions,
} from './adapters/identity/agentcore.js';
// HashiCorp-Vault-compatible KV v2, over plain HTTP (9.8.0) — no SDK, no
// vendor client. V1 is token auth + KV v2 + no leases, and every other shape
// is refused by name rather than guessed at; see the module docstring.
export { vaultCredentials, type VaultCredentialsOptions } from './adapters/identity/vault.js';

// Google access tokens from whatever credential the environment already has
// (ADC, workload identity, an impersonated service account). Narrow on
// purpose: it vends the DEPLOYMENT's identity, and `mode: 'user'` is refused
// by name rather than quietly downgraded to a machine token.
export {
  googleIdentity,
  CLOUD_PLATFORM_SCOPE,
  type GoogleIdentityOptions,
  type GoogleImpersonation,
  type GoogleAuthClientLike,
} from './adapters/identity/google.js';

// Entra ID tokens from whatever credential the environment already has —
// DefaultAzureCredential's chain (env service principal, workload identity,
// managed identity, VS Code, az CLI), or any TokenCredential you built
// (9.74.0). Same narrowness as googleIdentity: it vends the DEPLOYMENT's
// identity; `mode: 'user'` and per-request user tokens are refused by name
// until an OBO surface exists. AZURE_AI_SCOPE vs AZURE_MANAGEMENT_SCOPE
// matters — a token for one audience does not work on the other, which is
// why both constants are exported instead of one "azure scope".
export {
  entraIdentity,
  AZURE_AI_SCOPE,
  AZURE_MANAGEMENT_SCOPE,
  AZURE_COGNITIVE_SERVICES_SCOPE,
  type EntraIdentityOptions,
  type TokenCredentialLike,
  type AccessTokenLike,
  type AzureIdentitySdkModule,
} from './adapters/identity/azure.js';

// Verifying WHO is calling (9.26.0) — the other half of identity. The rest of
// this door vends credentials for calls the agent makes OUTWARD;
// `jwksIdentity` checks the credential a caller presents INWARD, against an
// identity provider's published key set. Wire it at the hosting door:
// `standingAgent({ …, identity: { verify: jwksIdentity({ … }).verify } })`.
export {
  jwksIdentity,
  MissingJwksSupportError,
  type JoseBackend,
  type JwksIdentityOptions,
} from './adapters/identity/jwks.js';
