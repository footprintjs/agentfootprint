/**
 * Cache DSL — 10-test matrix across the 4 injection factories +
 * Agent.system() builder option.
 *
 * Phase 2 of v2.6 cache layer. Each factory's `cache:` field is
 * tested for:
 *   - default value (factory-specific)
 *   - explicit override to each sentinel form
 *   - composition via `{ until }` predicate
 *
 * Plus the AgentBuilder.system() 2-arg form.
 */

import { describe, expect, it } from 'vitest';
import {
  defineFact,
  defineInstruction,
  defineSkill,
  defineSteering,
  Agent,
  mock,
} from '../../src/index.js';
import type { CachePolicy } from '../../src/cache/types.js';
import { getFlavorDefault } from '../../src/cache/applyCachePolicy.js';

// Helper: read the resolved cache policy off an Injection's metadata.
function readCache(inj: { metadata?: Readonly<Record<string, unknown>> }): CachePolicy | undefined {
  return inj.metadata?.cache as CachePolicy | undefined;
}

// ─── 1. Defaults — each factory wires its documented default ─────

describe('Cache DSL — per-factory defaults', () => {
  it("defineSteering defaults to 'always'", () => {
    const s = defineSteering({ id: 's', prompt: 'Be polite.' });
    expect(readCache(s)).toBe('always');
    expect(getFlavorDefault('steering')).toBe('always');
  });

  it("defineFact defaults to 'always'", () => {
    const f = defineFact({ id: 'f', data: 'User: Alice' });
    expect(readCache(f)).toBe('always');
    expect(getFlavorDefault('fact')).toBe('always');
  });

  it("defineSkill defaults to 'while-active'", () => {
    const sk = defineSkill({
      id: 'sk',
      description: 'A skill',
      body: 'Do the thing.',
    });
    expect(readCache(sk)).toBe('while-active');
    expect(getFlavorDefault('skill')).toBe('while-active');
  });

  it("defineInstruction defaults to 'never'", () => {
    const i = defineInstruction({ id: 'i', prompt: 'Be calm.' });
    expect(readCache(i)).toBe('never');
    expect(getFlavorDefault('instruction')).toBe('never');
  });
});

// ─── 2. Override — consumer can change the policy ────────────────

describe('Cache DSL — explicit overrides', () => {
  it('defineSteering accepts cache: never (e.g., timestamp content)', () => {
    const s = defineSteering({
      id: 's',
      prompt: `Time is ${new Date().toISOString()}`,
      cache: 'never',
    });
    expect(readCache(s)).toBe('never');
  });

  it('defineFact accepts cache: while-active', () => {
    const f = defineFact({
      id: 'f',
      data: 'Session token: abc',
      cache: 'while-active',
    });
    expect(readCache(f)).toBe('while-active');
  });

  it('defineSkill accepts cache: always (skill body always hot-cached)', () => {
    const sk = defineSkill({
      id: 'sk',
      description: 'd',
      body: 'b',
      cache: 'always',
    });
    expect(readCache(sk)).toBe('always');
  });

  it('defineInstruction accepts cache: { until } predicate (composition)', () => {
    const i = defineInstruction({
      id: 'i',
      activeWhen: () => true,
      prompt: 'Be calm.',
      cache: { until: (ctx) => ctx.iteration > 5 },
    });
    const cache = readCache(i);
    expect(cache).toBeTypeOf('object');
    if (typeof cache === 'object' && cache !== null && 'until' in cache) {
      expect(
        cache.until({
          iteration: 6,
          iterationsRemaining: 0,
          userMessage: 'go',
          cumulativeInputTokens: 100,
        }),
      ).toBe(true);
      expect(
        cache.until({
          iteration: 3,
          iterationsRemaining: 3,
          userMessage: 'go',
          cumulativeInputTokens: 100,
        }),
      ).toBe(false);
    }
  });
});

// ─── 3. Builder — Agent.system(text, { cache }) option ────────────

describe('Cache DSL — Agent.system() builder option', () => {
  it("system(text) without options leaves the default 'always' base-prompt policy", () => {
    const agent = Agent.create({ provider: mock(), model: 'mock' })
      .system('You are a test agent.')
      .build();
    expect(agent.getSystemPromptCachePolicy()).toBe('always');
  });

  it("system(text, { cache: 'never' }) overrides the default", () => {
    const agent = Agent.create({ provider: mock(), model: 'mock' })
      .system(`Now is ${new Date().toISOString()}`, { cache: 'never' })
      .build();
    expect(agent.getSystemPromptCachePolicy()).toBe('never');
  });
});
