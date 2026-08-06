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

import { describe, expect, it, vi } from 'vitest';
import { enableDevMode, disableDevMode } from 'footprintjs';
import { defineTool, Agent, type Tool } from '../../src/index.js';
import { type ToolDispatchContext, type ToolProvider } from '../../src/tool-providers/index.js';
import {
  skillScopedTools,
  skillScopedToolsTarget,
  staticTools,
} from '../../src/tool-providers/index.js';
import { defineSkill, skillGraph } from '../../src/injection-engine.js';
import { mock } from '../../src/llm-providers.js';
import { expectScalesLinearly } from '../helpers/perf.js';

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
  it("concat-style composition shows ONLY the active skill's tools", () => {
    const baseline = staticTools([fakeTool('lookup_order')]);
    const billing = skillScopedTools('billing', [fakeTool('refund'), fakeTool('charge')]);
    const refund = skillScopedTools('refund', [fakeTool('reverse')]);

    const composite: ToolProvider = {
      id: 'composite',
      list: (ctx) => [...baseline.list(ctx), ...billing.list(ctx), ...refund.list(ctx)],
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
  it('list() cost stays flat as calls pile up', { timeout: 30_000, retry: 2 }, async () => {
    const provider = skillScopedTools('billing', [
      fakeTool('refund'),
      fakeTool('charge'),
      fakeTool('lookup'),
    ]);
    const list = (times: number): void => {
      for (let i = 0; i < times; i++) {
        provider.list(ctxBilling);
        provider.list(ctxRefund);
      }
    };
    await expectScalesLinearly({
      small: () => list(10_000),
      large: () => list(100_000),
      scale: 10,
      why: 'skill scoping must be decided per call, not accumulated',
    });
  });
});

// ─── 7. ROI — what the primitive unlocks ──────────────────────────

describe('skillScopedTools — ROI: per-skill choice space narrowing', () => {
  it("the LLM's tool list flips between activations — recency-first context engineering", () => {
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

// ─── 8.7.0 — the silent-empty is reported, and the graph signal exists ────────

describe('skillScopedTools — the silent empty (8.7.0)', () => {
  it('unit: warns when its skill IS active but did not arrive by read_skill', () => {
    enableDevMode();
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      const provider = skillScopedTools('billing', [fakeTool('process_refund')]);
      // `activeSkillIds` is the real active set — the graph routed into `billing`.
      // `activeSkillId` is the read_skill tail, and read_skill was never called.
      const tools = provider.list({ iteration: 2, activeSkillIds: ['billing'] });
      expect(tools).toEqual([]);
      expect(warn).toHaveBeenCalledTimes(1);
      const line = String(warn.mock.calls[0]![0]);
      expect(line).toMatch(/IS active on iteration 2/);
      expect(line).toMatch(/not activated by read_skill/);
      expect(line).toMatch(/ctx\.activeSkillIds/);
    } finally {
      warn.mockRestore();
      disableDevMode();
    }
  });

  it('unit: latched — a long loop gets one line, not one per iteration', () => {
    enableDevMode();
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      const provider = skillScopedTools('billing', [fakeTool('process_refund')]);
      for (let i = 1; i <= 10; i++) provider.list({ iteration: i, activeSkillIds: ['billing'] });
      expect(warn).toHaveBeenCalledTimes(1);
    } finally {
      warn.mockRestore();
      disableDevMode();
    }
  });

  it('functional: silent when the skill is genuinely not active, and outside dev mode', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      const provider = skillScopedTools('billing', [fakeTool('process_refund')]);
      enableDevMode();
      expect(provider.list({ iteration: 1, activeSkillIds: ['refund'] })).toEqual([]);
      expect(provider.list({ iteration: 1 })).toEqual([]); // nothing active at all
      expect(warn).not.toHaveBeenCalled();
      disableDevMode();
      // dev mode off → no console cost even when the condition holds
      expect(provider.list({ iteration: 1, activeSkillIds: ['billing'] })).toEqual([]);
      expect(warn).not.toHaveBeenCalled();
    } finally {
      disableDevMode();
      warn.mockRestore();
    }
  });

  it('functional: the happy path is untouched — read_skill activation still yields tools', () => {
    const provider = skillScopedTools('billing', [fakeTool('process_refund')]);
    const tools = provider.list({
      iteration: 1,
      activeSkillId: 'billing',
      activeSkillIds: ['billing'],
    });
    expect(tools.map((t) => t.schema.name)).toEqual(['process_refund']);
  });

  it('integration: ctx.activeSkillIds lets a provider follow the GRAPH position', async () => {
    // The escape hatch the header could not offer before 8.7.0.
    const graphScoped = (id: string, tools: readonly Tool[]): ToolProvider => ({
      id: `graph-scoped:${id}`,
      list: (ctx) => (ctx.activeSkillIds?.includes(id) ? [...tools] : []),
    });
    const alpha = defineSkill({
      id: 'alpha',
      description: 'use alpha',
      body: 'a',
      tools: [fakeTool('alpha_tool')],
      autoActivate: 'currentSkill',
    });
    const beta = defineSkill({ id: 'beta', description: 'use beta', body: 'b' });
    const graph = skillGraph({
      skills: [alpha, beta],
      start: 'alpha',
      steps: [{ from: 'alpha', to: 'beta', onToolReturn: 'alpha_tool' }],
      check: 'throw',
    });
    const offered: string[][] = [];
    let step = 0;
    const agent = Agent.create({
      provider: mock({
        respond: () =>
          step++ === 0
            ? {
                content: 'c',
                toolCalls: [{ id: 'c1', name: 'alpha_tool', args: {} }],
                stopReason: 'tool_use',
              }
            : { content: 'done', toolCalls: [], stopReason: 'stop' },
      }),
      model: 'mock',
      maxIterations: 4,
    })
      .system('s')
      .skillGraph(graph)
      .toolProvider(graphScoped('beta', [fakeTool('beta_scoped')]))
      .watch({
        id: 'w',
        onEmit: (e) => {
          if (e.name === 'agentfootprint.stream.llm_start') {
            offered.push(
              ((e.payload as { tools?: { name: string }[] }).tools ?? []).map((t) => t.name),
            );
          }
        },
      })
      .build();
    await agent.run({ message: 'hi' });
    // Iteration 1: cursor on alpha → no beta tool. Iteration 2: the EDGE routed into
    // beta, no read_skill involved — and the provider sees it.
    expect(offered[0]).not.toContain('beta_scoped');
    expect(offered[1]).toContain('beta_scoped');
  });
});

describe('skillScopedTools — the redundant pairing is named at build (8.7.0)', () => {
  it('unit: warns when the target skill already scopes its own tools', () => {
    enableDevMode();
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      const alpha = defineSkill({
        id: 'alpha',
        description: 'use alpha',
        body: 'a',
        tools: [fakeTool('alpha_tool')],
        autoActivate: 'currentSkill',
      });
      const graph = skillGraph({ skills: [alpha], start: 'alpha', check: 'throw' });
      Agent.create({
        provider: mock({ respond: () => ({ content: 'x', toolCalls: [], stopReason: 'stop' }) }),
        model: 'mock',
      })
        .skillGraph(graph)
        .toolProvider(skillScopedTools('alpha', [fakeTool('extra_tool')]))
        .build();
      const lines = warn.mock.calls.map((c) => String(c[0])).filter((l) => l.includes('alpha'));
      expect(lines).toHaveLength(1);
      expect(lines[0]).toMatch(/already carries autoActivate: 'currentSkill'/);
    } finally {
      warn.mockRestore();
      disableDevMode();
    }
  });

  it('functional: silent when the skill carries no tools of its own, or is not autoActivate', () => {
    enableDevMode();
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      const bare = defineSkill({
        id: 'alpha',
        description: 'use alpha',
        body: 'a',
        autoActivate: 'currentSkill',
      });
      const graph = skillGraph({ skills: [bare], start: 'alpha', check: 'throw' });
      Agent.create({
        provider: mock({ respond: () => ({ content: 'x', toolCalls: [], stopReason: 'stop' }) }),
        model: 'mock',
      })
        .skillGraph(graph)
        .toolProvider(skillScopedTools('alpha', [fakeTool('extra_tool')]))
        .build();
      expect(warn.mock.calls.filter((c) => String(c[0]).includes('already carries'))).toHaveLength(
        0,
      );
    } finally {
      warn.mockRestore();
      disableDevMode();
    }
  });

  it('security: a provider id that merely LOOKS like one is not matched by accident', () => {
    expect(skillScopedToolsTarget('skill-scoped:alpha')).toBe('alpha');
    expect(skillScopedToolsTarget('skill-scoped:')).toBeUndefined();
    expect(skillScopedToolsTarget('composite')).toBeUndefined();
    expect(skillScopedToolsTarget(undefined)).toBeUndefined();
  });
});
