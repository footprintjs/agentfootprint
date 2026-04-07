/**
 * agentfootprint/security — Make agents safe.
 *
 * Tool gating hides tools from the LLM. Permission policies control access.
 * Two layers: resolve-time filtering (LLM never sees blocked tools) + execute-time rejection.
 *
 * @example
 * ```typescript
 * import { gatedTools, PermissionPolicy } from 'agentfootprint/security';
 *
 * const policy = PermissionPolicy.fromRoles({ user: ['search'], admin: ['search', 'delete'] }, 'user');
 * const agent = Agent.create({ provider }).toolProvider(gatedTools(tools, policy.checker())).build();
 * ```
 */

export { gatedTools, PermissionPolicy } from './providers';
export type {
  PermissionChecker,
  GatedToolsOptions,
  PermissionPolicyOptions,
  PermissionChangeEvent,
} from './providers';
// PermissionRecorder lives in agentfootprint/observe (it's a recorder, not a security primitive)
