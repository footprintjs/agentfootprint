/**
 * influence-core signals — unit / boundary / property / security tiers.
 *
 * Vector-level scorers are tested against HAND-COMPUTED values (the
 * paper equations done by hand), not against the implementation.
 */
import { describe, expect, it } from 'vitest';
import { mockEmbedder } from '../../../src/memory/embedding/mockEmbedder';
import {
  adaptWeights,
  averageRelevancy,
  compositeScore,
  DEFAULT_INFLUENCE_WEIGHTS,
  finalAnswerSimilarity,
  persistence,
  scoreInfluence,
  structuralProximity,
  type InfluenceWeights,
} from '../../../src/lib/influence-core';

// ── Unit: the four signals against hand-computed values ─────────────

describe('finalAnswerSimilarity (Eq. 1)', () => {
  it('is cosine: identical direction → ~1, orthogonal → 0, opposite → ~-1', () => {
    expect(finalAnswerSimilarity([1, 2], [2, 4])).toBeCloseTo(1, 12);
    expect(finalAnswerSimilarity([1, 0], [0, 1])).toBe(0);
    expect(finalAnswerSimilarity([1, 0], [-1, 0])).toBeCloseTo(-1, 12);
  });
});

describe('averageRelevancy (Eq. 2)', () => {
  it('means the per-ancestor cosines: sims [1, 0] → 0.5', () => {
    expect(
      averageRelevancy(
        [1, 0],
        [
          [1, 0],
          [0, 1],
        ],
      ),
    ).toBeCloseTo(0.5, 12);
  });

  it('no ancestors → structurally 0', () => {
    expect(averageRelevancy([1, 0], [])).toBe(0);
  });
});

describe('persistence (Eq. 3)', () => {
  it('fraction above threshold: sims [1, 0] at T=0.5 → 0.5', () => {
    expect(
      persistence(
        [1, 0],
        [
          [1, 0],
          [0, 1],
        ],
        0.5,
      ),
    ).toBeCloseTo(0.5, 12);
  });

  it('threshold is STRICT (>) — a similarity exactly at T does not count', () => {
    // cos([1,0],[1,1]) = 1/√2 exactly.
    const sim = finalAnswerSimilarity([1, 0], [1, 1]);
    expect(persistence([1, 0], [[1, 1]], sim)).toBe(0);
    expect(persistence([1, 0], [[1, 1]], sim - 1e-12)).toBe(1);
  });

  it('no ancestors → structurally 0', () => {
    expect(persistence([1, 0], [], 0.3)).toBe(0);
  });

  it('default threshold is the paper default 0.30', () => {
    // sim = 1/√2 ≈ 0.707 > 0.30 → counts under the default.
    expect(persistence([1, 0], [[1, 1]])).toBe(1);
  });
});

describe('structuralProximity (Eq. 4)', () => {
  it('1/(1+n): direct evidence → 1, deeper → smaller', () => {
    expect(structuralProximity(0)).toBe(1);
    expect(structuralProximity(1)).toBe(0.5);
    expect(structuralProximity(3)).toBe(0.25);
  });

  it('throws on negative or fractional counts (fail-loud)', () => {
    expect(() => structuralProximity(-1)).toThrow(/non-negative integer/);
    expect(() => structuralProximity(1.5)).toThrow(/non-negative integer/);
  });
});

// ── Unit: adaptive redistribution + composite ───────────────────────

