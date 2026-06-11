/**
 * influence-core — D6 PARITY test (the extraction acceptance).
 *
 * The FDL paper pipeline (Visible Reasoning, Eq. 1–6) had no goldens in
 * this repo — the pipeline existed as the paper's published equations +
 * the `Embedder`/cosine machinery. Per the D6 acceptance rule, the
 * parity fixture was created FROM an independent reference first:
 *
 *   1. `GOLDENS` below were produced by a standalone, deliberately
 *      naive transcription of Eq. 1–6 (own cosine, own loops, zero
 *      imports from influence-core) run over `SCENARIO` with the
 *      repo's deterministic `mockEmbedder()`.
 *   2. This test proves the extracted module reproduces them, AND
 *      recomputes the reference LIVE (the transcription is embedded
 *      below) so the equations themselves are pinned, not just values.
 *
 * Tiers: functional (module vs goldens) · integration (one shared
 * EmbeddingCache across scoreInfluence + pairwiseSimilarity +
 * scoreMargin — RFC-002 §3's "one cache serves all").
 */
import { describe, expect, it } from 'vitest';
import { mockEmbedder } from '../../../src/memory/embedding/mockEmbedder';
import {
  EmbeddingCache,
  pairwiseSimilarity,
  scoreInfluence,
  scoreMargin,
  type EvidenceInput,
  type InfluenceScore,
} from '../../../src/lib/influence-core';

// ── The parity fixture (career-agent scenario, paper §6 shape) ──────

const SCENARIO: { finalAnswerText: string; evidence: EvidenceInput[] } = {
  finalAnswerText:
    'Career recommendation: pursue public policy analysis, blending your data analysis skills with your interest in civic engagement and community programs.',
  evidence: [
    {
      id: 'web-search',
      text: 'Public policy analysts use data analysis to evaluate civic programs and community policy outcomes.',
      ancestorTexts: [
        'The search results suggest public policy analysis combines data skills with civic engagement.',
        "I should weigh the candidate's data analysis skills against policy-focused career paths.",
        'Community program evaluation appears repeatedly as a strong career direction.',
      ],
    },
    {
      // The paper's Fig. 3 case: NO ancestors → Eq. 6 adapts weights
      // to α′=0.80, δ′=0.20.
      id: 'social-media-profile',
      text: 'Posts show strong interest in public policy, civic engagement, and local community programs.',
      ancestorTexts: [],
    },
    {
      id: 'resume-parser',
      text: 'Resume lists five years of data analysis, statistics, and dashboard reporting experience.',
      ancestorTexts: [
        'The resume shows deep data analysis experience that transfers to policy evaluation.',
        'Statistics and reporting skills are core requirements for analyst roles.',
      ],
    },
  ],
};

/**
 * Created FROM the independent Eq. 1–6 transcription (see module doc),
 * mockEmbedder() default 32 dims, default weights 0.40/0.30/0.20/0.10,
 * T = 0.30. Order is the reference's ranking, descending.
 */
const GOLDENS = [
  {
    id: 'social-media-profile',
    signals: { fa: 0.9622996554106298, avg: 0, persist: 0, depth: 1 },
    weights: { fa: 0.8, avg: 0, persist: 0, depth: 0.2 },
    adapted: true,
    score: 0.969839724328504,
  },
  {
    id: 'resume-parser',
    signals: {
      fa: 0.9311187051883455,
      avg: 0.9615536927054973,
      persist: 1,
      depth: 0.3333333333333333,
    },
    weights: { fa: 0.4, avg: 0.3, persist: 0.2, depth: 0.1 },
    adapted: false,
    score: 0.8942469232203206,
  },
  {
    id: 'web-search',
    signals: {
      fa: 0.9434890572922826,
      avg: 0.9037883250946646,
      persist: 1,
      depth: 0.25,
    },
    weights: { fa: 0.4, avg: 0.3, persist: 0.2, depth: 0.1 },
    adapted: false,
    score: 0.8735321204453125,
  },
] as const;

