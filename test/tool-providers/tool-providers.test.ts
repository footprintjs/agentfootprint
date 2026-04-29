/**
 * tool-providers — 7-pattern test matrix
 * (unit · scenario · integration · property · security · performance · ROI).
 *
 * Covers:
 *   - staticTools(arr): identity provider over a fixed Tool[]
 *   - gatedTools(inner, predicate): chainable filter decorator
 *   - composition: gatedTools(gatedTools(staticTools(...), p1), p2)
 */

import { describe, expect, it } from 'vitest';
import { staticTools, gatedTools, type ToolDispatchContext } from '../../src/index.js';
import type { Tool } from '../../src/index.js';

// ─── Fixtures ─────────────────────────────────────────────────────

function fakeTool(name: string): Tool {
  return {
    schema: { name, description: name, inputSchema: { type: 'object' } },
    execute: async () => `result-${name}`,
  };
}

const baseCtx: ToolDispatchContext = {
  iteration: 1,
  identity: { conversationId: 'c1' },
};

// ─── 1. UNIT — staticTools ────────────────────────────────────────

describe('staticTools — unit', () => {
  it('returns the wrapped list verbatim', () => {
    const tools = [fakeTool('a'), fakeTool('b'), fakeTool('c')];
    const provider = staticTools(tools);
    const visible = provider.list(baseCtx);
    expect(visible.map((t) => t.schema.name)).toEqual(['a', 'b', 'c']);
  });

  it('returns a fresh array each call (reference identity changes)', () => {
    const provider = staticTools([fakeTool('a')]);
    const first = provider.list(baseCtx);
    const second = provider.list(baseCtx);
    expect(first).not.toBe(second); // different reference
    expect(first).toEqual(second); // same content
  });

  it('captures the input list defensively (mutating the source array does not leak)', () => {
    const sourceArr = [fakeTool('a')];
    const provider = staticTools(sourceArr);
    sourceArr.push(fakeTool('b')); // mutate the original
    const visible = provider.list(baseCtx);
    expect(visible.map((t) => t.schema.name)).toEqual(['a']); // not affected
  });

  it("provider.id is 'static'", () => {
    expect(staticTools([]).id).toBe('static');
  });

  it('empty list works (zero tools is a valid configuration)', () => {
    expect(staticTools([]).list(baseCtx)).toEqual([]);
  });
});

// ─── 2. UNIT — gatedTools ─────────────────────────────────────────

describe('gatedTools — unit', () => {
  it('filters by predicate (allow-some)', () => {
    const inner = staticTools([fakeTool('read_a'), fakeTool('write_b'), fakeTool('read_c')]);
    const provider = gatedTools(inner, (name) => name.startsWith('read_'));
    expect(provider.list(baseCtx).map((t) => t.schema.name)).toEqual(['read_a', 'read_c']);
  });

  it('predicate-true-everything = pass-through', () => {
    const tools = [fakeTool('a'), fakeTool('b')];
    const provider = gatedTools(staticTools(tools), () => true);
    expect(provider.list(baseCtx).map((t) => t.schema.name)).toEqual(['a', 'b']);
  });

  it('predicate-false-everything = empty', () => {
    const provider = gatedTools(staticTools([fakeTool('a')]), () => false);
    expect(provider.list(baseCtx)).toEqual([]);
  });

  it("provider.id is 'gated'", () => {
    expect(gatedTools(staticTools([]), () => true).id).toBe('gated');
  });

  it('predicate receives ctx (can use activeSkillId / identity)', () => {
    let receivedCtx: ToolDispatchContext | undefined;
    const provider = gatedTools(staticTools([fakeTool('a')]), (_name, ctx) => {
      receivedCtx = ctx;
      return true;
    });
    const customCtx: ToolDispatchContext = {
      iteration: 5,
      activeSkillId: 'billing',
      identity: { tenant: 'acme', principal: 'alice', conversationId: 'c1' },
    };
    provider.list(customCtx);
    expect(receivedCtx?.iteration).toBe(5);
    expect(receivedCtx?.activeSkillId).toBe('billing');
    expect(receivedCtx?.identity?.tenant).toBe('acme');
  });
});

