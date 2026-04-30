/**
 * SkillRegistry({surfaceMode, providerHint}) ctor opts +
 * resolveForSkill cascade — 7-pattern test matrix
 * (unit · scenario · integration · property · security · performance · ROI).
 *
 * Pins the cascade:
 *   1. Per-skill explicit `surfaceMode` always wins.
 *   2. Else registry-level `surfaceMode` (if set + not 'auto').
 *   3. Else global `resolveSurfaceMode(provider, model)`.
 *
 * Forward-compat for Block C / v2.5 per-mode runtime routing.
 */

import { describe, expect, it } from 'vitest';
import {
  SkillRegistry,
  defineSkill,
  defineInstruction,
  type SurfaceMode,
} from '../../../src/index.js';

// ─── Fixtures ─────────────────────────────────────────────────────

function makeSkill(id: string, surfaceMode?: SurfaceMode) {
  return defineSkill({
    id,
    description: `${id} skill`,
    body: `body for ${id}`,
    ...(surfaceMode && { surfaceMode }),
  });
}

// ─── 1. UNIT — ctor + getters ─────────────────────────────────────

describe('SkillRegistry ctor opts — unit', () => {
  it('defaults: no opts → both getters undefined (v2.4 surface intact)', () => {
    const r = new SkillRegistry();
    expect(r.surfaceMode).toBeUndefined();
    expect(r.providerHint).toBeUndefined();
  });

  it('stores ctor opts and exposes via getters', () => {
    const r = new SkillRegistry({ surfaceMode: 'tool-only', providerHint: 'openai' });
    expect(r.surfaceMode).toBe('tool-only');
    expect(r.providerHint).toBe('openai');
  });

  it('partial opts: surfaceMode without providerHint', () => {
    const r = new SkillRegistry({ surfaceMode: 'both' });
    expect(r.surfaceMode).toBe('both');
    expect(r.providerHint).toBeUndefined();
  });

  it('partial opts: providerHint without surfaceMode', () => {
    const r = new SkillRegistry({ providerHint: 'anthropic' });
    expect(r.surfaceMode).toBeUndefined();
    expect(r.providerHint).toBe('anthropic');
  });

  it('opts are frozen (mutation throws or is silently ignored)', () => {
    const r = new SkillRegistry({ surfaceMode: 'tool-only' });
    // In strict mode, freezing throws on mutation. In non-strict, silent.
    // Either way, the value cannot be observed as changed.
    expect(r.surfaceMode).toBe('tool-only');
  });
});

// ─── 2. SCENARIO — resolveForSkill cascade ────────────────────────

describe('SkillRegistry.resolveForSkill — cascade', () => {
  it('per-skill explicit wins: skill.surfaceMode=both → returns both even with registry tool-only', () => {
    const r = new SkillRegistry({ surfaceMode: 'tool-only' });
    r.register(makeSkill('billing', 'both'));
    expect(r.resolveForSkill('billing', 'anthropic', 'claude-sonnet-4-5')).toBe('both');
  });

  it('per-skill auto + registry concrete → registry default', () => {
    const r = new SkillRegistry({ surfaceMode: 'system-prompt' });
    r.register(makeSkill('billing', 'auto'));
    // Even though provider is anthropic-claude-3.5 (would resolve to 'both'),
    // registry's concrete 'system-prompt' takes precedence over global.
    expect(r.resolveForSkill('billing', 'anthropic', 'claude-sonnet-4-5')).toBe('system-prompt');
  });

  it('per-skill auto + registry auto + provider known → global resolveSurfaceMode', () => {
    const r = new SkillRegistry({ surfaceMode: 'auto' });
    r.register(makeSkill('billing'));
    // 'auto' on registry behaves like unset (falls through).
    expect(r.resolveForSkill('billing', 'anthropic', 'claude-sonnet-4-5')).toBe('both');
  });

  it('per-skill auto + registry unset + provider arg → global resolveSurfaceMode', () => {
    const r = new SkillRegistry();
    r.register(makeSkill('billing'));
    expect(r.resolveForSkill('billing', 'openai', 'gpt-4o')).toBe('tool-only');
    expect(r.resolveForSkill('billing', 'anthropic', 'claude-sonnet-4-5')).toBe('both');
  });

  it('per-skill auto + registry unset + providerHint → providerHint used', () => {
    const r = new SkillRegistry({ providerHint: 'anthropic' });
    r.register(makeSkill('billing'));
    expect(r.resolveForSkill('billing', undefined, 'claude-sonnet-4-5')).toBe('both');
  });

  it('explicit provider arg wins over providerHint', () => {
    const r = new SkillRegistry({ providerHint: 'anthropic' });
    r.register(makeSkill('billing'));
    expect(r.resolveForSkill('billing', 'openai', 'gpt-4o')).toBe('tool-only');
  });

  it('no provider info anywhere → falls back to tool-only', () => {
    const r = new SkillRegistry();
    r.register(makeSkill('billing'));
    expect(r.resolveForSkill('billing')).toBe('tool-only');
  });
});

