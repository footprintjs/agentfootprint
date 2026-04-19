/**
 * Fact types — 5-pattern tests.
 *
 * Covers the pure-data layer: `factId` / `isFactId` / `isFact` / `asConfidence`.
 *
 * Tiers:
 *   - unit:     basic correctness of each helper
 *   - boundary: empty strings, edge values, malformed inputs
 *   - scenario: mixed-payload filtering (facts vs beats vs messages)
 *   - property: asConfidence idempotent; factId/isFactId round-trip
 *   - security: prototype-shaped objects rejected; asConfidence rejects NaN/Infinity
 */
import { describe, expect, it } from 'vitest';
import { asConfidence, factId, isFact, isFactId } from '../../../src/memory/facts';
import type { Fact } from '../../../src/memory/facts';

// ── Unit ────────────────────────────────────────────────────

describe('factId — unit', () => {
  it('prefixes the key with "fact:"', () => {
    expect(factId('user.name')).toBe('fact:user.name');
  });

  it('preserves dotted paths', () => {
    expect(factId('user.preferences.color')).toBe('fact:user.preferences.color');
  });
});

describe('isFactId — unit', () => {
  it('true for ids produced by factId', () => {
    expect(isFactId(factId('user.name'))).toBe(true);
  });

  it('false for beat-style ids', () => {
    expect(isFactId('beat-1-0')).toBe(false);
  });

  it('false for message-style ids', () => {
    expect(isFactId('msg-1-0')).toBe(false);
  });
});

describe('isFact — unit', () => {
  it('accepts a well-formed fact', () => {
    const fact: Fact = { key: 'user.name', value: 'Alice' };
    expect(isFact(fact)).toBe(true);
  });

  it('rejects a plain Message', () => {
    expect(isFact({ role: 'user', content: 'hi' })).toBe(false);
  });

  it('rejects a NarrativeBeat shape', () => {
    expect(isFact({ summary: 'x', importance: 0.5, refs: [] })).toBe(false);
  });
});

describe('asConfidence — unit', () => {
  it('returns value in [0, 1] unchanged', () => {
    expect(asConfidence(0.42)).toBe(0.42);
  });

  it('clamps above 1 to 1', () => {
    expect(asConfidence(2)).toBe(1);
  });

  it('clamps below 0 to 0', () => {
    expect(asConfidence(-0.5)).toBe(0);
  });

  it('non-number → neutral 0.5', () => {
    expect(asConfidence('high')).toBe(0.5);
    expect(asConfidence(undefined)).toBe(0.5);
  });
});

// ── Boundary ────────────────────────────────────────────────

describe('isFact — boundary', () => {
  it('accepts a fact with empty-string value (explicit unknown)', () => {
    expect(isFact({ key: 'user.name', value: '' })).toBe(true);
  });

  it('rejects a fact with empty key', () => {
    expect(isFact({ key: '', value: 'x' })).toBe(false);
  });

  it('rejects when value field is missing', () => {
    expect(isFact({ key: 'user.name' })).toBe(false);
  });

  it('rejects null and undefined', () => {
    expect(isFact(null)).toBe(false);
    expect(isFact(undefined)).toBe(false);
  });
});

describe('asConfidence — boundary', () => {
  it('0 and 1 are preserved', () => {
    expect(asConfidence(0)).toBe(0);
    expect(asConfidence(1)).toBe(1);
  });

  it('NaN → 0.5 (neutral, never poisons picker)', () => {
    expect(asConfidence(NaN)).toBe(0.5);
  });

  it('Infinity → 0.5', () => {
    expect(asConfidence(Infinity)).toBe(0.5);
    expect(asConfidence(-Infinity)).toBe(0.5);
  });
});

describe('factId — boundary', () => {
  it('empty key still produces a valid fact-id string', () => {
    expect(factId('')).toBe('fact:');
    expect(isFactId('fact:')).toBe(true);
  });
});

// ── Scenario ────────────────────────────────────────────────

describe('isFact — scenario', () => {
  it('filters mixed-payload array (facts + beats + messages)', () => {
    const mixed = [
      { role: 'user', content: 'hi' }, // message
      { summary: 's', importance: 0.5, refs: [] }, // beat
      { key: 'user.name', value: 'Alice', confidence: 0.9 }, // fact
      { key: 'user.email', value: 'a@b.c' }, // fact
      'not an object',
    ];
    const facts = mixed.filter(isFact);
    expect(facts).toHaveLength(2);
    expect(facts.map((f) => f.key)).toEqual(['user.name', 'user.email']);
  });
});

// ── Property ────────────────────────────────────────────────

describe('asConfidence — property', () => {
  it('is idempotent — asConfidence(asConfidence(x)) === asConfidence(x)', () => {
    const inputs: unknown[] = [0, 0.5, 1, -1, 2, NaN, 'x', Infinity, null, undefined];
    for (const input of inputs) {
      const once = asConfidence(input);
      const twice = asConfidence(once);
      expect(twice).toBe(once);
    }
  });

  it('preserves every valid value in [0, 1] exactly', () => {
    for (const v of [0, 0.1, 0.25, 0.5, 0.75, 0.9, 1]) {
      expect(asConfidence(v)).toBe(v);
    }
  });
});

describe('factId / isFactId — property', () => {
  it('round-trips — isFactId(factId(k)) is always true', () => {
    for (const k of ['user.name', 'x', 'a.b.c.d.e.f', 'task.ORD-123.status']) {
      expect(isFactId(factId(k))).toBe(true);
    }
  });
});

// ── Security ────────────────────────────────────────────────

describe('isFact — security', () => {
  it('rejects adversarial shapes that only coincidentally have fields', () => {
    // Number value should still be a valid fact
    expect(isFact({ key: 'user.age', value: 42 })).toBe(true);
    // But a shape missing value is rejected
    expect(isFact({ key: 'user.name', length: 5 })).toBe(false);
  });

  it('rejects primitives masquerading as facts', () => {
    expect(isFact('user.name=Alice')).toBe(false);
    expect(isFact(42)).toBe(false);
  });
});
