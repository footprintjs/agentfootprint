/**
 * PermissionPolicy — 7-pattern test matrix
 * (unit · scenario · integration · property · security · performance · ROI).
 *
 * Pins the contract:
 *   - Data-driven role allowlist (factory + active-role swap).
 *   - Sync `isAllowed(toolId)` predicate (consumed by `gatedTools`).
 *   - Async `check(request)` matches the v2.4 PermissionChecker interface.
 *   - Closed-fail on unknown tools (security property).
 *   - Active-role swap returns a new instance (immutability property).
 */

import { describe, expect, it } from 'vitest';
import {
  PermissionPolicy,
  staticTools,
  gatedTools,
  type ToolDispatchContext,
  type Tool,
} from '../../src/index.js';
import type {
  PermissionChecker,
  PermissionRequest,
} from '../../src/security/index.js';

// ─── Fixtures ─────────────────────────────────────────────────────

function fakeTool(name: string): Tool {
  return {
    schema: { name, description: name, inputSchema: { type: 'object' } },
    execute: async () => `result-${name}`,
  };
}

const ROLES = {
  readonly: ['lookup_order', 'get_status', 'list_skills', 'read_skill'],
  support: ['lookup_order', 'get_status', 'process_refund', 'list_skills', 'read_skill'],
  admin: ['lookup_order', 'get_status', 'process_refund', 'delete_user', 'list_skills', 'read_skill'],
} as const;

const baseCtx: ToolDispatchContext = {
  iteration: 1,
  identity: { conversationId: 'c1' },
};

// ─── 1. UNIT — factory + isAllowed ────────────────────────────────

describe('PermissionPolicy — unit', () => {
  it('fromRoles returns a PermissionPolicy with the requested active role', () => {
    const policy = PermissionPolicy.fromRoles(ROLES, 'readonly');
    expect(policy.activeRole).toBe('readonly');
  });

  it('throws if active role is not in the role map', () => {
    expect(() => PermissionPolicy.fromRoles(ROLES, 'nonexistent')).toThrow(
      /activeRole 'nonexistent' is not defined/,
    );
  });

  it('isAllowed returns true for tools in the active role allowlist', () => {
    const policy = PermissionPolicy.fromRoles(ROLES, 'support');
    expect(policy.isAllowed('process_refund')).toBe(true);
    expect(policy.isAllowed('lookup_order')).toBe(true);
  });

  it('isAllowed returns false for tools NOT in the active role allowlist', () => {
    const policy = PermissionPolicy.fromRoles(ROLES, 'readonly');
    expect(policy.isAllowed('process_refund')).toBe(false);
    expect(policy.isAllowed('delete_user')).toBe(false);
  });

  it('roles getter exposes registration-order role names', () => {
    const policy = PermissionPolicy.fromRoles(ROLES, 'readonly');
    expect([...policy.roles]).toEqual(['readonly', 'support', 'admin']);
  });

  it('allowedToolIds returns the active role allowlist as a frozen-ish copy', () => {
    const policy = PermissionPolicy.fromRoles(ROLES, 'readonly');
    expect([...policy.allowedToolIds()]).toEqual([
      'lookup_order',
      'get_status',
      'list_skills',
      'read_skill',
    ]);
  });
});

// ─── 2. SCENARIO — withActiveRole derivation ──────────────────────

describe('PermissionPolicy — scenario: per-identity role swap', () => {
  it('withActiveRole produces a new policy with the same role map but a different active role', () => {
    const base = PermissionPolicy.fromRoles(ROLES, 'readonly');
    const elevated = base.withActiveRole('admin');

    // Original is unchanged
    expect(base.activeRole).toBe('readonly');
    expect(base.isAllowed('delete_user')).toBe(false);

    // Derived sees admin's allowlist
    expect(elevated.activeRole).toBe('admin');
    expect(elevated.isAllowed('delete_user')).toBe(true);
  });

  it('withActiveRole throws on unknown role names', () => {
    const base = PermissionPolicy.fromRoles(ROLES, 'readonly');
    expect(() => base.withActiveRole('phantom')).toThrow(/'phantom'/);
  });
});

// ─── 3. INTEGRATION — composes with gatedTools ────────────────────

describe('PermissionPolicy — integration: composes with gatedTools', () => {
  it('gatedTools(staticTools(all), policy.isAllowed) filters by active role', () => {
    const allTools = [
      fakeTool('lookup_order'),
      fakeTool('process_refund'),
      fakeTool('delete_user'),
    ];
    const policy = PermissionPolicy.fromRoles(ROLES, 'readonly');
    const provider = gatedTools(staticTools(allTools), (name) => policy.isAllowed(name));

    const visible = provider.list(baseCtx);
    expect(visible.map((t) => t.schema.name)).toEqual(['lookup_order']);
  });

  it('switching the active role changes the visible tool list', () => {
    const allTools = [
      fakeTool('lookup_order'),
      fakeTool('process_refund'),
      fakeTool('delete_user'),
    ];
    let policy = PermissionPolicy.fromRoles(ROLES, 'readonly');
    // Reference into the predicate so swap is observable
    const provider = gatedTools(staticTools(allTools), (name) => policy.isAllowed(name));

    expect(provider.list(baseCtx).map((t) => t.schema.name)).toEqual(['lookup_order']);

    policy = policy.withActiveRole('admin');
    expect(provider.list(baseCtx).map((t) => t.schema.name)).toEqual([
      'lookup_order',
      'process_refund',
      'delete_user',
    ]);
  });

  it('satisfies the PermissionChecker interface (Agent constructor surface)', async () => {
    const policy = PermissionPolicy.fromRoles(ROLES, 'readonly');
    // Type assertion: PermissionPolicy must be assignable to PermissionChecker
    const checker: PermissionChecker = policy;
    const allow = await checker.check({
      capability: 'tool_call',
      actor: 'user-1',
      target: 'lookup_order',
    });
    expect(allow.result).toBe('allow');

    const deny = await checker.check({
      capability: 'tool_call',
      actor: 'user-1',
      target: 'delete_user',
    });
    expect(deny.result).toBe('deny');
    expect(deny.rationale).toContain('delete_user');
    expect(deny.rationale).toContain('readonly');
  });
});