// ─── 3. SCENARIO — composition (gatedTools over gatedTools) ────────

describe('tool-providers — scenario: composition', () => {
  it('stacks two gates: read-only over skill-gated', () => {
    const allTools = [
      fakeTool('read_billing'),
      fakeTool('write_billing'),
      fakeTool('read_tech'),
      fakeTool('write_tech'),
    ];
    const skillToolMap: Record<string, readonly string[]> = {
      billing: ['read_billing', 'write_billing'],
      tech: ['read_tech', 'write_tech'],
    };
    const provider = gatedTools(
      gatedTools(staticTools(allTools), (name) => name.startsWith('read_')), // read-only
      (name, ctx) => (ctx.activeSkillId ? skillToolMap[ctx.activeSkillId]?.includes(name) ?? false : true), // skill-gated
    );

    // No active skill → just the read filter
    expect(provider.list(baseCtx).map((t) => t.schema.name)).toEqual(['read_billing', 'read_tech']);

    // Active billing → both filters apply
    const billingCtx: ToolDispatchContext = { ...baseCtx, activeSkillId: 'billing' };
    expect(provider.list(billingCtx).map((t) => t.schema.name)).toEqual(['read_billing']);

    // Active tech → both filters apply
    const techCtx: ToolDispatchContext = { ...baseCtx, activeSkillId: 'tech' };
    expect(provider.list(techCtx).map((t) => t.schema.name)).toEqual(['read_tech']);
  });

  it('order matters: outer gate sees inner gate output', () => {
    // Inner: only "a"; outer: only names starting with "z"
    const provider = gatedTools(
      gatedTools(staticTools([fakeTool('a'), fakeTool('z')]), (n) => n === 'a'),
      (n) => n.startsWith('z'),
    );
    expect(provider.list(baseCtx)).toEqual([]);
  });
});

// ─── 4. INTEGRATION — drop into Agent.tools(arr) shape ─────────────

describe('tool-providers — integration', () => {
  it('staticTools().list(ctx) returns Tool[] compatible with Agent.tools()', async () => {
    // Once the Agent gains a .toolProvider() builder method (Block A
    // continued), provider.list(ctx) flows directly into the tool
    // registry. This test pins the SHAPE so the eventual integration
    // is mechanical.
    const provider = staticTools([fakeTool('a'), fakeTool('b')]);
    const tools = provider.list(baseCtx);
    // Same shape Agent.tools(arr) accepts today
    expect(tools.every((t) => typeof t.schema.name === 'string')).toBe(true);
    expect(tools.every((t) => typeof t.execute === 'function')).toBe(true);
  });
});

// ─── 5. PROPERTY — invariants ─────────────────────────────────────

describe('tool-providers — properties', () => {
  it('staticTools(arr) preserves tool order', () => {
    const names = Array.from({ length: 50 }, (_, i) => `t${i}`);
    const tools = names.map(fakeTool);
    const visible = staticTools(tools).list(baseCtx);
    expect(visible.map((t) => t.schema.name)).toEqual(names);
  });

  it('gatedTools never returns a tool the predicate rejected', () => {
    const tools = Array.from({ length: 100 }, (_, i) => fakeTool(`t${i}`));
    const allowed = new Set(['t5', 't42', 't99']);
    const provider = gatedTools(staticTools(tools), (n) => allowed.has(n));
    const visible = provider.list(baseCtx);
    for (const t of visible) {
      expect(allowed.has(t.schema.name)).toBe(true);
    }
  });
});

// ─── 6. SECURITY — predicate semantics ─────────────────────────────

