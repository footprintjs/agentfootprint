/**
 * rankingConfidence — honesty marker for an influence ranking (RFC-003 honesty
 * marker; influence-core block D6). Internal concept: "attributability".
 *
 * Pattern: pure, embedder-free function over a `scoreInfluence` result.
 *          Deterministic; no I/O.
 * Role:    `src/lib/influence-core/` leaf. The honesty companion to the
 *          four-signal scorer: it says when the ranking is a SHORTLIST,
 *          not a verdict.
 *
 * ## Why this exists (the measured blind spot)
 *
 * Output-similarity influence ranks sources by how much they resemble the
 * final answer. That is structurally blind to ABSENCE / CROWDING bugs: a
 * culprit that caused the error by *displacing* context (history truncation,
 * context dilution) need not resemble the answer — so it ranks low, or below
 * an innocent that the answer happens to talk about. The tell is not a low
 * absolute score; it is a FLAT top — no source clearly dominates. This
 * function reports that flatness honestly so consumers escalate to ablation
 * (the causal tier) instead of trusting a confident-but-wrong rank-1.
 *
 * Honest claim (RFC-002 §2 discipline): `clearWinner` is a proxy for "the
 * ranking has a clear lead", never "the lead is the cause". A clear lead can
 * still be an innocent the answer rationalizes over — only ablation makes
 * causal claims.
 */
import type { ConfidenceStrategy, InfluenceScore, RankingConfidence } from './types.js';
import {
  DEFAULT_CLEAR_WINNER_MARGIN,
  DEFAULT_CLEAR_WINNER_RATIO,
  DEFAULT_SHORTLIST_BAND,
} from './types.js';

const nonNegative = (label: string, x: number): number => {
  // `!(x >= 0)` rejects negatives AND NaN (a plain `< 0` would let NaN through).
  if (!(x >= 0)) throw new Error(`${label} must be >= 0 (got ${x})`);
  return x;
};

/**
 * Default strategy: ABSOLUTE top-2 gap `s0 − s1 >= threshold`. Simple and
 * interpretable, but embedder-relative (the gap scale depends on the embedding
 * geometry). Use `ratioStrategy` for cross-embedder transfer.
 */
export function marginStrategy(
  threshold: number = DEFAULT_CLEAR_WINNER_MARGIN,
): ConfidenceStrategy {
  nonNegative('marginStrategy: threshold', threshold);
  return {
    name: `margin>=${threshold}`,
    isClearWinner: (s) => s.length >= 2 && s[0] - s[1] >= threshold,
  };
}

/**
 * Scale-invariant strategy: top-2 gap as a FRACTION of the top score,
 * `(s0 − s1) / |s0| >= threshold`. Transfers across embedders / answer lengths
 * where the absolute margin does not. A zero (or all-equal) top is never a
 * clear winner.
 */
export function ratioStrategy(threshold: number = DEFAULT_CLEAR_WINNER_RATIO): ConfidenceStrategy {
  nonNegative('ratioStrategy: threshold', threshold);
  return {
    name: `ratio>=${threshold}`,
    isClearWinner: (s) => {
      if (s.length < 2) return false;
      const denom = Math.abs(s[0]);
      if (denom === 0) return false; // flat at zero → no clear winner (avoid div-by-zero)
      return (s[0] - s[1]) / denom >= threshold;
    },
  };
}

export interface RankingConfidenceOptions {
  /**
   * The decisiveness rule. Default: `marginStrategy(clearWinnerMargin)`.
   * When set, it WINS — `clearWinnerMargin` is ignored. Bring your own
   * (e.g. entropy / dispersion) or use the shipped `ratioStrategy`.
   */
  readonly strategy?: ConfidenceStrategy;
  /** Threshold for the DEFAULT margin strategy (ignored when `strategy` is
   *  set). Default: `DEFAULT_CLEAR_WINNER_MARGIN` (0.05). */
  readonly clearWinnerMargin?: number;
  /** Score band below the top defining the shortlist to double-check.
   *  Default: `DEFAULT_SHORTLIST_BAND` (0.1). Recommended >=
   *  `clearWinnerMargin` so the shortlist is at least as wide as the
   *  winning gap (the function also guarantees the runner-up is shortlisted
   *  when there is no clear winner, so a smaller value is safe). */
  readonly shortlistBand?: number;
}

/** Finite score, or −Infinity for a malformed (NaN/+Infinity/−Infinity) one —
 *  so a bad embedder degrades that item to "ranked last", never corrupts the
 *  ordering. Note +Infinity is demoted too: a meaningless score is never a win. */
const finiteScore = (s: InfluenceScore): number => (Number.isFinite(s.score) ? s.score : -Infinity);

/** Total, NaN-free comparator (descending) — correctness does not rest on the
 *  engine's handling of a NaN comparator return for the all-malformed case. */
