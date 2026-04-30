/**
 * PermissionPolicy — data-driven role-based authorization for tool dispatch.
 *
 * Closes Neo gap #2 (of 8). Permissions are CROSS-CUTTING — they're not
 * context engineering, they're a guard ON context-engineering operations
 * (tool dispatch, skill activation, memory writes, output emission).
 * That's why this lives in `agentfootprint/security`, parallel to the
 * provider subpaths.
 *
 * Two surfaces, one primitive:
 *   1. `PermissionPolicy.fromRoles({...}, activeRole)` — declarative,
 *      data-driven, auditable. Production governance.
 *   2. The PermissionPolicy instance satisfies BOTH:
 *      - `PermissionChecker` interface (async check; consumed by Agent
 *        constructor's `permissionChecker` field)
 *      - sync `isAllowed(toolId)` method (consumed by `gatedTools(...)`
 *        from `agentfootprint/tool-providers`)
 *
 * Pattern: Strategy (GoF) for the role-allowlist policy + Adapter
 *          (matches `PermissionChecker` interface so it composes with
 *          existing v2.4 Agent constructor).
 *
 * Role: Layer-3 cross-cutting guard. Not Injection. Not provider.
 *       Lives in its own subpath (`agentfootprint/security`).
 *
 * @example  Read-only role for a support agent
 *   const policy = PermissionPolicy.fromRoles(
 *     {
 *       readonly: ['lookup_order', 'get_status', 'list_skills', 'read_skill'],
 *       support: ['lookup_order', 'get_status', 'process_refund', 'list_skills', 'read_skill'],
 *     },
 *     'readonly',
 *   );
 *
 *   policy.isAllowed('lookup_order');     // → true
 *   policy.isAllowed('process_refund');   // → false (not in readonly role)
 *
 *   // As a tool-dispatch gate (composes with gatedTools)
 *   const provider = gatedTools(staticTools(allTools), (name) => policy.isAllowed(name));
 *
 *   // As an Agent permissionChecker (the v2.4 surface)
 *   const agent = Agent.create({ provider, model, permissionChecker: policy }).build();
 *
 * @example  Per-identity role switching at runtime
 *   const policy = PermissionPolicy.fromRoles({
 *     readonly: [...],
 *     admin: [...],
 *   }, 'readonly');
 *
 *   const adminPolicy = policy.withActiveRole('admin');
 *   // Same allowlist data; different active role.
 */

import type {
  PermissionChecker,
  PermissionRequest,
  PermissionDecision,
} from '../adapters/types.js';

/**
 * Map of role name → list of tool ids that role is allowed to invoke.
 * The shape consumers extend over time as new tools / roles arrive.
 */
export type RoleAllowlist = Readonly<Record<string, readonly string[]>>;

export interface PermissionPolicyOptions {
  /**
   * The role allowlist. Each role maps to the tool ids it can invoke.
   * Tool ids match the `name` field of `Tool.schema.name` exactly.
   */
  readonly roles: RoleAllowlist;
  /**
   * Which role is active for this policy instance. Calls to
   * `.isAllowed(toolId)` check against this role's allowlist.
   * Use `.withActiveRole(name)` to derive a sibling policy with a
   * different active role.
   */
  readonly activeRole: string;
}

/**
 * Data-driven role-based permission policy. Satisfies the v2.4
 * `PermissionChecker` interface AND exposes a sync `isAllowed` method
 * for use with `gatedTools` from `agentfootprint/tool-providers`.
 */
export class PermissionPolicy implements PermissionChecker {
  readonly name = 'PermissionPolicy';

  private constructor(private readonly opts: PermissionPolicyOptions) {
    if (!opts.roles[opts.activeRole]) {
      throw new Error(
        `PermissionPolicy: activeRole '${opts.activeRole}' is not defined in roles. Available: ${
          Object.keys(opts.roles).join(', ') || '(none)'
        }`,
      );
    }
  }

  /**
   * Factory: build a role-based policy from a role → tool-ids map and
   * the role active for this instance.
   *
   * Throws if `activeRole` isn't a key in `roles` — fail loud at
   * config time, not at first denied call.
   */
  static fromRoles(roles: RoleAllowlist, activeRole: string): PermissionPolicy {
    return new PermissionPolicy({ roles, activeRole });
  }

  /**
   * Sync allowlist check. Use as a predicate with `gatedTools`:
   *
   *   gatedTools(staticTools(allTools), (toolId) => policy.isAllowed(toolId))
   *
   * Returns true iff `toolId` is in the active role's allowlist.
   * Closes-fail by design: missing role membership = denied.
   */
  isAllowed(toolId: string): boolean {
    return (this.opts.roles[this.opts.activeRole] ?? []).includes(toolId);
  }

  /**
   * Async check matching the `PermissionChecker` interface — consumed
   * by `Agent.create({ permissionChecker })`. Wraps `isAllowed` with
   * the structured `PermissionDecision` envelope (allow / deny + a
   * `policyRuleId` so observability can trace which role decided).
   *
   * Today the policy only checks the tool name (request.target).
   * Future work: also gate by capability ('memory_write', etc.) when
   * the role allowlist is widened to capability-by-id.
   */
  async check(request: PermissionRequest): Promise<PermissionDecision> {
    const toolId = request.target ?? request.capability;
    if (this.isAllowed(toolId)) {
      return {
        result: 'allow',
        policyRuleId: `${this.opts.activeRole}.allowlist`,
      };
    }
    return {
      result: 'deny',
      policyRuleId: `${this.opts.activeRole}.allowlist.miss`,
      rationale: `Tool '${toolId}' is not in the '${this.opts.activeRole}' role allowlist.`,
    };
  }

  /**
   * Derive a sibling policy with a different active role. Same role
   * map; different active role. Useful for per-identity routing
   * (one policy instance per request, varying active role per caller).
   *
   * Returns a NEW PermissionPolicy — original is unchanged.
   */
  withActiveRole(activeRole: string): PermissionPolicy {
    return new PermissionPolicy({ roles: this.opts.roles, activeRole });
  }

  /** The role name currently active. Useful for observability. */
  get activeRole(): string {
    return this.opts.activeRole;
  }

  /** All defined role names. Stable order = registration order. */
  get roles(): readonly string[] {
    return Object.keys(this.opts.roles);
  }

  /** All tool ids allowed under the current active role. */
  allowedToolIds(): readonly string[] {
    return [...(this.opts.roles[this.opts.activeRole] ?? [])];
  }
}
