/**
 * PermissionPolicy — centralized, shareable permission policy for tool gating.
 *
 * Addresses the "per-agent, not centralized" con of gatedTools().
 * Create one policy, share it across multiple agents/swarms.
 *
 * Features:
 *   - grant/revoke at runtime (mid-conversation permission changes)
 *   - wildcard support ('*' grants all)
 *   - role-based presets (pass a Set of tool IDs per role)
 *   - onChange callback for audit/logging
 *
 * Usage:
 *   // Centralized policy — shared across agents
 *   const policy = new PermissionPolicy(['search', 'calc']);
 *
 *   const agent1 = Agent.create({ provider })
 *     .toolProvider(gatedTools(tools, policy.checker()))
 *     .build();
 *
 *   const agent2 = Agent.create({ provider })
 *     .toolProvider(gatedTools(otherTools, policy.checker()))
 *     .build();
 *
 *   // Runtime changes — both agents see it immediately
 *   policy.grant('admin-tool');
 *   policy.revoke('search');
 *
 *   // Role-based
 *   const policy = PermissionPolicy.fromRoles({
 *     user: ['search', 'calc'],
 *     admin: ['search', 'calc', 'delete-user', 'run-code'],
 *   }, 'user');  // current role
 *   policy.setRole('admin');  // upgrade mid-conversation
 */

import type { PermissionChecker } from './gatedTools';

export interface PermissionPolicyOptions {
  /** Called when permissions change (grant/revoke/setRole). For audit logging. */
  onChange?: (event: PermissionChangeEvent) => void;
}

export interface PermissionChangeEvent {
  type: 'grant' | 'revoke' | 'role-change';
  toolId?: string;
  role?: string;
  allowed: string[];
}

export class PermissionPolicy {
  private allowed: Set<string>;
  private readonly onChange?: (event: PermissionChangeEvent) => void;

  // Role-based state
  private roles?: Record<string, readonly string[]>;
  private currentRole?: string;

  constructor(initialAllowed: Iterable<string> = [], options?: PermissionPolicyOptions) {
    this.allowed = new Set(initialAllowed);
    this.onChange = options?.onChange;
  }

  /**
   * Create a policy from role definitions.
   * The active role determines which tools are allowed.
   */
  static fromRoles(
    roles: Record<string, readonly string[]>,
    activeRole: string,
    options?: PermissionPolicyOptions,
  ): PermissionPolicy {
    const tools = roles[activeRole] ?? [];
    const policy = new PermissionPolicy(tools, options);
    policy.roles = roles;
    policy.currentRole = activeRole;
    return policy;
  }

  /** Grant access to a tool. Takes effect on next resolve() call. */
  grant(toolId: string): this {
    this.allowed.add(toolId);
    this.onChange?.({ type: 'grant', toolId, allowed: this.getAllowed() });
    return this;
  }

  /** Revoke access to a tool. */
  revoke(toolId: string): this {
    this.allowed.delete(toolId);
    this.onChange?.({ type: 'revoke', toolId, allowed: this.getAllowed() });
    return this;
  }

  /** Switch to a different role (role-based policies only). */
  setRole(role: string): this {
    if (!this.roles) throw new Error('[PermissionPolicy] setRole requires fromRoles()');
    if (!this.roles[role]) throw new Error(`[PermissionPolicy] Unknown role: "${role}"`);
    this.currentRole = role;
    this.allowed = new Set(this.roles[role]);
    this.onChange?.({ type: 'role-change', role, allowed: this.getAllowed() });
    return this;
  }

  /** Current role (if using role-based policy). */
  getRole(): string | undefined {
    return this.currentRole;
  }

  /** Check if a tool is allowed. */
  isAllowed(toolId: string): boolean {
    return this.allowed.has('*') || this.allowed.has(toolId);
  }

  /** Get all currently allowed tool IDs. */
  getAllowed(): string[] {
    return [...this.allowed];
  }

  /**
   * Returns a PermissionChecker compatible with gatedTools().
   * This is the bridge — create one policy, pass checker() to multiple gatedTools.
   */
  checker(): PermissionChecker {
    return (toolId: string) => this.isAllowed(toolId);
  }
}
