/**
 * skillScopedTools + autoActivate metadata — 7-pattern test matrix
 * (unit · scenario · integration · property · security · performance · ROI).
 *
 * Pins the contract:
 *   - skillScopedTools(id, tools) emits tools ONLY when ctx.activeSkillId === id.
 *   - Composes with staticTools / gatedTools — concat-style aggregation works.
 *   - defineSkill({ autoActivate: 'currentSkill' }) → metadata field.
 *   - Empty list when activeSkillId mismatch / missing (closed-fail).
 *   - Pure / deterministic per (skillId, ctx).
 */

import { describe, expect, it } from 'vitest';
import {
  skillScopedTools,
  staticTools,
  defineSkill,
  defineTool,
  type ToolDispatchContext,
  type ToolProvider,
  type Tool,
} from '../../src/index.js';

// ─── Fixtures ─────────────────────────────────────────────────────

function fakeTool(name: string): Tool {
  return defineTool({
    name,
    description: name,
    inputSchema: { type: 'object' },
    execute: async () => `result-${name}`,
  });
}

const ctxNone: ToolDispatchContext = {
  iteration: 1,
  identity: { conversationId: 'c1' },
};
const ctxBilling: ToolDispatchContext = {
  iteration: 2,
  activeSkillId: 'billing',
  identity: { conversationId: 'c1' },
};
const ctxRefund: ToolDispatchContext = {
  iteration: 2,
  activeSkillId: 'refund',
  identity: { conversationId: 'c1' },
};

// ─── 1. UNIT — basic gating ───────────────────────────────────────

describe('skillScopedTools — unit', () => {
  it('returns empty when no skill is active', () => {
    const provider = skillScopedTools('billing', [fakeTool('refund'), fakeTool('charge')]);
    expect(provider.list(ctxNone)).toEqual([]);
  });

  it('returns the captured tools when activeSkillId matches', () => {
    const provider = skillScopedTools('billing', [fakeTool('refund'), fakeTool('charge')]);
    const visible = provider.list(ctxBilling);
    expect(visible.map((t) => t.schema.name)).toEqual(['refund', 'charge']);
  });

  it('returns empty when activeSkillId is a DIFFERENT skill', () => {
    const provider = skillScopedTools('billing', [fakeTool('refund')]);
    expect(provider.list(ctxRefund)).toEqual([]);
  });

  it('id includes the skillId for observability', () => {
    const provider = skillScopedTools('billing', [fakeTool('refund')]);
    expect(provider.id).toBe('skill-scoped:billing');
  });

  it('throws when skillId is empty or whitespace', () => {
    expect(() => skillScopedTools('', [fakeTool('a')])).toThrow(/`skillId` is required/);
    expect(() => skillScopedTools('  ', [fakeTool('a')])).toThrow(/`skillId` is required/);
  });

  it('returns a fresh array each call', () => {
    const provider = skillScopedTools('billing', [fakeTool('refund')]);
    const a = provider.list(ctxBilling);
    const b = provider.list(ctxBilling);
    expect(a).not.toBe(b);
    expect(a).toEqual(b);
  });
});

// ─── 2. SCENARIO — multiple skill scopes side by side ─────────────

describe('skillScopedTools — scenario: multiple skill scopes', () => {
  it('concat-style composition shows ONLY the active skill\'s tools', () => {
    const baseline = staticTools([fakeTool('lookup_order')]);
    const billing = skillScopedTools('billing', [fakeTool('refund'), fakeTool('charge')]);
    const refund = skillScopedTools('refund', [fakeTool('reverse')]);

    const composite: ToolProvider = {
      id: 'composite',
      list: (ctx) => [
        ...baseline.list(ctx),
        ...billing.list(ctx),
        ...refund.list(ctx),
      ],
    };

    // No skill → only baseline
    expect(composite.list(ctxNone).map((t) => t.schema.name)).toEqual(['lookup_order']);

    // Billing active → baseline + billing scope
    expect(composite.list(ctxBilling).map((t) => t.schema.name)).toEqual([
      'lookup_order',
      'refund',
      'charge',
    ]);

    // Refund active → baseline + refund scope
    expect(composite.list(ctxRefund).map((t) => t.schema.name)).toEqual([
      'lookup_order',
      'reverse',
    ]);
  });
});

// ─── 3. INTEGRATION — defineSkill autoActivate metadata ───────────

describe('defineSkill autoActivate — metadata', () => {
  it('skill.metadata.autoActivate is undefined by default (back-compat)', () => {
    const skill = defineSkill({
      id: 'billing',
      description: 'Billing skill',
      body: 'body',
      tools: [fakeTool('refund')],
    });
    const meta = skill.metadata as { autoActivate?: string } | undefined;
    expect(meta?.autoActivate).toBeUndefined();
  });

  it('skill.metadata.autoActivate is set when provided', () => {
    const skill = defineSkill({
      id: 'billing',
      description: 'Billing skill',
      body: 'body',
      tools: [fakeTool('refund')],
      autoActivate: 'currentSkill',
    });
    const meta = skill.metadata as { autoActivate?: string } | undefined;
    expect(meta?.autoActivate).toBe('currentSkill');
  });

  it('autoActivate metadata pairs with skillScopedTools to drive runtime gating', () => {
    // Consumer pattern: defineSkill with autoActivate, then drive
    // skillScopedTools from skill.tools.
    const skillTools = [fakeTool('refund'), fakeTool('charge')];
    const skill = defineSkill({
      id: 'billing',
      description: 'Billing',
      body: 'body',
      tools: skillTools,
      autoActivate: 'currentSkill',
    });
    const meta = skill.metadata as { autoActivate?: string };
    expect(meta.autoActivate).toBe('currentSkill');

    // Build the gate
    const provider = skillScopedTools(skill.id, skillTools);
    expect(provider.list(ctxBilling).map((t) => t.schema.name)).toEqual(['refund', 'charge']);
    expect(provider.list(ctxNone)).toEqual([]);
  });
});

