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
 *        from `agentfootprint/providers`)
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
  PermissionCapability,
  PermissionChecker,
  PermissionRequest,
  PermissionDecision,
  ToolCapability,
} from '../adapters/types.js';
import { skillIdFromTarget } from './skillTarget.js';

/** The four capabilities a tool can declare — the set a capability rule may
 *  list. `'tool_call'` is the allowlist's own job and `'skill_read'` has its
 *  own rule map, so neither belongs here. */
const TOOL_CAPABILITIES: readonly ToolCapability[] = [
  'memory_read',
  'memory_write',
  'external_net',
  'user_data',
];

/**
 * Map of role name → list of tool ids that role is allowed to invoke.
 * The shape consumers extend over time as new tools / roles arrive.
 */
export type RoleAllowlist = Readonly<Record<string, readonly string[]>>;

/**
 * Map of role name → the ids that role may reach, for a rule map beside the
 * tool allowlist (9.11.0). A role ABSENT from the map has no rule of that kind,
 * which means the rule does not apply to it — see {@link PermissionPolicyRules}.
 */
export type RoleIdRules = Readonly<Record<string, readonly string[]>>;

/**
 * The optional rules that sit BESIDE the tool allowlist (9.11.0).
 *
 * Both are opt-in and both are enforced only where they are configured, because
 * every one of them would otherwise change what an existing deployment permits.
 * A `PermissionPolicy.fromRoles(roles, role)` built without this bag behaves
 * exactly as it did in every earlier release — and reports `governs` as absent,
 * so the framework never asks it anything new either.
 */
export interface PermissionPolicyRules {
  /**
   * role → the {@link ToolCapability} values that role may exercise.
   *
   * Configured (for ANY role) ⇒ the policy declares it governs all four
   * capabilities, and the framework starts asking about a tool that declared
   * them. For a role with a rule, a capability the rule does not list is
   * DENIED. For a role WITHOUT one, capability checks fall through to the tool
   * allowlist — the tool already passed it, so nothing changes for that role.
   *
   * @example a support role that may read but never write
   *   PermissionPolicy.fromRoles(roles, 'support', {
   *     capabilities: { support: ['memory_read', 'external_net'], admin: [...] },
   *   })
   */
  readonly capabilities?: Readonly<Record<string, readonly ToolCapability[]>>;
  /**
   * role → the SKILL ids that role may activate with `read_skill`.
   *
   * Configured (for ANY role) ⇒ the policy declares it governs `'skill_read'`,
   * and the agent starts asking per skill: a refused skill's row disappears
   * from the `read_skill` menu the model reads, and an activation of it is
   * refused with this policy's own rationale. For a role WITHOUT a rule, every
   * skill stays visible — silence is not a denial.
   *
   * Ids are the bare skill ids (`'refunds'`), not the `skill:` targets: the
   * prefix is the wire convention that keeps a skill and a tool of the same
   * name apart, and it is this policy's job to know that, not yours.
   */
  readonly skills?: RoleIdRules;
}

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
  /** Optional capability + skill rules (9.11.0). See {@link PermissionPolicyRules}. */
  readonly rules?: PermissionPolicyRules;
}

/**
 * Data-driven role-based permission policy. Satisfies the v2.4
 * `PermissionChecker` interface AND exposes a sync `isAllowed` method
 * for use with `gatedTools` from `agentfootprint/providers`.
 */
export class PermissionPolicy implements PermissionChecker {
  readonly name = 'PermissionPolicy';

  /**
   * Which capabilities this policy asks to be consulted about beyond
   * `'tool_call'` (9.11.0) — DERIVED from what was configured, never a
   * separate switch that could disagree with the rules.
   *
   * Absent when no rules were given, which is what makes every policy built
   * the old way byte-identical: the framework asks it nothing new.
   */
  readonly governs?: readonly PermissionCapability[];