// ── The independent reference transcription (Eq. 1–6, naive) ────────
// Shares NOTHING with src/lib/influence-core: own cosine, own loops.

function refCos(a: readonly number[], b: readonly number[]): number {
  let dot = 0;
  let ma = 0;
  let mb = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    ma += a[i] * a[i];
    mb += b[i] * b[i];
  }
  if (ma === 0 || mb === 0) return 0;
  return dot / (Math.sqrt(ma) * Math.sqrt(mb));
}

async function referencePipeline(
  scenario: typeof SCENARIO,
  T: number,
): Promise<Array<{ id: string; score: number; adapted: boolean }>> {
  const embedder = mockEmbedder();
  const alpha = 0.4;
  const beta = 0.3;
  const gamma = 0.2;
  const delta = 0.1;
  const ef = await embedder.embed({ text: scenario.finalAnswerText });

  const out: Array<{ id: string; score: number; adapted: boolean }> = [];
  for (const d of scenario.evidence) {
    const ed = await embedder.embed({ text: d.text });
    const sims: number[] = [];
    for (const t of d.ancestorTexts) sims.push(refCos(ed, await embedder.embed({ text: t })));
    const n = sims.length;

    const FA = refCos(ed, ef); // Eq. 1
    const AVG = n > 0 ? sims.reduce((s, x) => s + x, 0) / n : 0; // Eq. 2
    const PERSIST = n > 0 ? sims.filter((x) => x > T).length / n : 0; // Eq. 3
    const DEPTH = 1 / (1 + n); // Eq. 4

    let a = alpha;
    let b = beta;
    let g = gamma;
    let dl = delta;
    let adapted = false;
    if (n === 0) {
      // Eq. 6
      a = alpha + ((beta + gamma) * alpha) / (alpha + delta);
      dl = delta + ((beta + gamma) * delta) / (alpha + delta);
      b = 0;
      g = 0;
      adapted = true;
    }

    const S = a * FA + b * AVG + g * PERSIST + dl * DEPTH; // Eq. 5
    out.push({ id: d.id, score: S, adapted });
  }
  return out.sort((x, y) => y.score - x.score);
}

// ── Parity: module vs pinned goldens ────────────────────────────────

describe('influence-core — parity vs the FDL paper pipeline (D6 acceptance)', () => {
  it('reproduces the pinned goldens exactly (ids, order, signals, weights, adapted, scores)', async () => {
    const scored = await scoreInfluence({
      evidence: SCENARIO.evidence,
      finalAnswerText: SCENARIO.finalAnswerText,
      embedder: mockEmbedder(),
    });

    expect(scored.map((s) => s.id)).toEqual(GOLDENS.map((g) => g.id));
    for (let i = 0; i < GOLDENS.length; i++) {
      const got = scored[i] as InfluenceScore;
      const want = GOLDENS[i];
      expect(got.adapted).toBe(want.adapted);
      expect(got.score).toBeCloseTo(want.score, 12);
      expect(got.signals.fa).toBeCloseTo(want.signals.fa, 12);
      expect(got.signals.avg).toBeCloseTo(want.signals.avg, 12);
      expect(got.signals.persist).toBeCloseTo(want.signals.persist, 12);
      expect(got.signals.depth).toBeCloseTo(want.signals.depth, 12);
      expect(got.weights.fa).toBeCloseTo(want.weights.fa, 12);
      expect(got.weights.avg).toBeCloseTo(want.weights.avg, 12);
      expect(got.weights.persist).toBeCloseTo(want.weights.persist, 12);
      expect(got.weights.depth).toBeCloseTo(want.weights.depth, 12);
    }
  });

  it('matches the live reference transcription at the default threshold', async () => {
    const reference = await referencePipeline(SCENARIO, 0.3);
    const scored = await scoreInfluence({
      evidence: SCENARIO.evidence,
      finalAnswerText: SCENARIO.finalAnswerText,
      embedder: mockEmbedder(),
    });
    expect(scored.map((s) => s.id)).toEqual(reference.map((r) => r.id));
    for (let i = 0; i < reference.length; i++) {
      expect(scored[i].score).toBeCloseTo(reference[i].score, 12);
      expect(scored[i].adapted).toBe(reference[i].adapted);
    }
  });

  it('matches the reference at T = 0.915 (fractional PERSIST — 1 of 3 ancestors clears)', async () => {
    const reference = await referencePipeline(SCENARIO, 0.915);
    const scored = await scoreInfluence({
      evidence: SCENARIO.evidence,
      finalAnswerText: SCENARIO.finalAnswerText,
      embedder: mockEmbedder(),
      persistenceThreshold: 0.915,
    });
    expect(scored.map((s) => s.id)).toEqual(reference.map((r) => r.id));
    for (let i = 0; i < reference.length; i++) {
      expect(scored[i].score).toBeCloseTo(reference[i].score, 12);
    }
    // The fraction actually shows up (not all-0 / all-1 degenerate):
    const webSearch = scored.find((s) => s.id === 'web-search');
    expect(webSearch!.signals.persist).toBeCloseTo(1 / 3, 12);
  });

  it('adapted item carries the paper Fig. 3 effective weights (0.80 / 0.20)', async () => {
    const scored = await scoreInfluence({
      evidence: SCENARIO.evidence,
      finalAnswerText: SCENARIO.finalAnswerText,
      embedder: mockEmbedder(),
    });
    const social = scored.find((s) => s.id === 'social-media-profile');
    expect(social!.adapted).toBe(true);
    expect(social!.weights).toEqual({ fa: 0.8, avg: 0, persist: 0, depth: 0.2 });
  });
});

