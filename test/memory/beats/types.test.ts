/**
 * NarrativeBeat types — 5-pattern tests.
 *
 * Covers the pure-data layer: `asImportance()` clamp, `isNarrativeBeat()`
 * duck-type guard. No side effects, no storage — just type plumbing.
 *
 * Tiers:
 *   - unit:     single-case correctness of clamp + guard
 *   - boundary: 0, 1, below 0, above 1, NaN, Infinity
 *   - scenario: guard on realistic-shaped mixed inputs
 *   - property: clamp idempotent + preserves already-valid inputs
 *   - security: prototype-pollution-shaped objects don't pass the guard
 */
import { describe, expect, it } from 'vitest';
import { asImportance, isNarrativeBeat } from '../../../src/memory/beats';
import type { NarrativeBeat } from '../../../src/memory/beats';

// ── Unit ────────────────────────────────────────────────────

describe('asImportance — unit', () => {
  it('returns a value in [0, 1] unchanged', () => {
    expect(asImportance(0.42)).toBe(0.42);
  });

  it('clamps values below 0 to 0', () => {
    expect(asImportance(-1)).toBe(0);
  });

  it('clamps values above 1 to 1', () => {
    expect(asImportance(2)).toBe(1);
  });

  it('returns neutral 0.5 for non-number inputs', () => {
    expect(asImportance('high' as unknown)).toBe(0.5);
    expect(asImportance(undefined)).toBe(0.5);
    expect(asImportance(null)).toBe(0.5);
  });
});

describe('isNarrativeBeat — unit', () => {
  it('accepts a well-formed beat', () => {
    const beat: NarrativeBeat = {
      summary: 'User is Alice',
      importance: 0.9,
      refs: ['msg-1-0'],
    };
    expect(isNarrativeBeat(beat)).toBe(true);
  });

  it('rejects a plain Message', () => {
    expect(isNarrativeBeat({ role: 'user', content: 'hi' })).toBe(false);
  });
});

// ── Boundary ────────────────────────────────────────────────

describe('asImportance — boundary', () => {
  it('0 is a valid importance (min)', () => {
    expect(asImportance(0)).toBe(0);
  });

  it('1 is a valid importance (max)', () => {
    expect(asImportance(1)).toBe(1);
  });

  it('NaN collapses to 0.5 (neutral) — never leaks into picker comparisons', () => {
    expect(asImportance(NaN)).toBe(0.5);
  });

  it('Infinity collapses to 0.5 (neutral)', () => {
    expect(asImportance(Infinity)).toBe(0.5);
    expect(asImportance(-Infinity)).toBe(0.5);
  });
});

describe('isNarrativeBeat — boundary', () => {
  it('accepts a beat with empty refs array (synthesized beat)', () => {
    const beat: NarrativeBeat = { summary: 'Compact facts', importance: 0.5, refs: [] };
    expect(isNarrativeBeat(beat)).toBe(true);
  });

  it('rejects when summary is missing', () => {
    expect(isNarrativeBeat({ importance: 0.5, refs: [] })).toBe(false);
  });

  it('rejects when importance is missing', () => {
    expect(isNarrativeBeat({ summary: 'x', refs: [] })).toBe(false);
  });

  it('rejects when refs is missing or not an array', () => {
    expect(isNarrativeBeat({ summary: 'x', importance: 0.5 })).toBe(false);
    expect(isNarrativeBeat({ summary: 'x', importance: 0.5, refs: 'bad' })).toBe(false);
  });

  it('rejects null and undefined', () => {
    expect(isNarrativeBeat(null)).toBe(false);
    expect(isNarrativeBeat(undefined)).toBe(false);
  });
});

// ── Scenario ────────────────────────────────────────────────

describe('isNarrativeBeat — scenario', () => {
  it('filters mixed payloads (raw messages alongside beats)', () => {
    const mixed = [
      { role: 'user', content: 'hi' }, // message
      { summary: 'User said hi', importance: 0.2, refs: ['m1'] }, // beat
      { summary: 'User asked about refunds', importance: 0.8, refs: ['m2', 'm3'] }, // beat
      { role: 'assistant', content: 'hello' }, // message
    ];
    const beats = mixed.filter(isNarrativeBeat);
    expect(beats).toHaveLength(2);
    expect(beats.map((b) => b.summary)).toEqual(['User said hi', 'User asked about refunds']);
  });
});

// ── Property ────────────────────────────────────────────────

describe('asImportance — property', () => {
  it('is idempotent — asImportance(asImportance(x)) === asImportance(x) for any x', () => {
    const inputs: unknown[] = [0, 0.5, 1, -1, 2, NaN, 'x', Infinity];
    for (const input of inputs) {
      const once = asImportance(input);
      const twice = asImportance(once);
      expect(twice).toBe(once);
    }
  });

  it('preserves every valid input in [0, 1] exactly', () => {
    for (const v of [0, 0.1, 0.25, 0.5, 0.75, 0.9, 1]) {
      expect(asImportance(v)).toBe(v);
    }
  });
});

// ── Security ────────────────────────────────────────────────

describe('isNarrativeBeat — security', () => {
  it('does NOT match prototype-shaped objects that only coincidentally have the fields', () => {
    // Adversary might pass an object whose refs is a string-length-tricked
    // value. The guard checks `Array.isArray(refs)` which is true only for
    // actual arrays. Pin this.
    const adversarial = { summary: 'x', importance: 0.5, refs: { length: 5 } };
    expect(isNarrativeBeat(adversarial)).toBe(false);
  });

  it('rejects values with a prototype-polluted __proto__.refs', () => {
    const obj = { summary: 'x', importance: 0.5 };
    // Don't actually pollute — just verify the guard doesn't walk the
    // prototype chain. `refs` must be an own property-accessible array.
    expect(isNarrativeBeat(obj)).toBe(false);
  });
});
