/**
 * computeDecayFactor — 5-pattern tests.
 *
 * The function is pure: same inputs always give same output. Tests verify
 * the mathematical properties of the decay model:
 *   - exponential decay over time (half at half-life)
 *   - multiplicative boost per access (capped)
 *   - identity when no policy present
 *   - composition with access term
 */
import { describe, expect, it } from 'vitest';
import { computeDecayFactor, computeDecayFactors } from '../../../src/memory/entry/decay';
import type { DecayPolicy, MemoryEntry } from '../../../src/memory/entry';

const NOW = 1_000_000_000_000; // fixed reference time to keep tests deterministic

function entry(
  fields: Partial<Pick<MemoryEntry, 'lastAccessedAt' | 'accessCount' | 'decayPolicy'>> = {},
): Pick<MemoryEntry, 'lastAccessedAt' | 'accessCount' | 'decayPolicy'> {
  return {
    lastAccessedAt: NOW,
    accessCount: 0,
    ...fields,
  };
}

// ── Unit ────────────────────────────────────────────────────

describe('computeDecayFactor — unit', () => {
  it('returns 1.0 when no policy is present on entry or passed in', () => {
    expect(computeDecayFactor(entry(), NOW)).toBe(1);
  });

  it('returns 1.0 at age 0 with no access boost', () => {
    const policy: DecayPolicy = { halfLifeMs: 1000, accessBoost: 1.0 };
    expect(computeDecayFactor(entry(), NOW, policy)).toBe(1);
  });

  it('halves relevance at one half-life', () => {
    const policy: DecayPolicy = { halfLifeMs: 1000, accessBoost: 1.0 };
    const e = entry({ lastAccessedAt: NOW - 1000 });
    expect(computeDecayFactor(e, NOW, policy)).toBeCloseTo(0.5, 6);
  });

  it('quarter relevance at two half-lives', () => {
    const policy: DecayPolicy = { halfLifeMs: 1000, accessBoost: 1.0 };
    const e = entry({ lastAccessedAt: NOW - 2000 });
    expect(computeDecayFactor(e, NOW, policy)).toBeCloseTo(0.25, 6);
  });

  it('access boost multiplies relevance above 1.0', () => {
    const policy: DecayPolicy = { halfLifeMs: 1000, accessBoost: 1.2 };
    const e = entry({ accessCount: 3 });
    // No age penalty (fresh); accessBoost^3 = 1.728
    expect(computeDecayFactor(e, NOW, policy)).toBeCloseTo(1.728, 6);
  });

  it('time decay and access boost compose multiplicatively', () => {
    const policy: DecayPolicy = { halfLifeMs: 1000, accessBoost: 2.0 };
    const e = entry({ lastAccessedAt: NOW - 1000, accessCount: 1 });
    // timeFactor = 0.5, accessFactor = 2 → 1.0
    expect(computeDecayFactor(e, NOW, policy)).toBeCloseTo(1, 6);
  });
});

// ── Boundary ────────────────────────────────────────────────

describe('computeDecayFactor — boundary', () => {
  it('entry-level policy overrides when no arg policy passed', () => {
    const entryPolicy: DecayPolicy = { halfLifeMs: 1000, accessBoost: 1.0 };
    const e = entry({ lastAccessedAt: NOW - 1000, decayPolicy: entryPolicy });
    expect(computeDecayFactor(e, NOW)).toBeCloseTo(0.5, 6);
  });

  it('explicit policy arg overrides entry-level policy', () => {
    const entryPolicy: DecayPolicy = { halfLifeMs: 1000, accessBoost: 1.0 };
    const argPolicy: DecayPolicy = { halfLifeMs: 500, accessBoost: 1.0 };
    const e = entry({ lastAccessedAt: NOW - 500, decayPolicy: entryPolicy });
    // argPolicy wins — at 500ms with halfLife 500, factor = 0.5
    expect(computeDecayFactor(e, NOW, argPolicy)).toBeCloseTo(0.5, 6);
  });

  it('future lastAccessedAt (clock skew) treated as age 0, not negative', () => {
    const policy: DecayPolicy = { halfLifeMs: 1000, accessBoost: 1.0 };
    const e = entry({ lastAccessedAt: NOW + 5000 });
    expect(computeDecayFactor(e, NOW, policy)).toBe(1);
  });

  it('caps access boost at 10x even for extreme accessCount', () => {
    const policy: DecayPolicy = { halfLifeMs: Number.POSITIVE_INFINITY, accessBoost: 2.0 };
    // 2^100 would overflow to Infinity without the cap
    const e = entry({ accessCount: 100 });
    expect(computeDecayFactor(e, NOW, policy)).toBe(10);
  });
});

// ── Scenario ────────────────────────────────────────────────

