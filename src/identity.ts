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
  type AgentCoreIdentityOptions,
  type AgentCoreIdentityClientLike,
  type AgentCoreOauthResponse,
} from './adapters/identity/agentcore.js';
// HashiCorp-Vault-compatible KV v2, over plain HTTP (9.8.0) — no SDK, no
// vendor client. V1 is token auth + KV v2 + no leases, and every other shape
// is refused by name rather than guessed at; see the module docstring.
export { vaultCredentials, type VaultCredentialsOptions } from './adapters/identity/vault.js';
