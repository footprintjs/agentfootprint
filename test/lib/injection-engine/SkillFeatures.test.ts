/**
 * Skills v2.4 Phase 4 features — tests for surfaceMode + refreshPolicy +
 * SkillRegistry + resolveSurfaceMode.
 *
 * Covers the new typed API surface added in v2.4. Full per-mode runtime
 * routing diversity (suppress system-prompt for 'tool-only', etc.)
 * lands in v2.5; these tests validate the API contract that consumers
 * rely on TODAY.
 */

import { describe, expect, it } from 'vitest';

import {
  defineSkill,
  resolveSurfaceMode,
  SkillRegistry,
  defineInstruction,
} from '../../../src/index.js';

// ─── defineSkill — surfaceMode option ────────────────────────────

describe('defineSkill — surfaceMode option', () => {
  it("default surfaceMode is 'auto'", () => {
    const s = defineSkill({
      id: 'billing',
      description: 'Billing skill',
      body: 'Confirm identity first.',
    });
    const md = s.metadata as { surfaceMode: string };
    expect(md.surfaceMode).toBe('auto');
  });

  it('passes surfaceMode through to metadata', () => {
    const s = defineSkill({
      id: 'billing',
      description: 'Billing skill',
      body: 'Confirm identity first.',
      surfaceMode: 'tool-only',
    });
    const md = s.metadata as { surfaceMode: string };
    expect(md.surfaceMode).toBe('tool-only');
  });

  it('accepts all four surfaceMode values', () => {
    const modes = ['auto', 'system-prompt', 'tool-only', 'both'] as const;
    for (const mode of modes) {
      const s = defineSkill({
        id: `s-${mode}`,
        description: 'd',
        body: 'b',
        surfaceMode: mode,
      });
      expect((s.metadata as { surfaceMode: string }).surfaceMode).toBe(mode);
    }
  });
});

// ─── defineSkill — refreshPolicy option ──────────────────────────

describe('defineSkill — refreshPolicy option', () => {
  it('refreshPolicy absent by default', () => {
    const s = defineSkill({
      id: 'billing',
      description: 'd',
      body: 'b',
    });
    const md = s.metadata as { refreshPolicy?: unknown };
    expect(md.refreshPolicy).toBeUndefined();
  });

  it('passes refreshPolicy through to metadata', () => {
    const s = defineSkill({
      id: 'billing',
      description: 'd',
      body: 'b',
      refreshPolicy: { afterTokens: 50_000, via: 'tool-result' },
    });
    const md = s.metadata as { refreshPolicy: { afterTokens: number; via: string } };
    expect(md.refreshPolicy.afterTokens).toBe(50_000);
    expect(md.refreshPolicy.via).toBe('tool-result');
  });
});

// ─── resolveSurfaceMode — per-provider defaults ──────────────────

describe('resolveSurfaceMode — per-provider defaults', () => {
  it("Claude ≥ 3.5 resolves to 'both'", () => {
    expect(resolveSurfaceMode('anthropic', 'claude-3-5-sonnet-20240620')).toBe('both');
    expect(resolveSurfaceMode('anthropic', 'claude-sonnet-4-5-20250929')).toBe('both');
    expect(resolveSurfaceMode('anthropic', 'claude-haiku-4-5-20251001')).toBe('both');
  });

  it("Claude pre-3.5 resolves to 'tool-only'", () => {
    expect(resolveSurfaceMode('anthropic', 'claude-2.1')).toBe('tool-only');
    expect(resolveSurfaceMode('anthropic', 'claude-3-haiku-20240307')).toBe('tool-only');
  });

  it("Claude with no model resolves to 'tool-only' (safe default)", () => {
    expect(resolveSurfaceMode('anthropic')).toBe('tool-only');
  });

  it("OpenAI / Bedrock / Ollama / Mock all resolve to 'tool-only'", () => {
    expect(resolveSurfaceMode('openai', 'gpt-4o')).toBe('tool-only');
    expect(resolveSurfaceMode('bedrock', 'meta.llama-3.1-70b')).toBe('tool-only');
    expect(resolveSurfaceMode('ollama', 'llama3.1')).toBe('tool-only');
    expect(resolveSurfaceMode('mock')).toBe('tool-only');
  });

  it('unknown provider resolves to tool-only (cross-provider-correct default)', () => {
    expect(resolveSurfaceMode('vendor-x')).toBe('tool-only');
  });

  it('case-insensitive provider matching', () => {
    expect(resolveSurfaceMode('Anthropic', 'claude-sonnet-4-5-20250929')).toBe('both');
    expect(resolveSurfaceMode('OPENAI', 'gpt-4o')).toBe('tool-only');
  });
});

// ─── SkillRegistry — register / get / list / has / size ──────────

