/**
 * scoreContrastiveInfluence — RFC-003 contrastive influence (a separate, opt-in
 * second stage over the four-signal scorer).
 *
 * Convention-3 coverage: unit · functional · integration · property · security ·
 * performance · load. The load-bearing behavior: a topically-central INNOCENT
 * (similar to both the wrong and the right output) is demoted by the contrast,
 * while the true culprit (similar to the wrong output only) rises.
 */
import { describe, expect, it } from 'vitest';
import {
  scoreContrastiveInfluence,
  scoreInfluence,
  rankingConfidence,
  type Embedder,
  type InfluenceScore,
} from '../../../src/lib/influence-core';
import { scoreContrastiveInfluence as viaObserve } from '../../../src/observe';

/**
 * A controllable fake embedder: each text maps to a fixed 3-d vector via a
 * lookup, so we can engineer the topical-innocent confound deterministically.
 * Axes ≈ [refund-policy topicality, "deny/wrong" direction, "approve/right"].
 */
function fakeEmbedder(table: Record<string, number[]>): Embedder {
  return {
    dimensions: 3,
    async embed({ text }) {
      return table[text] ?? [0, 0, 0];
    },
  };
}

// answer = a DENY (wrong) output; reference = an APPROVE (right) output.
// - policy (innocent): high topicality, points at BOTH outputs equally.
// - culprit: points at the DENY output specifically.
// - filler: unrelated.
const TABLE: Record<string, number[]> = {
  ANSWER_DENY: [1, 1, 0],
  REFERENCE_APPROVE: [1, 0, 1],
  'policy (innocent, topical)': [1, 0.5, 0.5], // similar to BOTH → cancels under contrast
  'culprit (caused the deny)': [0, 1, 0], // similar to DENY only
  'filler (unrelated)': [0, 0, 0],
};
const embedder = fakeEmbedder(TABLE);
const ev = (id: string, text: string): { id: string; text: string; ancestorTexts: string[] } => ({
  id,
  text,
  ancestorTexts: [],
});
const evidence = [
  ev('policy', 'policy (innocent, topical)'),
  ev('culprit', 'culprit (caused the deny)'),
  ev('filler', 'filler (unrelated)'),
];

// ─── 1. UNIT + 2. FUNCTIONAL ─────────────────────────────────────────
describe('scoreContrastiveInfluence — the confound fix', () => {
  it('plain influence is fooled by the topical innocent; contrastive is not', async () => {
    const plain = await scoreInfluence({ evidence, finalAnswerText: 'ANSWER_DENY', embedder });
    const contrast = await scoreContrastiveInfluence({
      evidence,
      answerText: 'ANSWER_DENY',
      referenceText: 'REFERENCE_APPROVE',
      embedder,
    });
    expect(plain[0].id).toBe('policy'); // plain ranks the innocent #1 (the confound)
    expect(contrast[0].id).toBe('culprit'); // contrast fixes it → culprit #1
  });

  it('returns InfluenceScore[] sorted descending', async () => {
    const r = await scoreContrastiveInfluence({
      evidence,
      answerText: 'ANSWER_DENY',
      referenceText: 'REFERENCE_APPROVE',
      embedder,
    });
    for (let i = 1; i < r.length; i++) expect(r[i - 1].score).toBeGreaterThanOrEqual(r[i].score);
    expect(new Set(r.map((s) => s.id))).toEqual(new Set(['policy', 'culprit', 'filler']));
  });

  it('a topical innocent gets ~zero contrastive FA (cancels); the culprit stays positive', async () => {
    const r = await scoreContrastiveInfluence({
      evidence,
      answerText: 'ANSWER_DENY',
      referenceText: 'REFERENCE_APPROVE',
      embedder,
    });
    const fa = (id: string) => r.find((s) => s.id === id).signals.fa;
    expect(Math.abs(fa('policy'))).toBeLessThan(fa('culprit')); // innocent cancels, culprit dominates
  });
});

// ─── 3. INTEGRATION ──────────────────────────────────────────────────
describe('scoreContrastiveInfluence — integration', () => {
  it('observe re-export is the same function', () => {
    expect(viaObserve).toBe(scoreContrastiveInfluence);
  });

  it('composes with rankingConfidence (same InfluenceScore[] shape)', async () => {
    const scores = await scoreContrastiveInfluence({
      evidence,
      answerText: 'ANSWER_DENY',
      referenceText: 'REFERENCE_APPROVE',
      embedder,
    });
    const c = rankingConfidence(scores);
    expect(typeof c.clearWinner).toBe('boolean');
    expect(c.lead).toBe(scores[0].id);
  });
});