describe('tool-providers — security', () => {
  it('predicate that throws fails closed (does NOT silently allow)', () => {
    const provider = gatedTools(staticTools([fakeTool('a')]), () => {
      throw new Error('predicate bug');
    });
    // Throwing predicate should propagate — better to crash loudly
    // than silently allow a tool through a broken policy.
    expect(() => provider.list(baseCtx)).toThrow(/predicate bug/);
  });

  it('hostile tool name with regex specials is treated as opaque string', () => {
    const provider = gatedTools(
      staticTools([fakeTool('.*')]),
      (n) => n === '.*', // strict equality, not regex match
    );
    expect(provider.list(baseCtx).map((t) => t.schema.name)).toEqual(['.*']);
  });

  it('predicate filtering is per-tool — denials do not leak across tools', () => {
    const provider = gatedTools(
      staticTools([fakeTool('a'), fakeTool('b'), fakeTool('c')]),
      (n) => n !== 'b',
    );
    expect(provider.list(baseCtx).map((t) => t.schema.name)).toEqual(['a', 'c']);
  });
});

// ─── 7. PERFORMANCE ───────────────────────────────────────────────

describe('tool-providers — performance', () => {
  it('staticTools.list() is O(n) — 1k tools handled trivially', () => {
    const tools = Array.from({ length: 1000 }, (_, i) => fakeTool(`t${i}`));
    const provider = staticTools(tools);
    const t0 = Date.now();
    for (let i = 0; i < 100; i++) provider.list(baseCtx);
    const elapsed = Date.now() - t0;
    expect(elapsed).toBeLessThan(200); // 100 invocations × 1k tools each
  });

  it('gatedTools.list() per-iteration cost is bounded by inner.list cost + 1 filter pass', () => {
    const tools = Array.from({ length: 1000 }, (_, i) => fakeTool(`t${i}`));
    const provider = gatedTools(staticTools(tools), (n) => n.startsWith('t1'));
    const t0 = Date.now();
    for (let i = 0; i < 100; i++) provider.list(baseCtx);
    const elapsed = Date.now() - t0;
    expect(elapsed).toBeLessThan(400);
  });
});

// ─── 8. ROI — what the abstraction unlocks ────────────────────────

describe('tool-providers — ROI', () => {
  it('replaces inline predicate-checking-in-tool-execute with declarative gating', () => {
    // Before: each tool's execute() had to check "am I allowed?" itself.
    // After: the gate lives ONCE at the provider level; tools stay focused
    // on their domain. Plus: composable across permission + skill gates.
    const allTools = [fakeTool('public_a'), fakeTool('admin_b')];
    const provider = gatedTools(staticTools(allTools), (name) => !name.startsWith('admin_'));
    const visible = provider.list(baseCtx);
    expect(visible.map((t) => t.schema.name)).toEqual(['public_a']);
  });

  it('production composition: source + dispatch + permission, all decorator-shaped', () => {
    // Three concerns layered cleanly:
    //   1. source         → staticTools(allTools)
    //   2. read-only gate → gatedTools(inner, isReadonly)
    //   3. skill gate     → gatedTools(inner, isActiveSkillTool)
    // Each layer is one concern. Composition handles the rest.
    const allTools = [
      fakeTool('read_billing'),
      fakeTool('write_billing'),
      fakeTool('read_health'),
    ];
    const isReadonly = (n: string) => n.startsWith('read_');
    const skillMap: Record<string, readonly string[]> = {
      billing: ['read_billing', 'write_billing'],
    };
    const provider = gatedTools(
      gatedTools(staticTools(allTools), isReadonly),
      (n, c) => (c.activeSkillId ? (skillMap[c.activeSkillId] ?? []).includes(n) : true),
    );
    const visible = provider.list({ ...baseCtx, activeSkillId: 'billing' });
    // Read-only AND in billing skill = read_billing only
    expect(visible.map((t) => t.schema.name)).toEqual(['read_billing']);
  });
});
