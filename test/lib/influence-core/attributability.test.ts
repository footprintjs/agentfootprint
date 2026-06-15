/**
 * rankingConfidence — RFC-003 honesty marker for influence rankings.
 *
 * Convention-3 coverage: unit · functional · integration · property ·
 * security · performance · load. Pure function (no embedder) — the
 * integration tier composes it with the real `scoreInfluence` AND exercises
 * the public `observe` re-export.
 *
 * The load-bearing behavior: a FLAT ranking (no clear winner — the signature
 * of an absence/crowding bug the proxy is blind to) is reported
 * `clearWinner: false` with a shortlist that always covers the runner-up, rather
 * than a confident rank-1.
 */
import { describe, expect, it } from 'vitest';
import { mockEmbedder } from '../../../src/memory/embedding/mockEmbedder';
import {
  rankingConfidence,
  marginStrategy,
  ratioStrategy,
  DEFAULT_CLEAR_WINNER_MARGIN,
  DEFAULT_INFLUENCE_WEIGHTS,
  scoreInfluence,
  type ConfidenceStrategy,
  type InfluenceScore,
} from '../../../src/lib/influence-core';
// Public-surface re-export — proves the observe barrel wiring (not a dead export).
import { rankingConfidence as rankingConfidenceViaObserve } from '../../../src/observe';

/** Build a minimal valid InfluenceScore — the function only reads id + score. */
const mk = (id: string, score: number): InfluenceScore => ({
  id,
  score,
  signals: { fa: score, avg: 0, persist: 0, depth: 0 },
  weights: DEFAULT_INFLUENCE_WEIGHTS,
  adapted: false,
});

/** Deterministic LCG so property/load tiers are reproducible. */
function lcg(seed: number) {
  let s = seed >>> 0;
  return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 0xffffffff);
}

// ─── 1. UNIT ─────────────────────────────────────────────────────────
describe('rankingConfidence — unit', () => {
  it('decisive when the top margin meets the threshold', () => {
    const r = rankingConfidence([mk('a', 0.9), mk('b', 0.5), mk('c', 0.4)]);
    expect(r.clearWinner).toBe(true);
    expect(r.lead).toBe('a');
    expect(r.margin).toBeCloseTo(0.4, 6);
  });

  it('NOT decisive when the top margin is below the threshold (flat ranking)', () => {
    const r = rankingConfidence([mk('a', 0.82), mk('b', 0.8), mk('c', 0.79)]);
    expect(r.clearWinner).toBe(false);
    expect(r.margin).toBeCloseTo(0.02, 6);
    expect(r.reason).toMatch(/ablation/i);
  });

  it('shortlist covers the cluster within epsilon of the top (and always includes topId)', () => {
    const r = rankingConfidence([mk('a', 0.82), mk('b', 0.8), mk('c', 0.6)], { shortlistBand: 0.1 });
    expect(r.shortlist).toContain('a');
    expect(r.shortlist).toContain('b'); // 0.82-0.80=0.02 <= 0.1
    expect(r.shortlist).not.toContain('c'); // 0.82-0.60=0.22 > 0.1
  });

  it('boundary: margin EXACTLY at threshold is decisive (>= is inclusive)', () => {
    // 0.10 and 0.05 differ by exactly 0.05 (representable); just-below is not.
    expect(rankingConfidence([mk('a', 0.1), mk('b', 0.05)], { clearWinnerMargin: 0.05 }).clearWinner).toBe(true);
    expect(rankingConfidence([mk('a', 0.1), mk('b', 0.05)], { clearWinnerMargin: 0.0500001 }).clearWinner).toBe(false);
  });

  it('pure tie (all-equal scores) → not decisive, margin 0, whole cluster shortlisted', () => {
    const r = rankingConfidence([mk('a', 0.5), mk('b', 0.5), mk('c', 0.5)]);
    expect(r.clearWinner).toBe(false);
    expect(r.margin).toBe(0);
    expect(r.shortlist).toEqual(expect.arrayContaining(['a', 'b', 'c']));
  });

  it('shortlistBand=0 keeps only exact ties with the top', () => {
    const r = rankingConfidence([mk('a', 0.82), mk('b', 0.82), mk('c', 0.8)], { shortlistBand: 0 });
    expect(r.shortlist).toContain('a');
    expect(r.shortlist).toContain('b');
    // c is below by 0.02 > 0 — only present because not-decisive guarantees the runner-up;
    // here runner-up is b (a tie), so c must NOT appear:
    expect(r.shortlist).not.toContain('c');
  });

  it('negative scores order correctly (cosine ∈ [-1,1])', () => {
    const r = rankingConfidence([mk('a', -0.1), mk('b', -0.6), mk('c', -0.9)]);
    expect(r.lead).toBe('a');
    expect(r.margin).toBeCloseTo(0.5, 6);
    expect(r.clearWinner).toBe(true);
  });

  it('a single suspect is decisive by absence of alternatives', () => {
    const r = rankingConfidence([mk('only', 0.3)]);
    expect(r.clearWinner).toBe(true);
    expect(r.lead).toBe('only');
    expect(r.margin).toBeUndefined();
    expect(r.shortlist).toEqual(['only']);
  });

  it('empty input → not decisive, empty shortlist, no topId', () => {
    const r = rankingConfidence([]);
    expect(r.clearWinner).toBe(false);
    expect(r.lead).toBeUndefined();
    expect(r.shortlist).toEqual([]);
  });

  it('re-sorts defensively when input is not pre-sorted', () => {
    const r = rankingConfidence([mk('lo', 0.2), mk('hi', 0.9), mk('mid', 0.5)]);
    expect(r.lead).toBe('hi');
  });

  it('duplicate ids are de-duplicated in the shortlist', () => {
    const r = rankingConfidence([mk('dup', 0.82), mk('dup', 0.8)]);
    expect(r.shortlist.filter((id) => id === 'dup')).toHaveLength(1);
  });
});