// ─── 4. PROPERTY ─────────────────────────────────────────────────────
describe('scoreContrastiveInfluence — property', () => {
  it('answer == reference ⇒ all contrastive FA are ~0 (no signal when there is no contrast)', async () => {
    const r = await scoreContrastiveInfluence({
      evidence,
      answerText: 'ANSWER_DENY',
      referenceText: 'ANSWER_DENY',
      embedder,
    });
    for (const s of r) expect(Math.abs(s.signals.fa)).toBeLessThan(1e-9);
  });

  it('preserves all evidence ids exactly once for arbitrary small inputs', async () => {
    for (let n = 1; n <= 4; n++) {
      const evs = Array.from({ length: n }, (_, i) =>
        ev(`s${i}`, i % 2 ? 'culprit (caused the deny)' : 'filler (unrelated)'),
      );
      // unique ids required; texts may repeat
      const r = await scoreContrastiveInfluence({
        evidence: evs,
        answerText: 'ANSWER_DENY',
        referenceText: 'REFERENCE_APPROVE',
        embedder,
      });
      expect(r.map((s) => s.id).sort()).toEqual(evs.map((e) => e.id).sort());
    }
  });
});

// ─── 5. SECURITY / robustness ────────────────────────────────────────
describe('scoreContrastiveInfluence — security & robustness', () => {
  it('duplicate evidence ids fail loud (same contract as scoreInfluence)', async () => {
    await expect(
      scoreContrastiveInfluence({
        evidence: [ev('dup', 'culprit (caused the deny)'), ev('dup', 'filler (unrelated)')],
        answerText: 'ANSWER_DENY',
        referenceText: 'REFERENCE_APPROVE',
        embedder,
      }),
    ).rejects.toThrow(/scoreContrastiveInfluence: duplicate evidence id/);
  });

  it('empty evidence → empty result, no throw', async () => {
    const r = await scoreContrastiveInfluence({
      evidence: [],
      answerText: 'ANSWER_DENY',
      referenceText: 'REFERENCE_APPROVE',
      embedder,
    });
    expect(r).toEqual([]);
  });

  it('malformed weights fail loud, attributed to scoreContrastiveInfluence (same contract as scoreInfluence)', async () => {
    await expect(
      scoreContrastiveInfluence({
        evidence,
        answerText: 'ANSWER_DENY',
        referenceText: 'REFERENCE_APPROVE',
        embedder,
        weights: { fa: -1, avg: 0.3, persist: 0.2, depth: 0.1 },
      }),
    ).rejects.toThrow(
      /scoreContrastiveInfluence: weight 'fa' must be a finite non-negative number/,
    );
    await expect(
      scoreContrastiveInfluence({
        evidence,
        answerText: 'ANSWER_DENY',
        referenceText: 'REFERENCE_APPROVE',
        embedder,
        weights: { fa: 0, avg: 0, persist: 0, depth: 0 },
      }),
    ).rejects.toThrow(/scoreContrastiveInfluence: all weights are zero/);
  });
});

// ─── 6. PERFORMANCE + 7. LOAD ────────────────────────────────────────
describe('scoreContrastiveInfluence — performance & load', () => {
  it('200 evidence items score promptly (fake embedder isolates the math)', async () => {
    const big = Array.from({ length: 200 }, (_, i) =>
      ev(`s${i}`, i % 2 ? 'culprit (caused the deny)' : 'policy (innocent, topical)'),
    );
    const t0 = performance.now();
    const r = await scoreContrastiveInfluence({
      evidence: big,
      answerText: 'ANSWER_DENY',
      referenceText: 'REFERENCE_APPROVE',
      embedder,
    });
    expect(r.length).toBe(200);
    expect(performance.now() - t0).toBeLessThan(1000);
  });

  it('sustains many calls without throwing', async () => {
    for (let i = 0; i < 300; i++) {
      const r = await scoreContrastiveInfluence({
        evidence,
        answerText: 'ANSWER_DENY',
        referenceText: 'REFERENCE_APPROVE',
        embedder,
      });
      expect(r.length).toBe(3);
    }
  });
});
