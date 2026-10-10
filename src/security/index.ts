/**
 * agentfootprint/security — cross-cutting authorization + governance.
 *
 * Permissions are NOT context engineering — they're a guard ON
 * context-engineering operations (tool dispatch, skill activation,
 * memory writes, output emission). That's why this lives in its own
 * subpath, parallel to `agentfootprint/providers` and the
 * `agentfootprint/memory-*` and `agentfootprint/providers` subpaths.
 *
 * Today's surface is small and data-driven on purpose: one role
 * allowlist primitive that satisfies BOTH the v2.4 `PermissionChecker`
 * interface AND a sync `isAllowed(toolId)` predicate for use with
 * `gatedTools` from `agentfootprint/providers`.
 *
 * There is no shipped REMOTE policy engine. A remote checker implements
 * `PermissionChecker` with a `check()` method supplied by the application.
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
 *   import { gatedTools, staticTools } from 'agentfootprint/providers';
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
export type {
  RoleAllowlist,
  RoleIdRules,
  PermissionPolicyOptions,
  PermissionPolicyRules,
} from './PermissionPolicy.js';

export { PolicyHaltError } from './PolicyHaltError.js';
export type { PolicyHaltContext } from './PolicyHaltError.js';

export { extractSequence, SYNTHETIC_DENY_PREFIX } from './extractSequence.js';
export type { ExtractSequenceOptions } from './extractSequence.js';

export { redactThinkingBlocks, REDACTED_PLACEHOLDER } from './thinkingRedaction.js';
// The names an agent's record carries the conversation under, as one policy
// for `Agent.create({ redact })` — the library's vocabulary, joined with yours.
export { conversationRedaction } from '../redaction/conversation.js';

// The `skill:<id>` target convention (9.11.0) — one owner, so a custom checker
// spells a skill target exactly as the agent produces it.
export { SKILL_TARGET_PREFIX, skillTarget, skillIdFromTarget } from './skillTarget.js';

// Re-export the permission engine interface types from adapters so
// consumers can implement custom checkers without depending on the
// adapters subpath directly. PermissionPolicy itself is a Strategy
// over these interfaces.
export type {
  PermissionCapability,
  PermissionChecker,
  PermissionRequest,
  PermissionDecision,
  ToolCallEntry,
  ToolCapability,
  ToolResultContent,
} from '../adapters/types.js';
// The one question the dispatch loop asks a checker before sending it anything
// beyond `'tool_call'`. Exported so a custom checker's own tests can assert the
// same answer the framework will get.
export { checkerGoverns } from '../adapters/types.js';