describe('adaptWeights (Eq. 6)', () => {
  it('defaults with no ancestors → α′=0.80, δ′=0.20, β′=γ′=0, adapted', () => {
    const { weights, adapted } = adaptWeights(DEFAULT_INFLUENCE_WEIGHTS, 0);
    expect(adapted).toBe(true);
    expect(weights.fa).toBeCloseTo(0.8, 12);
    expect(weights.depth).toBeCloseTo(0.2, 12);
    expect(weights.avg).toBe(0);
    expect(weights.persist).toBe(0);
  });

  it('with ancestors → weights unchanged, not adapted', () => {
    const { weights, adapted } = adaptWeights(DEFAULT_INFLUENCE_WEIGHTS, 3);
    expect(adapted).toBe(false);
    expect(weights).toBe(DEFAULT_INFLUENCE_WEIGHTS);
  });

  it('preserves the fa:depth ratio and the total weight mass (property, custom priors)', () => {
    const priors: InfluenceWeights = { fa: 0.5, avg: 0.2, persist: 0.25, depth: 0.05 };
    const { weights } = adaptWeights(priors, 0);
    expect(weights.fa / weights.depth).toBeCloseTo(priors.fa / priors.depth, 12);
    expect(weights.fa + weights.depth).toBeCloseTo(
      priors.fa + priors.avg + priors.persist + priors.depth,
      12,
    );
  });

  it('degenerate fa+depth=0 → unchanged, not adapted (no defined ratio to preserve)', () => {
    const priors: InfluenceWeights = { fa: 0, avg: 0.7, persist: 0.3, depth: 0 };
    const { weights, adapted } = adaptWeights(priors, 0);
    expect(adapted).toBe(false);
    expect(weights).toBe(priors);
  });

  it('nothing to redistribute (avg+persist=0) → values unchanged, not adapted', () => {
    const priors: InfluenceWeights = { fa: 0.9, avg: 0, persist: 0, depth: 0.1 };
    const { weights, adapted } = adaptWeights(priors, 0);
    expect(adapted).toBe(false);
    expect(weights.fa).toBeCloseTo(0.9, 12);
    expect(weights.depth).toBeCloseTo(0.1, 12);
  });
});

describe('compositeScore (Eq. 5)', () => {
  it('weighted sum, hand-computed', () => {
    const s = compositeScore(
      { fa: 0.5, avg: 0.4, persist: 0.8, depth: 0.25 },
      DEFAULT_INFLUENCE_WEIGHTS,
    );
    // 0.4·0.5 + 0.3·0.4 + 0.2·0.8 + 0.1·0.25 = 0.2 + 0.12 + 0.16 + 0.025
    expect(s).toBeCloseTo(0.505, 12);
  });

  it('is monotonic in fa for fixed other signals (property)', () => {
    let prev = -Infinity;
    for (let fa = -1; fa <= 1; fa += 0.25) {
      const s = compositeScore({ fa, avg: 0.3, persist: 0.5, depth: 1 }, DEFAULT_INFLUENCE_WEIGHTS);
      expect(s).toBeGreaterThan(prev);
      prev = s;
    }
  });
});

// ── scoreInfluence orchestration ────────────────────────────────────