  private constructor(private readonly opts: PermissionPolicyOptions) {
    if (!opts.roles[opts.activeRole]) {
      throw new Error(
        `PermissionPolicy: activeRole '${opts.activeRole}' is not defined in roles. Available: ${
          Object.keys(opts.roles).join(', ') || '(none)'
        }`,
      );
    }
    const governs: PermissionCapability[] = [];
    // Configuring capability rules for ANY role means "ask me about all four".
    // Governing only the ones some role happened to list would let an
    // unlisted capability pass unasked — a fail-OPEN gap in a fail-closed
    // primitive.
    if (opts.rules?.capabilities !== undefined) governs.push(...TOOL_CAPABILITIES);
    if (opts.rules?.skills !== undefined) governs.push('skill_read');
    if (governs.length > 0) this.governs = Object.freeze(governs);
  }

  /**
   * Factory: build a role-based policy from a role → tool-ids map and
   * the role active for this instance.
   *
   * Throws if `activeRole` isn't a key in `roles` — fail loud at
   * config time, not at first denied call.
   */
  static fromRoles(
    roles: RoleAllowlist,
    activeRole: string,
    rules?: PermissionPolicyRules,
  ): PermissionPolicy {
    return new PermissionPolicy({ roles, activeRole, ...(rules !== undefined && { rules }) });
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
   * ## What each capability is judged by (9.11.0)
   *
   * - `'tool_call'` — the tool allowlist. Unchanged since v2.4.
   * - `'skill_read'` — the active role's `rules.skills` list, when it has one.
   *   Without one, allowed: a policy that never mentioned skills has not
   *   denied any, and silence is not a refusal.
   * - a {@link ToolCapability} — the active role's `rules.capabilities` list,
   *   when it has one. Without one, it falls through to the tool allowlist
   *   below, which the tool already passed on its `'tool_call'` check — so a
   *   role with no capability rule behaves exactly as it did before.
   *
   * The framework only ever sends the last two to a policy that declared
   * {@link PermissionPolicy.governs}, which this class derives from the rules
   * themselves — so "unconfigured" and "never asked" cannot drift apart.
   */
  async check(request: PermissionRequest): Promise<PermissionDecision> {
    if (request.capability === 'skill_read') return this.checkSkill(request);
    if (request.capability !== 'tool_call') {
      const rule = this.opts.rules?.capabilities?.[this.opts.activeRole];
      if (rule !== undefined && !rule.includes(request.capability)) {
        return {
          result: 'deny',
          policyRuleId: `${this.opts.activeRole}.capabilities.miss`,
          rationale:
            `The '${this.opts.activeRole}' role may not exercise '${request.capability}'` +
            `${request.target ? `, which tool '${request.target}' declares` : ''}.`,
        };
      }
    }
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
   * Skill activation, judged on its own map (9.11.0).
   *
   * Deliberately NOT routed through the tool allowlist: a `skill:<id>` target
   * is not a tool name, so `isAllowed` would deny every skill for every role
   * the moment a policy was attached — hiding a whole catalogue nobody asked
   * to hide. A role with no skill rule sees every skill; a role WITH one sees
   * exactly what it lists.
   */
  private checkSkill(request: PermissionRequest): PermissionDecision {
    const rule = this.opts.rules?.skills?.[this.opts.activeRole];
    if (rule === undefined) {
      return { result: 'allow', policyRuleId: `${this.opts.activeRole}.skills.unruled` };
    }
    const skillId = skillIdFromTarget(request.target ?? '');
    if (rule.includes(skillId)) {
      return { result: 'allow', policyRuleId: `${this.opts.activeRole}.skills` };
    }
    return {
      result: 'deny',
      policyRuleId: `${this.opts.activeRole}.skills.miss`,
      rationale: `Skill '${skillId}' is not available to the '${this.opts.activeRole}' role.`,
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
    return new PermissionPolicy({
      roles: this.opts.roles,
      activeRole,
      // The rules travel with the policy — a per-caller role swap that dropped
      // them would silently widen what the new role may do.
      ...(this.opts.rules !== undefined && { rules: this.opts.rules }),
    });
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