// ─── 2. FUNCTIONAL ───────────────────────────────────────────────────
describe('rankingConfidence — functional', () => {
  it('clear winner: decisive lead, honest that it is a proxy not a cause', () => {
    const r = rankingConfidence([mk('culprit', 0.85), mk('x', 0.6), mk('y', 0.55)]);
    expect(r.clearWinner).toBe(true);
    expect(r.reason).toMatch(/proxy, not a proven cause/i);
    expect(r.reason).toMatch(/ablation/i);
  });

  it('absence/crowding signature: flat top → shortlist that CONTAINS the buried culprit', () => {
    // mirrors a measured B6 ranking: culprit ('filler') ranks #2 below an innocent.
    const r = rankingConfidence([mk('innocent', 0.828), mk('filler', 0.799), mk('f2', 0.767)]);
    expect(r.clearWinner).toBe(false);
    expect(r.shortlist).toContain('filler'); // the whole point: ablation would catch it
    expect(r.reason).toMatch(/blind to absence|crowding|truncation|dilution/i);
  });

  it('reason’s shortlisted-count matches shortlist.length (no lying string)', () => {
    const r = rankingConfidence([mk('a', 0.82), mk('b', 0.8), mk('c', 0.78)]);
    expect(r.reason).toContain(`${r.shortlist.length} shortlisted`);
  });
});

// ─── 3. INTEGRATION (with the real scoreInfluence + the public surface) ──
describe('rankingConfidence — integration', () => {
  it('the observe re-export is the same function (public surface wired)', () => {
    expect(rankingConfidenceViaObserve).toBe(rankingConfidence);
  });

  it('consumes a real scoreInfluence ranking and returns a well-formed assessment', async () => {
    const embedder = mockEmbedder();
    const scores = await scoreInfluence({
      embedder,
      finalAnswerText: 'the loan was declined due to recent bankruptcy',
      evidence: [
        { id: 'bankruptcy', text: 'applicant filed bankruptcy four months ago', ancestorTexts: [] },
        { id: 'credit', text: 'credit score is 760', ancestorTexts: [] },
        { id: 'income', text: 'annual income is 96000', ancestorTexts: [] },
      ],
    });
    const r = rankingConfidence(scores);
    expect(typeof r.clearWinner).toBe('boolean');
    expect(r.lead).toBe(scores[0].id);
    expect(r.shortlist).toContain(scores[0].id);
    expect(r.reason.length).toBeGreaterThan(0);
  });
});

