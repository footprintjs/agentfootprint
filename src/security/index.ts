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
 * `gatedTools` from `agentfootprint/tool-providers`.
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

// Re-export the permission engine interface types from adapters so
// consumers can implement custom checkers without depending on the
// adapters subpath directly. PermissionPolicy itself is a Strategy
// over these interfaces.
export type {
  PermissionChecker,
  PermissionRequest,
  PermissionDecision,
} from '../adapters/types.js';