describe('scoreInfluence — orchestration', () => {
  const finalAnswerText = 'the quick brown fox jumps over the lazy dog';

  it('ranks descending and keeps input order on ties (stable)', async () => {
    const scored = await scoreInfluence({
      evidence: [
        { id: 'first', text: 'identical evidence text', ancestorTexts: [] },
        { id: 'second', text: 'identical evidence text', ancestorTexts: [] },
      ],
      finalAnswerText,
      embedder: mockEmbedder(),
    });
    expect(scored[0].score).toBe(scored[1].score);
    expect(scored.map((s) => s.id)).toEqual(['first', 'second']);
  });

  it('embeds each DISTINCT text once (deduplicated batch)', async () => {
    const embedded: string[] = [];
    const inner = mockEmbedder();
    const counting = {
      dimensions: inner.dimensions,
      embed: async (args: { text: string }) => {
        embedded.push(args.text);
        return inner.embed(args);
      },
    };
    await scoreInfluence({
      evidence: [
        // Evidence text repeats; one ancestor IS the final answer text.
        { id: 'a', text: 'shared text', ancestorTexts: [finalAnswerText] },
        { id: 'b', text: 'shared text', ancestorTexts: ['unique ancestor'] },
      ],
      finalAnswerText,
      embedder: counting,
    });
    // Distinct texts: finalAnswer, 'shared text', 'unique ancestor' = 3.
    expect(embedded.length).toBe(3);
    expect(new Set(embedded).size).toBe(3);
  });

  it('uses embedBatch when the embedder provides one', async () => {
    let batchCalls = 0;
    let singleCalls = 0;
    const inner = mockEmbedder();
    const batching = {
      dimensions: inner.dimensions,
      embed: async (args: { text: string }) => {
        singleCalls += 1;
        return inner.embed(args);
      },
      embedBatch: async (args: { texts: readonly string[] }) => {
        batchCalls += 1;
        return inner.embedBatch({ texts: args.texts });
      },
    };
    await scoreInfluence({
      evidence: [{ id: 'a', text: 'tool result', ancestorTexts: ['a step'] }],
      finalAnswerText,
      embedder: batching,
    });
    expect(batchCalls).toBe(1);
    expect(singleCalls).toBe(0);
  });

  it('empty evidence → empty ranking (still embeds nothing beyond the answer)', async () => {
    const scored = await scoreInfluence({
      evidence: [],
      finalAnswerText,
      embedder: mockEmbedder(),
    });
    expect(scored).toEqual([]);
  });

  // ── Security / fail-loud tier ──

  it('throws on duplicate evidence ids', async () => {
    await expect(
      scoreInfluence({
        evidence: [
          { id: 'dup', text: 'x', ancestorTexts: [] },
          { id: 'dup', text: 'y', ancestorTexts: [] },
        ],
        finalAnswerText,
        embedder: mockEmbedder(),
      }),
    ).rejects.toThrow(/duplicate evidence id 'dup'/);
  });

  it('throws on negative, non-finite, or all-zero weights', async () => {
    const base = {
      evidence: [{ id: 'a', text: 'x', ancestorTexts: [] }],
      finalAnswerText,
      embedder: mockEmbedder(),
    };
    await expect(
      scoreInfluence({ ...base, weights: { fa: -0.1, avg: 0.5, persist: 0.4, depth: 0.2 } }),
    ).rejects.toThrow(/finite non-negative/);
    await expect(
      scoreInfluence({ ...base, weights: { fa: NaN, avg: 0.5, persist: 0.4, depth: 0.2 } }),
    ).rejects.toThrow(/finite non-negative/);
    await expect(
      scoreInfluence({ ...base, weights: { fa: 0, avg: 0, persist: 0, depth: 0 } }),
    ).rejects.toThrow(/all weights are zero/);
  });

  // ── Property tier ──

  it('signals stay in their documented ranges for arbitrary texts (property)', async () => {
    const texts = [
      'alpha beta gamma',
      'zzzzzz',
      '!@#$%^&*()',
      '',
      'a',
      'the quick brown fox',
      '12345 67890',
      'mixed CASE and Punctuation!',
    ];
    const evidence = texts.map((text, i) => ({
      id: `e${i}`,
      text,
      ancestorTexts: texts.slice(0, i % 4),
    }));
    const scored = await scoreInfluence({
      evidence,
      finalAnswerText: 'some final answer about foxes and numbers',
      embedder: mockEmbedder(),
    });
    for (const s of scored) {
      expect(s.signals.fa).toBeGreaterThanOrEqual(-1);
      expect(s.signals.fa).toBeLessThanOrEqual(1 + 1e-12);
      expect(s.signals.avg).toBeGreaterThanOrEqual(-1);
      expect(s.signals.avg).toBeLessThanOrEqual(1 + 1e-12);
      expect(s.signals.persist).toBeGreaterThanOrEqual(0);
      expect(s.signals.persist).toBeLessThanOrEqual(1);
      expect(s.signals.depth).toBeGreaterThan(0);
      expect(s.signals.depth).toBeLessThanOrEqual(1);
      // Weights sum preserved at 1.0 (defaults), adapted or not.
      const w = s.weights;
      expect(w.fa + w.avg + w.persist + w.depth).toBeCloseTo(1, 12);
    }
    // Determinism: same inputs → same scores.
    const again = await scoreInfluence({
      evidence,
      finalAnswerText: 'some final answer about foxes and numbers',
      embedder: mockEmbedder(),
    });
    expect(again).toEqual(scored);
  });
});
