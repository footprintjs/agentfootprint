/**
 * agentfootprint/security — who may do what, and with whose credentials.
 *
 * Two halves of the same question:
 *
 *   • Authorization — `PermissionPolicy`, `PolicyHaltError`, the
 *     `PermissionChecker` port, the remote `agentCorePolicy` engine, and
 *     thinking-block redaction.
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