// ─── 4. PROPERTY (randomized invariants, wide domain) ────────────────
describe('rankingConfidence — property', () => {
  it('invariants hold for arbitrary rankings (incl. negatives, ties, malformed)', () => {
    const rng = lcg(20260611);
    const pick = (): number => {
      const r = rng();
      if (r < 0.08) return NaN;
      if (r < 0.12) return Infinity;
      if (r < 0.16) return -Infinity;
      if (r < 0.36) return Math.round(rng() * 3) / 3; // small buckets → real ties
      return rng() * 2 - 1; // [-1, 1)
    };
    for (let trial = 0; trial < 800; trial++) {
      const n = Math.floor(rng() * 8);
      const scores = Array.from({ length: n }, (_, i) => mk(`s${i}`, pick()));
      const r = rankingConfidence(scores);

      if (n === 0) {
        expect(r.lead).toBeUndefined();
        expect(r.shortlist).toEqual([]);
        continue;
      }
      // shortlist always non-empty and contains topId; subset of input ids
      expect(r.shortlist.length).toBeGreaterThan(0);
      expect(r.shortlist).toContain(r.lead);
      const ids = new Set(scores.map((s) => s.id));
      for (const id of r.shortlist) expect(ids.has(id)).toBe(true);
      // reason’s count is honest
      if (!r.clearWinner && n >= 1) expect(r.reason).toContain(`${r.shortlist.length} shortlisted`);
      // single suspect is decisive
      if (n === 1) expect(r.clearWinner).toBe(true);
      // not-decisive with >=2 suspects ALWAYS covers the runner-up (the B6 guarantee)
      if (!r.clearWinner && n >= 2) expect(r.shortlist.length).toBeGreaterThanOrEqual(2);
      // when a finite margin is reported, decisive ⟺ margin >= threshold
      if (r.margin !== undefined && Number.isFinite(r.margin)) {
        expect(r.margin).toBeGreaterThanOrEqual(0);
        expect(r.clearWinner).toBe(r.margin >= DEFAULT_CLEAR_WINNER_MARGIN);
      }
    }
  });
});

// ─── 5. SECURITY / robustness ────────────────────────────────────────
describe('rankingConfidence — security & robustness', () => {
  it('a clean finite top over a malformed runner-up is DECISIVE (not suppressed)', () => {
    const r = rankingConfidence([mk('good', 0.9), mk('nan', NaN), mk('inf', Infinity)]);
    expect(r.lead).toBe('good');
    expect(r.clearWinner).toBe(true); // the lead is unambiguous; malformed others rank last
    expect(r.shortlist).toContain('good');
  });

  it('all-malformed scores → not decisive, but shortlist still contains topId (invariant holds)', () => {
    const r = rankingConfidence([mk('a', NaN), mk('b', NaN)]);
    expect(r.clearWinner).toBe(false);
    expect(r.margin).toBeUndefined();
    expect(r.lead).toBe('a');
    expect(r.shortlist.length).toBeGreaterThan(0);
    expect(r.shortlist).toContain('a');
    expect(r.reason).toContain(`${r.shortlist.length} shortlisted`); // count is honest
  });

  it('shortlistBand < clearWinnerMargin still covers the runner-up when not decisive', () => {
    // pathological config that previously collapsed the shortlist to one item.
    const r = rankingConfidence([mk('a', 0.82), mk('b', 0.8)], { clearWinnerMargin: 0.05, shortlistBand: 0.01 });
    expect(r.clearWinner).toBe(false);
    expect(r.shortlist).toContain('a');
    expect(r.shortlist).toContain('b'); // the would-be culprit must not be dropped
  });

  it('negative or NaN thresholds fail loud with a prefixed message', () => {
    // clearWinnerMargin builds the default margin strategy → its throw is prefixed there.
    expect(() => rankingConfidence([mk('a', 0.5)], { clearWinnerMargin: -1 })).toThrow(/marginStrategy/);
    expect(() => rankingConfidence([mk('a', 0.5)], { clearWinnerMargin: NaN })).toThrow(/marginStrategy/);
    expect(() => rankingConfidence([mk('a', 0.5)], { shortlistBand: -0.1 })).toThrow(/rankingConfidence/);
  });

  it('does not mutate the caller’s array', () => {
    const input = [mk('a', 0.1), mk('b', 0.9)];
    const copy = [...input];
    rankingConfidence(input);
    expect(input).toEqual(copy);
  });

  it('proto-pollution ids are inert strings', () => {
    const r = rankingConfidence([mk('__proto__', 0.9), mk('constructor', 0.4)]);
    expect(r.lead).toBe('__proto__');
    expect(({} as Record<string, unknown>).polluted).toBeUndefined();
  });
});