describe('SkillRegistry — basic operations', () => {
  it('starts empty', () => {
    const r = new SkillRegistry();
    expect(r.size).toBe(0);
    expect(r.list()).toEqual([]);
  });

  it('register stores by id; get retrieves; has reports membership', () => {
    const r = new SkillRegistry();
    const billing = defineSkill({ id: 'billing', description: 'd', body: 'b' });
    r.register(billing);
    expect(r.size).toBe(1);
    expect(r.get('billing')).toBe(billing);
    expect(r.has('billing')).toBe(true);
    expect(r.has('missing')).toBe(false);
    expect(r.list()).toEqual([billing]);
  });

  it('register chains (returns this)', () => {
    const r = new SkillRegistry();
    const a = defineSkill({ id: 'a', description: 'd', body: 'b' });
    const b = defineSkill({ id: 'b', description: 'd', body: 'b' });
    const c = defineSkill({ id: 'c', description: 'd', body: 'b' });
    r.register(a).register(b).register(c);
    expect(r.size).toBe(3);
    expect(r.list().map((s) => s.id)).toEqual(['a', 'b', 'c']);
  });

  it('register throws on duplicate id (use replace to overwrite)', () => {
    const r = new SkillRegistry();
    r.register(defineSkill({ id: 'billing', description: 'd', body: 'b1' }));
    expect(() =>
      r.register(defineSkill({ id: 'billing', description: 'd', body: 'b2' })),
    ).toThrow(/already registered.*Use \.replace/);
  });

  it('register throws on non-Skill flavor', () => {
    const r = new SkillRegistry();
    const inst = defineInstruction({
      id: 'i',
      activeWhen: () => true,
      prompt: 'p',
    });
    expect(() => r.register(inst)).toThrow(/expected a Skill/);
  });

  it('replace overwrites by id', () => {
    const r = new SkillRegistry();
    r.register(defineSkill({ id: 'billing', description: 'd', body: 'old' }));
    r.replace('billing', defineSkill({ id: 'billing', description: 'd', body: 'new' }));
    expect(r.size).toBe(1);
    const retrieved = r.get('billing')!;
    expect(retrieved.inject.systemPrompt).toBe('new');
  });

  it('replace throws on missing id', () => {
    const r = new SkillRegistry();
    expect(() =>
      r.replace('missing', defineSkill({ id: 'missing', description: 'd', body: 'b' })),
    ).toThrow(/no skill registered/);
  });

  it('replace throws on id mismatch', () => {
    const r = new SkillRegistry();
    r.register(defineSkill({ id: 'a', description: 'd', body: 'b' }));
    expect(() =>
      r.replace('a', defineSkill({ id: 'b', description: 'd', body: 'b' })),
    ).toThrow(/does not match the slot id/);
  });

  it('unregister removes by id; no-op for missing', () => {
    const r = new SkillRegistry();
    r.register(defineSkill({ id: 'a', description: 'd', body: 'b' }));
    r.register(defineSkill({ id: 'b', description: 'd', body: 'b' }));
    r.unregister('a');
    expect(r.size).toBe(1);
    expect(r.get('a')).toBeUndefined();
    r.unregister('missing'); // no-op
    expect(r.size).toBe(1);
  });

  it('clear empties the registry', () => {
    const r = new SkillRegistry();
    r.register(defineSkill({ id: 'a', description: 'd', body: 'b' }));
    r.register(defineSkill({ id: 'b', description: 'd', body: 'b' }));
    r.clear();
    expect(r.size).toBe(0);
  });

  it('list order matches registration order', () => {
    const r = new SkillRegistry();
    const ids = ['z', 'm', 'a', 'q'];
    for (const id of ids) r.register(defineSkill({ id, description: 'd', body: 'b' }));
    expect(r.list().map((s) => s.id)).toEqual(ids);
  });
});

// ─── ROI — what the new surface unlocks ──────────────────────────

describe('Skills v2.4 features — ROI', () => {
  it('SkillRegistry replaces hand-syncing skills across multiple agents', () => {
    // Without registry: have to remember to call .skill(billing) on
    // every Agent that should know about billing. Forgetting one is a
    // bug. With registry: register once, attach the registry to every
    // consumer Agent — adding a skill propagates automatically.
    const registry = new SkillRegistry();
    registry.register(defineSkill({ id: 'billing', description: 'd', body: 'b' }));
    registry.register(defineSkill({ id: 'refund', description: 'd', body: 'b' }));
    expect(registry.list().length).toBe(2);
    // Add a new skill — every consumer Agent picks it up at next build.
    registry.register(defineSkill({ id: 'compliance', description: 'd', body: 'b' }));
    expect(registry.list().length).toBe(3);
  });

  it('surfaceMode + refreshPolicy let consumers express intent before runtime supports it', () => {
    // The API surface is stable. The runtime polish (per-mode routing
    // diversity) lands in v2.5 without API change. Code written today
    // continues to work; behavior tightens silently.
    const s = defineSkill({
      id: 'long-context-skill',
      description: 'Used in 100k+ token runs',
      body: 'Critical reasoning rule.',
      surfaceMode: 'both',
      refreshPolicy: { afterTokens: 50_000, via: 'tool-result' },
    });
    const md = s.metadata as { surfaceMode: string; refreshPolicy: unknown };
    expect(md.surfaceMode).toBe('both');
    expect(md.refreshPolicy).toBeDefined();
  });
});
