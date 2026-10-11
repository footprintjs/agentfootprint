/**
 * agentfootprint/security — who may do what, and with whose credentials.
 *
 * Two halves of the same question:
 *
 *   • Authorization — `PermissionPolicy`, `PolicyHaltError`, the
 *     `PermissionChecker` port, and thinking-block redaction.
 *   • Identity — the `CredentialProvider` port, the credential kinds
 *     (`bearer`, `apiKey`, `basic`, `headers`), `staticTokens`,
 *     `withCredentialRetry`, and `agentCoreIdentity`.
 *   • Who is calling — the inbound verifiers `jwksIdentity` and
 *     `oidcIdentity`, and `identityFromConfig` / `identityConfigFromEnv`,
 *     which pick one strategy per deployment from config at boot.
 *   • What the record keeps out — `conversationRedaction()`, the names an
 *     agent's record carries the conversation under, as the policy for the
 *     agent's one redaction door, `Agent.create({ redact })`.
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