describe('computeDecayFactor — scenario', () => {
  it('old-but-heavily-used entry can outscore fresh-untouched entry (as intended)', () => {
    const policy: DecayPolicy = { halfLifeMs: 1000, accessBoost: 1.5 };
    const old = entry({ lastAccessedAt: NOW - 1000, accessCount: 5 }); // 0.5 · 1.5^5 ≈ 3.8
    const fresh = entry({ lastAccessedAt: NOW, accessCount: 0 }); //    1.0
    expect(computeDecayFactor(old, NOW, policy)).toBeGreaterThan(
      computeDecayFactor(fresh, NOW, policy),
    );
  });

  it('after enough age, even heavily-used entry falls below fresh one', () => {
    const policy: DecayPolicy = { halfLifeMs: 1000, accessBoost: 1.5 };
    const ancient = entry({ lastAccessedAt: NOW - 10_000, accessCount: 5 });
    const fresh = entry({ lastAccessedAt: NOW, accessCount: 0 });
    expect(computeDecayFactor(ancient, NOW, policy)).toBeLessThan(
      computeDecayFactor(fresh, NOW, policy),
    );
  });
});

// ── Property ────────────────────────────────────────────────

describe('computeDecayFactor — property', () => {
  it('monotonically non-increasing as age grows (same accessCount)', () => {
    const policy: DecayPolicy = { halfLifeMs: 1000, accessBoost: 1.0 };
    const ages = [0, 100, 500, 1000, 5000, 50_000];
    const factors = ages.map((ageMs) =>
      computeDecayFactor(entry({ lastAccessedAt: NOW - ageMs }), NOW, policy),
    );
    for (let i = 1; i < factors.length; i++) {
      expect(factors[i]).toBeLessThanOrEqual(factors[i - 1]);
    }
  });

  it('always non-negative', () => {
    const policy: DecayPolicy = { halfLifeMs: 1000, accessBoost: 1.5 };
    const cases = [
      entry({ lastAccessedAt: NOW - 1_000_000, accessCount: 0 }),
      entry({ lastAccessedAt: NOW, accessCount: 100 }),
      entry({ lastAccessedAt: NOW + 999, accessCount: 0 }), // future
    ];
    for (const e of cases) {
      expect(computeDecayFactor(e, NOW, policy)).toBeGreaterThanOrEqual(0);
    }
  });

  it('computeDecayFactors preserves input order + equals per-entry calls', () => {
    const policy: DecayPolicy = { halfLifeMs: 1000, accessBoost: 1.0 };
    const entries = [
      entry({ lastAccessedAt: NOW }),
      entry({ lastAccessedAt: NOW - 1000 }),
      entry({ lastAccessedAt: NOW - 2000 }),
    ];
    const batch = computeDecayFactors(entries, NOW, policy);
    const single = entries.map((e) => computeDecayFactor(e, NOW, policy));
    expect(batch).toEqual(single);
  });
});

// ── Security ────────────────────────────────────────────────

describe('computeDecayFactor — security', () => {
  it('malicious huge accessCount cannot produce NaN/Infinity (capped)', () => {
    const policy: DecayPolicy = { halfLifeMs: 1000, accessBoost: 2.0 };
    const e = entry({ accessCount: Number.MAX_SAFE_INTEGER });
    const f = computeDecayFactor(e, NOW, policy);
    expect(Number.isFinite(f)).toBe(true);
    expect(f).toBeLessThanOrEqual(10);
  });

  it('zero halfLifeMs would divide by zero — guard with Infinity factor being 0', () => {
    // Mathematically Math.pow(2, -Infinity) = 0. This pins behavior so
    // consumers passing halfLife 0 get "decay instantly" (rather than NaN).
    const policy: DecayPolicy = { halfLifeMs: 0, accessBoost: 1.0 };
    const e = entry({ lastAccessedAt: NOW - 1 });
    expect(computeDecayFactor(e, NOW, policy)).toBe(0);
  });

  it('halfLifeMs === 0 AND age === 0 returns 1 (not NaN from 0/0)', () => {
    // Edge case: without explicit handling, Math.pow(2, -0/0) = Math.pow(2, NaN) = NaN
    // → corrupts any downstream score. Pinned by DS-reviewer feedback.
    const policy: DecayPolicy = { halfLifeMs: 0, accessBoost: 1.0 };
    const f = computeDecayFactor(entry({ lastAccessedAt: NOW }), NOW, policy);
    expect(Number.isNaN(f)).toBe(false);
    expect(f).toBe(1);
  });

  it('negative or zero accessBoost is clamped to a tiny positive ε (never produces NaN)', () => {
    // Security-reviewer feedback: negative accessBoost could produce NaN for
    // fractional powers, or negative scores for odd-integer powers — either
    // breaks ranking stages. Contract is accessBoost > 0; the clamp hardens.
    const policies: DecayPolicy[] = [
      { halfLifeMs: 1000, accessBoost: 0 },
      { halfLifeMs: 1000, accessBoost: -1 },
      { halfLifeMs: 1000, accessBoost: -0.5 },
    ];
    const e = entry({ lastAccessedAt: NOW, accessCount: 3 });
    for (const p of policies) {
      const f = computeDecayFactor(e, NOW, p);
      expect(Number.isFinite(f)).toBe(true);
      expect(f).toBeGreaterThanOrEqual(0);
    }
  });
});