// ─── 4. PROPERTY — invariants over arbitrary inputs ───────────────

describe('PermissionPolicy — properties', () => {
  it('isAllowed is deterministic — same input → same output', () => {
    const policy = PermissionPolicy.fromRoles(ROLES, 'support');
    for (let i = 0; i < 100; i++) {
      expect(policy.isAllowed('process_refund')).toBe(true);
      expect(policy.isAllowed('delete_user')).toBe(false);
    }
  });

  it('withActiveRole produces NEW instances (immutability)', () => {
    const a = PermissionPolicy.fromRoles(ROLES, 'readonly');
    const b = a.withActiveRole('readonly'); // same role, still new instance
    expect(a).not.toBe(b);
    expect(a.activeRole).toBe(b.activeRole);
  });

  it('allowedToolIds returns a copy (mutating the returned array is safe)', () => {
    const policy = PermissionPolicy.fromRoles(ROLES, 'readonly');
    const ids = policy.allowedToolIds() as string[];
    ids.push('SHOULD_NOT_LEAK');
    // Re-checking: the policy's view is unchanged
    expect(policy.allowedToolIds()).not.toContain('SHOULD_NOT_LEAK');
  });
});

// ─── 5. SECURITY — closed-fail by design ──────────────────────────

describe('PermissionPolicy — security: closed-fail', () => {
  it('unknown tool ids deny by default (no implicit allow)', () => {
    const policy = PermissionPolicy.fromRoles(ROLES, 'readonly');
    expect(policy.isAllowed('totally_unknown_tool')).toBe(false);
  });

  it('async check denies unknown tools with a structured rationale', async () => {
    const policy = PermissionPolicy.fromRoles(ROLES, 'readonly');
    const decision = await policy.check({
      capability: 'tool_call',
      actor: 'attacker',
      target: 'nuke_database',
    });
    expect(decision.result).toBe('deny');
    expect(decision.policyRuleId).toBe('readonly.allowlist.miss');
  });

  it('empty allowlist denies everything', () => {
    const policy = PermissionPolicy.fromRoles({ none: [] }, 'none');
    expect(policy.isAllowed('anything')).toBe(false);
    expect(policy.isAllowed('lookup_order')).toBe(false);
  });

  it('decision carries policyRuleId so observability can trace which role decided', async () => {
    const policy = PermissionPolicy.fromRoles(ROLES, 'support');
    const allow = await policy.check({
      capability: 'tool_call',
      actor: 'u',
      target: 'process_refund',
    });
    expect(allow.policyRuleId).toBe('support.allowlist');

    const deny = await policy.check({
      capability: 'tool_call',
      actor: 'u',
      target: 'delete_user',
    });
    expect(deny.policyRuleId).toBe('support.allowlist.miss');
  });

  it('falls back to capability when target is missing (capability-only requests)', async () => {
    // If target is undefined, check() falls through to capability — denies
    // unless capability itself happens to be in the allowlist.
    const policy = PermissionPolicy.fromRoles(ROLES, 'readonly');
    const decision = await policy.check({
      capability: 'memory_write',
      actor: 'u',
    } as PermissionRequest);
    expect(decision.result).toBe('deny');
  });
});

// ─── 6. PERFORMANCE — bounded cost ────────────────────────────────

describe('PermissionPolicy — performance', () => {
  it('isAllowed is fast enough for per-iteration tool dispatch (10k checks <50ms)', () => {
    const policy = PermissionPolicy.fromRoles(ROLES, 'admin');
    const t0 = Date.now();
    for (let i = 0; i < 10_000; i++) {
      policy.isAllowed('process_refund');
      policy.isAllowed('totally_unknown_tool');
    }
    const elapsed = Date.now() - t0;
    expect(elapsed).toBeLessThan(50);
  });
});

// ─── 7. ROI — what the primitive unlocks ──────────────────────────

describe('PermissionPolicy — ROI: data-driven governance', () => {
  it('one source of truth: the same role map drives gatedTools AND PermissionChecker', async () => {
    // The win: ONE allowlist data structure governs BOTH tool exposure
    // (what the LLM sees) AND tool dispatch (what the runtime allows).
    // No drift between "tool list" and "permission check".
    const allTools = [
      fakeTool('lookup_order'),
      fakeTool('process_refund'),
      fakeTool('delete_user'),
    ];
    const policy = PermissionPolicy.fromRoles(ROLES, 'support');

    // Surface: what the LLM sees
    const provider = gatedTools(staticTools(allTools), (n) => policy.isAllowed(n));
    expect(provider.list(baseCtx).map((t) => t.schema.name)).toEqual([
      'lookup_order',
      'process_refund',
    ]);

    // Dispatch: what the runtime allows
    const allowedDispatch = await policy.check({
      capability: 'tool_call',
      actor: 'u',
      target: 'process_refund',
    });
    expect(allowedDispatch.result).toBe('allow');

    const blockedDispatch = await policy.check({
      capability: 'tool_call',
      actor: 'u',
      target: 'delete_user',
    });
    expect(blockedDispatch.result).toBe('deny');
  });
});