// ─── PLUGGABLE STRATEGY (seam + shipped strategies) ──────────────────
describe('rankingConfidence — pluggable strategy', () => {
  it('marginStrategy is the default (explicit == implicit)', () => {
    const scores = [mk('a', 0.82), mk('b', 0.8)];
    const implicit = rankingConfidence(scores);
    const explicit = rankingConfidence(scores, { strategy: marginStrategy(DEFAULT_CLEAR_WINNER_MARGIN) });
    expect(explicit.clearWinner).toBe(implicit.clearWinner);
  });

  it('strategy WINS over clearWinnerMargin when both are passed', () => {
    // margin 0.02; clearWinnerMargin 0.01 would say clear, but the strategy says not.
    const scores = [mk('a', 0.82), mk('b', 0.8)];
    const r = rankingConfidence(scores, { clearWinnerMargin: 0.01, strategy: marginStrategy(0.05) });
    expect(r.clearWinner).toBe(false);
    expect(r.reason).toContain('margin>=0.05');
  });

  it('ratioStrategy is scale-invariant where absolute margin is not', () => {
    // SAME relative gap (10%) at two different scales:
    const small = [mk('a', 0.1), mk('b', 0.09)]; // abs gap 0.01, ratio 0.10
    const large = [mk('a', 1.0), mk('b', 0.9)]; // abs gap 0.10, ratio 0.10
    // absolute margin (0.05) FLIPS its verdict with scale:
    expect(rankingConfidence(small, { clearWinnerMargin: 0.05 }).clearWinner).toBe(false);
    expect(rankingConfidence(large, { clearWinnerMargin: 0.05 }).clearWinner).toBe(true);
    // ratio (0.05) is INVARIANT — both are clear winners:
    const ratio = ratioStrategy(0.05);
    expect(rankingConfidence(small, { strategy: ratio }).clearWinner).toBe(true);
    expect(rankingConfidence(large, { strategy: ratio }).clearWinner).toBe(true);
  });

  it('ratioStrategy separates a B6-like flat ranking from a content-bug lead', () => {
    const ratio = ratioStrategy(0.05);
    const b6 = [mk('innocent', 0.828), mk('filler', 0.799), mk('f2', 0.767)]; // ratio ~3.5%
    const content = [mk('culprit', 0.85), mk('x', 0.6)]; // ratio ~29%
    expect(rankingConfidence(b6, { strategy: ratio }).clearWinner).toBe(false);
    expect(rankingConfidence(content, { strategy: ratio }).clearWinner).toBe(true);
  });

  it('a custom strategy plugs in and its name surfaces in the reason', () => {
    const alwaysClear: ConfidenceStrategy = { name: 'always', isClearWinner: () => true };
    const r = rankingConfidence([mk('a', 0.5), mk('b', 0.49)], { strategy: alwaysClear });
    expect(r.clearWinner).toBe(true);
    expect(r.reason).toContain('always');
  });

  it('framework invariants hold under ANY strategy (malformed + single suspect)', () => {
    const alwaysClear: ConfidenceStrategy = { name: 'always', isClearWinner: () => true };
    // all-malformed must stay not-clear regardless of strategy:
    expect(rankingConfidence([mk('a', NaN), mk('b', NaN)], { strategy: alwaysClear }).clearWinner).toBe(false);
    // single suspect is clear regardless:
    const neverClear: ConfidenceStrategy = { name: 'never', isClearWinner: () => false };
    expect(rankingConfidence([mk('only', 0.3)], { strategy: neverClear }).clearWinner).toBe(true);
  });

  it('strategy factories reject negative/NaN thresholds', () => {
    expect(() => marginStrategy(-1)).toThrow(/marginStrategy/);
    expect(() => ratioStrategy(NaN)).toThrow(/ratioStrategy/);
  });
});

// ─── 6. PERFORMANCE ──────────────────────────────────────────────────
describe('rankingConfidence — performance', () => {
  it('scales ~n log n, not quadratic (relative guard, machine-independent)', () => {
    const rng = lcg(7);
    const time = (n: number) => {
      const scores = Array.from({ length: n }, (_, i) => mk(`s${i}`, rng()));
      const t0 = performance.now();
      rankingConfidence(scores);
      return performance.now() - t0;
    };
    time(1000); // warm
    const small = Math.max(time(1000), 0.01);
    const big = time(10_000);
    expect(big).toBeLessThan(small * 50); // 10x size, well under quadratic blowup
  });
});

// ─── 7. LOAD ─────────────────────────────────────────────────────────
describe('rankingConfidence — load', () => {
  it('sustains 20k assessments without throwing', () => {
    const rng = lcg(99);
    for (let i = 0; i < 20_000; i++) {
      const n = 1 + Math.floor(rng() * 6);
      const r = rankingConfidence(Array.from({ length: n }, (_, j) => mk(`s${j}`, rng())));
      expect(typeof r.clearWinner).toBe('boolean');
    }
  });
});