const byScoreDesc = (a: InfluenceScore, b: InfluenceScore): number => {
  const x = finiteScore(a);
  const y = finiteScore(b);
  return x > y ? -1 : x < y ? 1 : 0;
};

/**
 * Assess whether an influence ranking has a clear winner to trust as a lead,
 * or is too close to call and should be confirmed by ablation.
 *
 * Guarantees (relied on by the localizer): the returned `shortlist` always
 * contains `lead` when there is one, and — when there is NO clear winner and
 * there are ≥2 suspects — always contains the runner-up too (so ablation over
 * the shortlist covers the real culprit even if it ranked below an innocent).
 *
 * @param scores `scoreInfluence` output (any order — re-sorted defensively).
 *               Ids are assumed unique (as `scoreInfluence` enforces); the
 *               shortlist is de-duplicated defensively regardless.
 * @throws Error on negative or NaN options.
 */
export function rankingConfidence(
  scores: readonly InfluenceScore[],
  options: RankingConfidenceOptions = {},
): RankingConfidence {
  // strategy WINS over clearWinnerMargin; the default builds a margin strategy
  // (which validates its own threshold).
  const strategy =
    options.strategy ?? marginStrategy(options.clearWinnerMargin ?? DEFAULT_CLEAR_WINNER_MARGIN);
  const shortlistBand = nonNegative(
    'rankingConfidence: shortlistBand',
    options.shortlistBand ?? DEFAULT_SHORTLIST_BAND,
  );

  if (scores.length === 0) {
    return {
      clearWinner: false,
      margin: undefined,
      lead: undefined,
      shortlist: [],
      reason: 'No suspects to rank.',
    };
  }

  const ranked = [...scores].sort(byScoreDesc);
  const top = ranked[0];
  const topScore = finiteScore(top);

  if (ranked.length === 1) {
    return {
      clearWinner: true,
      margin: undefined,
      lead: top.id,
      shortlist: [top.id],
      reason: `Only one suspect "${top.id}" — clear by default (nothing to compare against); confirm by ablation for a causal claim.`,
    };
  }

  const secondScore = finiteScore(ranked[1]);

  // Clear winner, robust to malformed scores (framework invariants, NOT the
  // strategy's concern):
  //  - top itself malformed (e.g. all-malformed) → no clear winner, no margin.
  //  - clean finite top, malformed runner-up → unambiguous lead → clear winner
  //    (the inverse of suppressing it); no meaningful finite gap to report.
  //  - both finite → the pluggable STRATEGY decides, over all finite scores.
  let clearWinner: boolean;
  let margin: number | undefined;
  if (!Number.isFinite(topScore)) {
    clearWinner = false;
    margin = undefined;
  } else if (!Number.isFinite(secondScore)) {
    clearWinner = true;
    margin = undefined;
  } else {
    margin = topScore - secondScore;
    const finiteRanked = ranked.map(finiteScore).filter((x) => Number.isFinite(x));
    clearWinner = strategy.isClearWinner(finiteRanked);
  }

  // Shortlist = the band of FINITE scores within shortlistBand of a finite top.
  // Then enforce the guarantees: lead always present; when there is no clear
  // winner with ≥2 suspects, the runner-up is present too.
  const shortlist: string[] = [];
  const seen = new Set<string>();
  const add = (id: string) => {
    if (!seen.has(id)) {
      seen.add(id);
      shortlist.push(id);
    }
  };
  if (Number.isFinite(topScore)) {
    for (const s of ranked) {
      const sc = finiteScore(s);
      if (Number.isFinite(sc) && topScore - sc <= shortlistBand) add(s.id);
    }
  }
  add(top.id); // guarantee: lead always in the shortlist
  if (!clearWinner) add(ranked[1].id); // guarantee: no-clear-winner shortlist covers the runner-up

  const gap = margin === undefined ? 'n/a' : margin.toFixed(3);
  const reason = clearWinner
    ? margin === undefined
      ? `Clear winner [${strategy.name}]: "${top.id}" leads clearly (runner-up score unavailable). A clear lead is a similarity PROXY, not a proven cause — confirm by ablation.`
      : `Clear winner [${strategy.name}]: "${top.id}" leads (top-2 margin ${gap}). A clear lead is a similarity PROXY, not a proven cause — confirm by ablation.`
    : `Too close to call [${strategy.name}]: top-2 margin ${gap} — no suspect stands out by output similarity. Double-check the ${shortlist.length} shortlisted suspect(s) by ABLATION. Similarity scoring is blind to absence/crowding bugs (history truncation, context dilution), where the culprit need not resemble the answer; a flat top can also mean genuinely co-equal sources.`;

  return { clearWinner, margin, lead: top.id, shortlist, reason };
}