// ─── 4. PROPERTY — invariants ─────────────────────────────────────

describe('skillScopedTools — properties', () => {
  it('deterministic: same ctx → same output across N calls', () => {
    const provider = skillScopedTools('billing', [fakeTool('refund'), fakeTool('charge')]);
    const first = provider.list(ctxBilling).map((t) => t.schema.name);
    for (let i = 0; i < 100; i++) {
      expect(provider.list(ctxBilling).map((t) => t.schema.name)).toEqual(first);
    }
  });

  it('mutating the returned array is safe (does not affect provider state)', () => {
    const provider = skillScopedTools('billing', [fakeTool('refund')]);
    const a = provider.list(ctxBilling) as Tool[];
    a.push(fakeTool('SHOULD_NOT_LEAK'));
    expect(provider.list(ctxBilling).map((t) => t.schema.name)).toEqual(['refund']);
  });

  it('ctx.activeSkillId case-sensitive — "Billing" !== "billing"', () => {
    const provider = skillScopedTools('billing', [fakeTool('refund')]);
    expect(provider.list({ ...ctxBilling, activeSkillId: 'Billing' })).toEqual([]);
  });
});

// ─── 5. SECURITY — closed-fail by design ──────────────────────────

describe('skillScopedTools — security: closed-fail', () => {
  it('missing activeSkillId → empty (no implicit "everything visible")', () => {
    const provider = skillScopedTools('billing', [fakeTool('refund')]);
    expect(provider.list(ctxNone)).toEqual([]);
  });

  it('mismatched activeSkillId → empty (no fall-through)', () => {
    const provider = skillScopedTools('billing', [fakeTool('refund')]);
    expect(provider.list(ctxRefund)).toEqual([]);
  });

  it('throws at construction on empty/whitespace skillId (catches typos at config time)', () => {
    expect(() => skillScopedTools('', [fakeTool('a')])).toThrow();
    expect(() => skillScopedTools('   ', [fakeTool('a')])).toThrow();
  });
});

// ─── 6. PERFORMANCE — bounded ────────────────────────────────────

describe('skillScopedTools — performance', () => {
  it('10k list() calls under 50ms', () => {
    const provider = skillScopedTools('billing', [
      fakeTool('refund'),
      fakeTool('charge'),
      fakeTool('lookup'),
    ]);
    const t0 = Date.now();
    for (let i = 0; i < 10_000; i++) {
      provider.list(ctxBilling);
      provider.list(ctxRefund);
    }
    const elapsed = Date.now() - t0;
    expect(elapsed).toBeLessThan(50);
  });
});

// ─── 7. ROI — what the primitive unlocks ──────────────────────────

describe('skillScopedTools — ROI: per-skill choice space narrowing', () => {
  it('the LLM\'s tool list flips between activations — recency-first context engineering', () => {
    // The Dynamic ReAct payoff: when the LLM activates `billing`, the
    // tool list narrows to billing's tools. When it activates `refund`,
    // it narrows to refund's tools. Sharper choice space per turn.
    const baseline = staticTools([fakeTool('lookup_order')]);
    const billing = skillScopedTools('billing', [fakeTool('process_refund'), fakeTool('charge')]);
    const refund = skillScopedTools('refund', [fakeTool('reverse_charge')]);

    const provider: ToolProvider = {
      id: 'composite',
      list: (ctx) => [...baseline.list(ctx), ...billing.list(ctx), ...refund.list(ctx)],
    };

    // Iter 1: no skill — sparse menu (just baseline)
    const iter1 = provider.list({ iteration: 1, identity: { conversationId: '_' } });
    expect(iter1.length).toBe(1);

    // Iter 2: billing active — narrowed to billing surface
    const iter2 = provider.list({
      iteration: 2,
      activeSkillId: 'billing',
      identity: { conversationId: '_' },
    });
    expect(iter2.length).toBe(3);
    expect(iter2.map((t) => t.schema.name)).toContain('process_refund');
    expect(iter2.map((t) => t.schema.name)).not.toContain('reverse_charge');

    // Iter 3: refund active — narrowed to refund surface
    const iter3 = provider.list({
      iteration: 3,
      activeSkillId: 'refund',
      identity: { conversationId: '_' },
    });
    expect(iter3.length).toBe(2);
    expect(iter3.map((t) => t.schema.name)).toContain('reverse_charge');
    expect(iter3.map((t) => t.schema.name)).not.toContain('process_refund');
  });
});
