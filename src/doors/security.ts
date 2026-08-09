/**
 * agentfootprint/security — who may do what, and with whose credentials.
 *
 * Two halves of the same question:
 *
 *   • Authorization — `PermissionPolicy`, `PolicyHaltError`, the
 *     `PermissionChecker` port, and thinking-block redaction. (`agentCorePolicy`
 *     is retired in 9.4.0 — AgentCore enforces policy at the Gateway, so there
 *     was never a data-plane call for it to make.)
 *   • Identity — the `CredentialProvider` port, the credential kinds
 *     (`bearer`, `apiKey`, `basic`, `headers`), `staticTokens`,
 *     `withCredentialRetry`, and `agentCoreIdentity`.
 *
 * A vended credential is a secret: use it locally inside a tool's `execute`
 * and never write it to tracked scope.
 *
 * @example
 * ```ts
 * import { PermissionPolicy, agentCoreIdentity } from 'agentfootprint/security';
 * ```
 */

export * from '../security/index.js';
export * from '../identity.js';
