/**
 * Strategy registry + NoOp — 7-pattern test matrix.
 *
 * Phase 6 of v2.6 cache layer. Tests the registry's auto-resolution
 * + the NoOp fallback behavior. Each pattern at least one test:
 *   - unit, boundary, scenario, property, security, performance, ROI.
 */

import { afterEach, describe, expect, it } from 'vitest';
import {
  _resetRegistryForTests,
  getDefaultCacheStrategy,
  listRegisteredStrategies,
  registerCacheStrategy,
} from '../../src/cache/strategyRegistry';
import { NoOpCacheStrategy } from '../../src/cache/strategies/NoOpCacheStrategy';
import type { CacheStrategy } from '../../src/cache/types';
import { expectScalesLinearly } from '../helpers/perf.js';

// Reset between tests to avoid test-order coupling
afterEach(() => _resetRegistryForTests());

// ─── 1. Unit ──────────────────────────────────────────────────────

describe('strategyRegistry — unit', () => {
  it('NoOp registered under wildcard by default', () => {
    const strategy = getDefaultCacheStrategy('any-unknown-provider');
    expect(strategy).toBeInstanceOf(NoOpCacheStrategy);
  });

  it('listRegisteredStrategies returns the wildcard at minimum', () => {
    expect(listRegisteredStrategies()).toContain('*');
  });

  it('registerCacheStrategy replaces an existing entry (most-recent wins)', () => {
    const a = new NoOpCacheStrategy() as CacheStrategy;
    Object.defineProperty(a, 'providerName', { value: 'foo' });
    const b = new NoOpCacheStrategy() as CacheStrategy;
    Object.defineProperty(b, 'providerName', { value: 'foo' });
    registerCacheStrategy(a);
    registerCacheStrategy(b);
    expect(getDefaultCacheStrategy('foo')).toBe(b);
  });
});

// ─── 2. Boundary ──────────────────────────────────────────────────

describe('strategyRegistry — boundary', () => {
  it('empty string provider name → wildcard NoOp', () => {
    const strategy = getDefaultCacheStrategy('');
    expect(strategy).toBeInstanceOf(NoOpCacheStrategy);
  });

  it('after _resetRegistryForTests, only wildcard remains', () => {
    registerCacheStrategy({ providerName: 'temp' } as CacheStrategy);
    _resetRegistryForTests();
    expect(listRegisteredStrategies()).toEqual(['*']);
  });
});

// ─── 3. Scenario ──────────────────────────────────────────────────

describe('strategyRegistry — scenario', () => {
  it('register multiple providers, look up each by name', () => {
    const stratA = { providerName: 'anthropic' } as CacheStrategy;
    const stratO = { providerName: 'openai' } as CacheStrategy;
    registerCacheStrategy(stratA);
    registerCacheStrategy(stratO);
    expect(getDefaultCacheStrategy('anthropic')).toBe(stratA);
    expect(getDefaultCacheStrategy('openai')).toBe(stratO);
    // Unregistered name still falls back
    expect(getDefaultCacheStrategy('unknown')).toBeInstanceOf(NoOpCacheStrategy);
  });

  it('case-insensitive fallback: ANTHROPIC matches anthropic', () => {
    const strat = { providerName: 'anthropic' } as CacheStrategy;
    registerCacheStrategy(strat);
    expect(getDefaultCacheStrategy('ANTHROPIC')).toBe(strat);
  });
});

// ─── 4. Property ──────────────────────────────────────────────────

describe('strategyRegistry — property', () => {
  it('lookup ALWAYS returns a non-null strategy (NoOp fallback invariant)', () => {
    // Try a bunch of weird inputs
    const inputs = ['', 'foo', 'foo:bar', '*', 'WILDCARD', 'anthropic-internal-v2'];
    for (const name of inputs) {
      const s = getDefaultCacheStrategy(name);
      expect(s).toBeDefined();
      expect(s.providerName).toBeTypeOf('string');
    }
  });

  it("NoOp's capabilities.enabled is always false (it's a no-op)", () => {
    const noop = new NoOpCacheStrategy();
    expect(noop.capabilities.enabled).toBe(false);
    expect(noop.capabilities.maxMarkers).toBe(0);
  });
});

// ─── 5. Security ──────────────────────────────────────────────────

describe('strategyRegistry — security', () => {
  it('NoOp returns request unchanged (no mutation, no fields added)', async () => {
    const noop = new NoOpCacheStrategy();
    const req = { messages: [], model: 'mock' } as never;
    const result = await noop.prepareRequest(req, [], {
      iteration: 1,
      iterationsRemaining: 4,
      recentHitRate: undefined,
      cachingDisabled: false,
    });
    expect(result.request).toBe(req); // same reference
    expect(result.markersApplied).toEqual([]);
  });
});

// ─── 6. Performance ───────────────────────────────────────────────

describe('strategyRegistry — performance', () => {
  it(
    'lookup cost stays flat as lookups pile up (Map is O(1))',
    { timeout: 30_000, retry: 2 },
    async () => {
      const strat = { providerName: 'foo' } as CacheStrategy;
      registerCacheStrategy(strat);
      const look = (times: number): void => {
        for (let i = 0; i < times; i++) getDefaultCacheStrategy('foo');
      };
      await expectScalesLinearly({
        small: () => look(1_000),
        large: () => look(10_000),
        scale: 10,
        why: 'registry lookup must stay a Map probe',
      });
    },
  );
});

// ─── 7. ROI ───────────────────────────────────────────────────────

describe('strategyRegistry — ROI', () => {
  it("end-to-end: NoOp is the default; consumers get caching they didn't opt out of without breaking existing agents", () => {
    // The whole point of the wildcard NoOp default is that v2.5
    // agents (with no cache config) keep working unchanged. Verify
    // by looking up an arbitrary provider name that has no specific
    // strategy registered and seeing that we get a strategy that
    // does nothing harmful.
    const strategy = getDefaultCacheStrategy('legacy-internal-provider-x');
    expect(strategy.capabilities.enabled).toBe(false);
    expect(strategy.providerName).toBe('*'); // wildcard match
  });

  it('extractMetrics on NoOp is NOT-APPLICABLE — never a false zero', () => {
    // The NoOp stands in for providers with no cache reporting at all, so the
    // honest answer is "this question does not apply here", with its reason.
    // `undefined` used to mean the same thing by convention, and a convention
    // is exactly what the recorder folded into a 0 default.
    const noop = new NoOpCacheStrategy();
    for (const usage of [{ input: 100, output: 0 }, undefined]) {
      const c = noop.extractMetrics(usage);
      expect(c.kind).toBe('not-applicable');
      expect(c.kind === 'not-applicable' && c.evidence).toMatch(/no cache reporting/);
    }
  });
});