// ── Integration: ONE cache across all three consumers (RFC-002 §3) ──

describe('influence-core — one EmbeddingCache serves scoring + lint + margins', () => {
  it('texts embedded once across scoreInfluence, pairwiseSimilarity, and scoreMargin', async () => {
    let innerCalls = 0;
    const inner = mockEmbedder();
    const counting = {
      dimensions: inner.dimensions,
      embed: async (args: { text: string }) => {
        innerCalls += 1;
        return inner.embed(args);
      },
      // No embedBatch — every inner embed is one countable call.
    };
    const cache = new EmbeddingCache(counting, { maxEntries: 256 });

    // (a) FDL scoring (paper pipeline / RFC-003 D7)
    await scoreInfluence({
      evidence: SCENARIO.evidence,
      finalAnswerText: SCENARIO.finalAnswerText,
      embedder: cache,
    });
    const afterScoring = innerCalls;

    // (b) catalog lint geometry (RFC-002 C1) over the SAME texts
    await pairwiseSimilarity({
      items: SCENARIO.evidence.map((e) => ({ id: e.id, text: e.text })),
      embedder: cache,
    });

    // (c) margin scoring (RFC-002 C4) — context = the final answer,
    // candidates = the same evidence texts
    await scoreMargin({
      candidates: SCENARIO.evidence.map((e) => ({ name: e.id, text: e.text })),
      contextText: SCENARIO.finalAnswerText,
      chosen: ['web-search'],
      embedder: cache,
    });

    // (b) and (c) added ZERO inner calls — every text was already cached.
    expect(innerCalls).toBe(afterScoring);
    expect(cache.stats().evictions).toBe(0);
    expect(cache.stats().hits).toBeGreaterThan(0);
  });

  it('cache wrapping is score-transparent (same goldens through the cache)', async () => {
    const cached = await scoreInfluence({
      evidence: SCENARIO.evidence,
      finalAnswerText: SCENARIO.finalAnswerText,
      embedder: new EmbeddingCache(mockEmbedder()),
    });
    for (let i = 0; i < GOLDENS.length; i++) {
      expect(cached[i].id).toBe(GOLDENS[i].id);
      expect(cached[i].score).toBeCloseTo(GOLDENS[i].score, 12);
    }
  });
});