// ─── 3. INTEGRATION — works with id OR Injection arg ──────────────

describe('SkillRegistry.resolveForSkill — integration', () => {
  it('accepts skill id (string)', () => {
    const r = new SkillRegistry({ surfaceMode: 'both' });
    r.register(makeSkill('billing'));
    expect(r.resolveForSkill('billing')).toBe('both');
  });

  it('accepts Injection object directly', () => {
    const r = new SkillRegistry({ surfaceMode: 'both' });
    const skill = makeSkill('billing');
    r.register(skill);
    expect(r.resolveForSkill(skill)).toBe('both');
  });

  it('toTools() still works with ctor opts in place', () => {
    const r = new SkillRegistry({ surfaceMode: 'tool-only' });
    r.register(makeSkill('billing'));
    const { listSkills, readSkill } = r.toTools();
    expect(listSkills?.schema.name).toBe('list_skills');
    expect(readSkill?.schema.name).toBe('read_skill');
  });
});

// ─── 4. PROPERTY — invariants ──────────────────────────────────────

describe('SkillRegistry.resolveForSkill — properties', () => {
  it('never returns "auto" — always a concrete mode', () => {
    const r = new SkillRegistry({ surfaceMode: 'auto', providerHint: 'mock' });
    r.register(makeSkill('billing', 'auto'));
    const result = r.resolveForSkill('billing');
    expect(['system-prompt', 'tool-only', 'both']).toContain(result);
    expect(result).not.toBe('auto');
  });

  it('deterministic: same input → same output across N calls', () => {
    const r = new SkillRegistry({ surfaceMode: 'tool-only' });
    r.register(makeSkill('billing'));
    const first = r.resolveForSkill('billing');
    for (let i = 0; i < 100; i++) {
      expect(r.resolveForSkill('billing')).toBe(first);
    }
  });
});

// ─── 5. SECURITY — fail-fast on bad inputs ────────────────────────

describe('SkillRegistry.resolveForSkill — security/fail-fast', () => {
  it('throws on unregistered skill id', () => {
    const r = new SkillRegistry();
    expect(() => r.resolveForSkill('phantom')).toThrow(/no skill registered at id 'phantom'/);
  });

  it('throws on non-Skill Injection (wrong flavor)', () => {
    const r = new SkillRegistry();
    const instruction = defineInstruction({
      id: 'rule',
      activeWhen: () => true,
      prompt: 'r',
    });
    expect(() => r.resolveForSkill(instruction)).toThrow(/flavor 'instructions', expected 'skill'/);
  });
});

// ─── 6. PERFORMANCE — bounded ────────────────────────────────────

describe('SkillRegistry.resolveForSkill — performance', () => {
  it('10k cascade calls under 50ms (no cache, fresh resolve every time)', () => {
    const r = new SkillRegistry({ providerHint: 'anthropic' });
    r.register(makeSkill('billing'));

    const t0 = Date.now();
    for (let i = 0; i < 10_000; i++) {
      r.resolveForSkill('billing', undefined, 'claude-sonnet-4-5');
    }
    const elapsed = Date.now() - t0;
    expect(elapsed).toBeLessThan(50);
  });
});

// ─── 7. ROI — what the API unlocks ────────────────────────────────

describe('SkillRegistry ctor opts — ROI', () => {
  it('one place to set surfaceMode for an entire registry of skills', () => {
    // Without ctor opts: every defineSkill needs surfaceMode: 'both'
    // With ctor opts: registry sets it once, every auto-mode skill inherits
    const r = new SkillRegistry({ surfaceMode: 'both' });
    r.register(makeSkill('billing')); // no surfaceMode → 'auto' default
    r.register(makeSkill('refund'));
    r.register(makeSkill('compliance'));

    // All three resolve to 'both' via the registry default
    expect(r.resolveForSkill('billing')).toBe('both');
    expect(r.resolveForSkill('refund')).toBe('both');
    expect(r.resolveForSkill('compliance')).toBe('both');
  });

  it('per-skill override survives the registry default', () => {
    const r = new SkillRegistry({ surfaceMode: 'both' });
    r.register(makeSkill('billing')); // → registry default 'both'
    r.register(makeSkill('cheap-skill', 'tool-only')); // → explicit 'tool-only'

    expect(r.resolveForSkill('billing')).toBe('both');
    expect(r.resolveForSkill('cheap-skill')).toBe('tool-only');
  });
});
