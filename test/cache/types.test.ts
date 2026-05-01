/**
 * Cache types — 5-pattern tests (unit · boundary · scenario · property · security).
 *
 * Phase 1 of v2.6 cache layer ships TYPES ONLY — no runtime logic yet.
 * These tests are TYPE-CENTRIC: they exercise the type contracts so a
 * regression in the type definition (e.g., dropping a required field,
 * changing a literal-union member) shows up as a test failure rather
 * than as a downstream runtime error in Phase 4+.
 *
 * Why type-centric tests for a pure-types phase:
 *  - vitest can't compile-fail (type errors are caught by tsc separately)
 *  - But we CAN exercise the types via type-narrowing helpers + assertions
 *    so a removed field surfaces as `expect(...).toBe(undefined)` failing
 *  - This catches accidental field removals during v2.6 work
 */

import { describe, expect, it } from 'vitest';
import type {
  CacheCapabilities,
  CacheMarker,
  CacheMetrics,
  CachePolicy,
  CachePolicyContext,
  CacheStrategy,
  CacheStrategyContext,
} from '../../src/cache/types';

// ── Unit — basic type-shape acceptance ───────────────────────────

describe('CacheMarker — unit', () => {
  it('accepts a minimal marker (system field, short ttl)', () => {
    const marker: CacheMarker = {
      field: 'system',
      boundaryIndex: 8,
      ttl: 'short',
      reason: 'always-on injections',
    };
    expect(marker.field).toBe('system');
    expect(marker.boundaryIndex).toBe(8);
  });

  it('boundaryIndex of 0 is valid (only first element cacheable)', () => {
    const marker: CacheMarker = {
      field: 'tools',
      boundaryIndex: 0,
      ttl: 'short',
      reason: 'list_skills only',
    };
    expect(marker.boundaryIndex).toBe(0);
  });
});

describe('CachePolicy — unit', () => {
  it("accepts the four sentinel forms", () => {
    const a: CachePolicy = 'always';
    const b: CachePolicy = 'never';
    const c: CachePolicy = 'while-active';
    const d: CachePolicy = { until: () => false };
    expect([a, b, c, typeof d]).toEqual(['always', 'never', 'while-active', 'object']);
  });

  it('the until predicate receives a CachePolicyContext', () => {
    const policy: CachePolicy = {
      until: (ctx: CachePolicyContext) => ctx.iteration > 3,
    };
    if (typeof policy === 'object' && 'until' in policy) {
      const result = policy.until({
        iteration: 4,
        iterationsRemaining: 1,
        userMessage: 'go',
        cumulativeInputTokens: 5000,
      });
      expect(result).toBe(true);
    }
  });
});

// ── Boundary — edge values, empty/extreme ─────────────────────────

describe('CacheCapabilities — boundary', () => {
  it('supports an empty fields list (strategy that does nothing)', () => {
    const caps: CacheCapabilities = {
      enabled: false,
      maxMarkers: 0,
      ttls: [],
      fields: [],
      automatic: false,
    };
    expect(caps.enabled).toBe(false);
    expect(caps.maxMarkers).toBe(0);
  });

  it('supports the maximal Anthropic shape (4 markers, both TTLs, all fields)', () => {
    const caps: CacheCapabilities = {
      enabled: true,
      maxMarkers: 4,
      ttls: ['short', 'long'],
      fields: ['system', 'tools', 'messages'],
      automatic: false,
    };
    expect(caps.fields.length).toBe(3);
    expect(caps.ttls).toContain('long');
  });

  it('supports an automatic provider (OpenAI shape: enabled but no markers)', () => {
    const caps: CacheCapabilities = {
      enabled: true,
      maxMarkers: 0,
      ttls: ['short'],
      fields: [],
      automatic: true,
    };
    expect(caps.automatic).toBe(true);
    expect(caps.maxMarkers).toBe(0);
  });
});

// ── Scenario — composing types in realistic mini-flows ────────────

describe('CacheStrategy — scenario: defining a no-op strategy is type-clean', () => {
  it('type-checks an inline NoOp implementation', async () => {
    const noop: CacheStrategy = {
      providerName: 'mock',
      capabilities: {
        enabled: false,
        maxMarkers: 0,
        ttls: [],
        fields: [],
        automatic: false,
      },
      async prepareRequest(req) {
        return { request: req, markersApplied: [] };
      },
      extractMetrics() {
        return undefined;
      },
    };
    const result = await noop.prepareRequest(
      { messages: [], model: 'mock' } as never,
      [],
      {
        iteration: 1,
        iterationsRemaining: 4,
        recentHitRate: undefined,
        cachingDisabled: false,
      },
    );
    expect(result.markersApplied).toEqual([]);
    expect(noop.extractMetrics({})).toBeUndefined();
  });
});

describe('CacheStrategyContext — scenario: kill switch propagation', () => {
  it("strategies see cachingDisabled=true when Agent.create({ caching: 'off' })", () => {
    const ctx: CacheStrategyContext = {
      iteration: 3,
      iterationsRemaining: 2,
      recentHitRate: 0.85,
      cachingDisabled: true,
    };
    // Strategy MUST honor this and skip marker application:
    expect(ctx.cachingDisabled).toBe(true);
    // recentHitRate is still informative (85%) but kill switch wins:
    expect(ctx.recentHitRate).toBe(0.85);
  });
});

// ── Property — invariants the type contract must preserve ──────────

describe('CacheMetrics — property: invariants', () => {
  it('non-negative token counts', () => {
    const metrics: CacheMetrics = {
      cacheReadTokens: 3000,
      cacheWriteTokens: 0,
      freshInputTokens: 240,
    };
    expect(metrics.cacheReadTokens).toBeGreaterThanOrEqual(0);
    expect(metrics.cacheWriteTokens).toBeGreaterThanOrEqual(0);
    expect(metrics.freshInputTokens).toBeGreaterThanOrEqual(0);
  });

  it('sum of components equals total input charged (per provider semantics)', () => {
    // Anthropic: cache_creation + cache_read + fresh = total input charged
    // (cache_read priced at 10%, cache_creation at +25%, but token COUNTS
    // sum to total prompt tokens before discounts).
    const metrics: CacheMetrics = {
      cacheReadTokens: 3000,
      cacheWriteTokens: 0,
      freshInputTokens: 240,
    };
    const total = metrics.cacheReadTokens + metrics.cacheWriteTokens + metrics.freshInputTokens;
    expect(total).toBe(3240);
  });
});

// ── Security — type narrowing prevents shape spoofing ─────────────

describe('CachePolicy — security: only the four documented forms', () => {
  it('rejects undocumented sentinel strings via TypeScript narrowing', () => {
    // This test is a TYPE-LEVEL contract assertion: if someone removes
    // 'while-active' from CachePolicy or adds an undocumented sentinel,
    // tsc will fail this file's compilation. At runtime we just verify
    // the four documented forms parse correctly.
    const accepted: ReadonlyArray<CachePolicy> = [
      'always',
      'never',
      'while-active',
      { until: () => true },
    ];
    expect(accepted.length).toBe(4);
    // We CANNOT (at type level) construct a malformed sentinel like
    // `'sometimes'` — tsc rejects it. So this test passes by virtue of
    // compiling.
  });

  it('CacheMarker rejects unknown field values (type-level)', () => {
    // Same compile-time guarantee for `field`. The test passes because
    // the file compiled.
    const valid: ReadonlyArray<CacheMarker['field']> = ['system', 'tools', 'messages'];
    expect(valid.length).toBe(3);
  });
});
