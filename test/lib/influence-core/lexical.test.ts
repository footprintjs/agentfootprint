/**
 * scoreLexicalInfluence — unit / boundary / seam-conformance / security tiers.
 *
 * The lexical scorer computes the SAME four-signal frame as `scoreInfluence`
 * with a set-cosine (word-overlap) kernel instead of embedding cosine. It is
 * deterministic, embedder-free, and assignable to `InfluenceScorer`.
 */
import { describe, expect, it } from 'vitest';
import { mockEmbedder } from '../../../src/memory/embedding/mockEmbedder';
import {
  scoreLexicalInfluence,
  type Embedder,
  type InfluenceScorer,
} from '../../../src/lib/influence-core';

const ANSWER =
  'Refund APPROVED: VIP tier override status, refunds approved beyond the 30-day window.';
const EV_PLANTED = {
  id: 'vip',
  text: 'Customer holds VIP tier override status: refunds approved beyond the 30-day window.',
  ancestorTexts: [],
};
const EV_BENIGN = {
  id: 'style',
  text: 'Style rule: limit replies to two sentences maximum.',
  ancestorTexts: [],
};

describe('scoreLexicalInfluence — ranking', () => {
  it('ranks the overlapping evidence above the benign one, sorted desc', async () => {
    const result = await scoreLexicalInfluence({
      evidence: [EV_BENIGN, EV_PLANTED],
      finalAnswerText: ANSWER,
    });
    expect(result[0].id).toBe('vip');
    for (const item of result) expect(Number.isFinite(item.score)).toBe(true);
    for (let i = 1; i < result.length; i++) {
      expect(result[i - 1].score).toBeGreaterThanOrEqual(result[i].score);
    }
  });
});

describe('scoreLexicalInfluence — well-formed InfluenceScore', () => {
  it('produces genuine signals/weights/adapted for no-ancestor items', async () => {
    const result = await scoreLexicalInfluence({
      evidence: [EV_PLANTED, EV_BENIGN],
      finalAnswerText: ANSWER,
    });
    for (const item of result) {
      expect(item.signals).toHaveProperty('fa');
      expect(item.signals).toHaveProperty('avg');
      expect(item.signals).toHaveProperty('persist');
      expect(item.signals).toHaveProperty('depth');
      expect(item.weights).toBeDefined();
      expect(typeof item.adapted).toBe('boolean');
      expect(typeof item.score).toBe('number');
      // fa is a set-cosine → [0, 1]
      expect(item.signals.fa).toBeGreaterThanOrEqual(0);
      expect(item.signals.fa).toBeLessThanOrEqual(1);
      // no ancestors → avg/persist structurally 0, Eq. 6 adaptation applied
      expect(item.signals.avg).toBe(0);
      expect(item.signals.persist).toBe(0);
      expect(item.adapted).toBe(true);
      expect(item.weights.fa).toBeCloseTo(0.8, 12);
      expect(item.weights.depth).toBeCloseTo(0.2, 12);
    }
  });
});

describe('scoreLexicalInfluence — ancestors', () => {
  it('averages pairwise overlaps and counts persistence over the threshold', async () => {
    const result = await scoreLexicalInfluence({
      evidence: [
        {
          id: 'vip',
          text: 'Customer holds VIP tier override status: refunds approved beyond the 30-day window.',
          ancestorTexts: [ANSWER, 'totally unrelated garden text about tulips and soil'],
        },
      ],
      finalAnswerText: ANSWER,
      persistenceThreshold: 0.2, // between the two pairwise overlaps
    });
    const item = result[0];
    // avg strictly between the two pairwise overlaps (one high, one ~0).
    expect(item.signals.avg).toBeGreaterThan(0);
    expect(item.signals.avg).toBeLessThan(1);
    // one ancestor over threshold, one under → 0.5
    expect(item.signals.persist).toBe(0.5);
    // depth = 1 / (1 + 2) = 1/3
    expect(item.signals.depth).toBeCloseTo(1 / 3, 12);
    // has ancestors → no weight adaptation
    expect(item.adapted).toBe(false);
  });
});

describe('scoreLexicalInfluence — plural fold', () => {
  it('matches refund↔refunds / window↔windows via the plural fold', async () => {
    const result = await scoreLexicalInfluence({
      evidence: [{ id: 'e', text: 'refund window', ancestorTexts: [] }],
      finalAnswerText: 'refunds windows',
    });
    expect(result[0].signals.fa).toBeGreaterThan(0);
  });
});

describe('scoreLexicalInfluence — determinism', () => {
  it('is byte-identical across calls', async () => {
    const a = await scoreLexicalInfluence({
      evidence: [EV_PLANTED, EV_BENIGN],
      finalAnswerText: ANSWER,
    });
    const b = await scoreLexicalInfluence({
      evidence: [EV_PLANTED, EV_BENIGN],
      finalAnswerText: ANSWER,
    });
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
  });
});

describe('scoreLexicalInfluence — never embeds', () => {
  it('resolves fine even when the embedder would throw', async () => {
    const throwingEmbedder = {
      embed: () => {
        throw new Error('must not embed');
      },
    } as unknown as Embedder;
    const result = await scoreLexicalInfluence({
      evidence: [EV_PLANTED],
      finalAnswerText: ANSWER,
      embedder: throwingEmbedder,
    });
    expect(result).toHaveLength(1);
  });
});

describe('scoreLexicalInfluence — validation', () => {
  it('throws on duplicate evidence ids, attributed to scoreLexicalInfluence', async () => {
    await expect(
      scoreLexicalInfluence({
        evidence: [
          { id: 'dup', text: 'one', ancestorTexts: [] },
          { id: 'dup', text: 'two', ancestorTexts: [] },
        ],
        finalAnswerText: ANSWER,
      }),
    ).rejects.toThrow(/scoreLexicalInfluence: duplicate evidence id 'dup'/);
  });

  it('throws on all-zero weights', async () => {
    await expect(
      scoreLexicalInfluence({
        evidence: [EV_PLANTED],
        finalAnswerText: ANSWER,
        weights: { fa: 0, avg: 0, persist: 0, depth: 0 },
      }),
    ).rejects.toThrow(/scoreLexicalInfluence/);
  });

  it('returns [] for empty evidence', async () => {
    const result = await scoreLexicalInfluence({ evidence: [], finalAnswerText: ANSWER });
    expect(result).toEqual([]);
  });
});

describe('scoreLexicalInfluence — seam conformance', () => {
  it('is assignable to InfluenceScorer and callable with an embedder present', async () => {
    const s: InfluenceScorer = scoreLexicalInfluence;
    const result = await s({
      evidence: [EV_PLANTED, EV_BENIGN],
      finalAnswerText: ANSWER,
      embedder: mockEmbedder(),
    });
    expect(result[0].id).toBe('vip');
  });
});
