/**
 * agentfootprint/security — cross-cutting authorization + governance.
 *
 * Permissions are NOT context engineering — they're a guard ON
 * context-engineering operations (tool dispatch, skill activation,
 * memory writes, output emission). That's why this lives in its own
 * subpath, parallel to `agentfootprint/tool-providers` and the
 * `agentfootprint/memory-*` and `agentfootprint/providers` subpaths.
 *
 * Today's surface is small and data-driven on purpose: one role
 * allowlist primitive that satisfies BOTH the v2.4 `PermissionChecker`
 * interface AND a sync `isAllowed(toolId)` predicate for use with
 * `gatedTools` from `agentfootprint/tool-providers` — plus
 * `agentCorePolicy()`, the same port answered by a remote policy store.
 *
 * A local allowlist and a remote policy engine differ in one way that
 * matters here: the local one can answer synchronously, so it doubles
 * as a `gatedTools` predicate; a remote one cannot, so it plugs in ONLY
 * as `permissionChecker`. That is not a limitation of either — the gate
 * decides what the model is shown, the checker decides what actually
 * runs, and they compose without knowing about each other.
 *
 * Future additions (capability gating, gate_open flows, audit logs)
 * land here without expanding the public root barrel.
 *
 * @example
 *   import { PermissionPolicy } from 'agentfootprint/security';
 *   import { gatedTools, staticTools } from 'agentfootprint/tool-providers';
 *
 *   const policy = PermissionPolicy.fromRoles(
 *     {
 *       readonly: ['lookup', 'list_skills', 'read_skill'],
 *       admin:    ['lookup', 'list_skills', 'read_skill', 'write', 'delete'],
 *     },
 *     'readonly',
 *   );
 *
 *   const provider = gatedTools(
 *     staticTools(allTools),
 *     (name) => policy.isAllowed(name),
 *   );
 *
 *   const agent = Agent.create({ provider, model, permissionChecker: policy }).build();
 */

export { PermissionPolicy } from './PermissionPolicy.js';
export type { RoleAllowlist, PermissionPolicyOptions } from './PermissionPolicy.js';

export { PolicyHaltError } from './PolicyHaltError.js';
export type { PolicyHaltContext } from './PolicyHaltError.js';

export { extractSequence, SYNTHETIC_DENY_PREFIX } from './extractSequence.js';
export type { ExtractSequenceOptions } from './extractSequence.js';

export { redactThinkingBlocks, REDACTED_PLACEHOLDER } from './thinkingRedaction.js';

// A remote policy engine behind the same port. Lazy peer-dep: importing this
// barrel loads no AWS SDK — only constructing the checker and letting it
// evaluate does. Same home as `PermissionPolicy` because it is the same job,
// just asked of somebody else.
export {
  agentCorePolicy,
  type AgentCorePolicyOptions,
  type AgentCorePolicyClientLike,
  type AgentCorePolicyEvaluation,
  type AgentCorePolicyUnavailable,
  type BedrockAgentCorePolicySdkModule,
} from '../adapters/security/agentcore.js';

// Re-export the permission engine interface types from adapters so
// consumers can implement custom checkers without depending on the
// adapters subpath directly. PermissionPolicy itself is a Strategy
// over these interfaces.
export type {
  PermissionChecker,
  PermissionRequest,
  PermissionDecision,
  ToolCallEntry,
  ToolResultContent,
} from '../adapters/types.js';
