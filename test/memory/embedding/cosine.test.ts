/**
 * cosineSimilarity — 5-pattern tests.
 *
 * Tiers:
 *   - unit:     identical, orthogonal, opposite vectors
 *   - boundary: zero magnitude, empty arrays, single-dimension
 *   - scenario: realistic similarity ordering (close > far)
 *   - property: symmetric, range bounded to [-1, 1]
 *   - security: length mismatch throws (fail-loud on bad state)
 */
import { describe, expect, it } from 'vitest';
import { cosineSimilarity } from '../../../src/memory/embedding/cosine';

// ── Unit ────────────────────────────────────────────────────

describe('cosineSimilarity — unit', () => {
  it('identical vectors → 1', () => {
    expect(cosineSimilarity([1, 2, 3], [1, 2, 3])).toBeCloseTo(1);
  });

  it('opposite vectors → -1', () => {
    expect(cosineSimilarity([1, 2, 3], [-1, -2, -3])).toBeCloseTo(-1);
  });

  it('orthogonal vectors → 0', () => {
    expect(cosineSimilarity([1, 0], [0, 1])).toBe(0);
  });

  it("scaled vectors still compare equal (magnitude doesn't matter for cosine)", () => {
    expect(cosineSimilarity([1, 2, 3], [2, 4, 6])).toBeCloseTo(1);
    expect(cosineSimilarity([1, 2, 3], [100, 200, 300])).toBeCloseTo(1);
  });
});

// ── Boundary ────────────────────────────────────────────────

describe('cosineSimilarity — boundary', () => {
  it('zero magnitude vector on either side returns 0 (never NaN)', () => {
    expect(cosineSimilarity([0, 0, 0], [1, 2, 3])).toBe(0);
    expect(cosineSimilarity([1, 2, 3], [0, 0, 0])).toBe(0);
    expect(cosineSimilarity([0, 0], [0, 0])).toBe(0);
  });

  it('empty arrays return 0', () => {
    expect(cosineSimilarity([], [])).toBe(0);
  });

  it('single dimension works', () => {
    expect(cosineSimilarity([5], [3])).toBeCloseTo(1); // same sign
    expect(cosineSimilarity([5], [-3])).toBeCloseTo(-1); // opposite sign
  });
});

// ── Scenario ────────────────────────────────────────────────

describe('cosineSimilarity — scenario', () => {
  it('similar direction scores higher than dissimilar direction', () => {
    const query = [1, 1, 0];
    const close = [1, 1, 0.1]; // almost same direction
    const far = [1, -1, 0]; // perpendicular-ish
    const simClose = cosineSimilarity(query, close);
    const simFar = cosineSimilarity(query, far);
    expect(simClose).toBeGreaterThan(simFar);
  });

  it('ranking three candidates by similarity produces expected order', () => {
    const query = [1, 0, 0];
    const candidates = [
      { id: 'opposite', vec: [-1, 0, 0] },
      { id: 'orthogonal', vec: [0, 1, 0] },
      { id: 'matching', vec: [1, 0, 0] },
    ];
    const ranked = candidates
      .map((c) => ({ id: c.id, score: cosineSimilarity(query, c.vec) }))
      .sort((a, b) => b.score - a.score);
    expect(ranked.map((r) => r.id)).toEqual(['matching', 'orthogonal', 'opposite']);
  });
});

// ── Property ────────────────────────────────────────────────

describe('cosineSimilarity — property', () => {
  it('is symmetric: cos(a, b) === cos(b, a)', () => {
    const pairs: Array<[number[], number[]]> = [
      [
        [1, 2, 3],
        [4, 5, 6],
      ],
      [
        [0.1, 0.2],
        [0.9, 0.8],
      ],
      [
        [-1, 2, -3],
        [3, -2, 1],
      ],
    ];
    for (const [a, b] of pairs) {
      expect(cosineSimilarity(a, b)).toBeCloseTo(cosineSimilarity(b, a));
    }
  });

  it('always returns a value in [-1, 1]', () => {
    const vectors = [
      [1, 2, 3],
      [-5, -5, 0],
      [100, 0.001, -50],
      [1, 0, 0, 0, 0],
      [0.5, 0.5, 0.5, 0.5, 0.5],
    ];
    for (let i = 0; i < vectors.length; i++) {
      for (let j = 0; j < vectors.length; j++) {
        if (vectors[i].length !== vectors[j].length) continue;
        const s = cosineSimilarity(vectors[i], vectors[j]);
        expect(s).toBeGreaterThanOrEqual(-1);
        expect(s).toBeLessThanOrEqual(1);
      }
    }
  });
});

// ── Security ────────────────────────────────────────────────

describe('cosineSimilarity — security', () => {
  it('length mismatch throws (indicates mixed-embedder bug — fail loud)', () => {
    expect(() => cosineSimilarity([1, 2, 3], [1, 2])).toThrow(/length mismatch/);
  });

  it('error message mentions the expected fix (same embedder)', () => {
    try {
      cosineSimilarity([1, 2, 3], [1, 2, 3, 4]);
    } catch (err) {
      expect((err as Error).message).toContain('SAME embedder');
    }
  });
});
