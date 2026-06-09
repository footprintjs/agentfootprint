/**
 * agentfootprint/identity — outbound credential vending for agent tools.
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
 * import { agentCoreIdentity } from 'agentfootprint/identity';
 *
 * const credentials = agentCoreIdentity({ region: 'us-east-1' });
 * const r = await credentials.getCredential({ service: 'github', mode: 'user', scopes: ['repo'] });
 * if (r.status === 'authorization-required') {
 *   // surface r.authorizationUrl to the user (e.g. pause the run), then retry.
 * } else {
 *   callGitHub({ headers: r.credential.toHeaders() }); // universal applicator
 * }
 * ```
 */

export type {
  Credential,
  CredentialProvider,
  CredentialRequest,
  CredentialResult,
  CredentialIssued,
  CredentialAuthorizationRequired,
} from './identity/types.js';
export { isCredentialIssued } from './identity/types.js';
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
export {
  agentCoreIdentity,
  type AgentCoreIdentityOptions,
  type AgentCoreIdentityClientLike,
  type AgentCoreOauthResponse,
} from './adapters/identity/agentcore.js';
