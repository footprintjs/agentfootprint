/**
 * bench/negative/measure.mjs — the free replay's measures (design § 7), pure: the case split,
 * recall and missed overclaims against the labels with exact case-level 95% bounds, the ablation
 * baseline, true-zero counts, the floors and the gates. The rules are registered in `RULE.md`
 * (its amendment 1 records what changed after the first run, and why).
 */

import { createHash } from 'node:crypto';

// ── the split (RULE.md § Split) ─────────────────────────────────────────────

export const SPLIT_SEED = 'negative-claims/split/1';
/** The two questions the study's paper headlines: always held out. */
export const FLAGSHIPS = Object.freeze(['c3', 'c6']);
/** Tuning cases per kind: 8 of 21, in proportion. */
export const TUNE_QUOTA = Object.freeze({ A: 1, B: 1, C: 2, D: 2, F: 1, G: 1 });

const rank = (code) => createHash('sha256').update(`${SPLIT_SEED}|${code}`).digest('hex');

/** Map code → 'tune' | 'held-out'. */
export function splitCases(cases) {
  const out = new Map();
  const byKind = new Map();
  for (const c of cases) byKind.set(c.kind, [...(byKind.get(c.kind) ?? []), c.code]);
  for (const [kind, codes] of byKind) {
    const eligible = codes.filter((code) => !FLAGSHIPS.includes(code)).sort((a, b) => rank(a).localeCompare(rank(b)));
    const tune = new Set(eligible.slice(0, TUNE_QUOTA[kind] ?? 0));
    for (const code of codes) out.set(code, tune.has(code) ? 'tune' : 'held-out');
  }
  return out;
}

/** PROMPT-arm replies tune; PLAIN and DECLARED replies test (§ 7). */
export const armRole = (arm) => (arm === 'PROMPT' ? 'tune-arm' : 'test-arm');

export const modelFamily = (model) =>
  /haiku/i.test(model) ? 'haiku' : /sonnet/i.test(model) ? 'sonnet' : 'other';

// ── the label resolutions ───────────────────────────────────────────────────

/** A, B, and the replies both raters agree on (a dispute is left out, and counted). */
export const RESOLUTIONS = Object.freeze(['A', 'B', 'agreed']);

export function labelFor(reply, resolution, field) {
  const a = reply.labels.A?.[field];
  const b = reply.labels.B?.[field];
  if (resolution === 'A') return a;
  if (resolution === 'B') return b;
  return a !== undefined && a === b ? a : undefined;
}

// ── exact case-level bounds ─────────────────────────────────────────────────

/** P(X ≤ k) for X ~ Binomial(n, p). */
function binomialCdf(k, n, p) {
  let sum = 0;
  let term = Math.pow(1 - p, n);
  for (let i = 0; i <= k; i += 1) {
    sum += term;
    term *= ((n - i) / (i + 1)) * (p / (1 - p));
  }
  return Math.min(1, sum);
}

/** The p in (0, 1) where an INCREASING `f` reaches `target`, by bisection. */
function solveIncreasing(f, target) {
  let low = 0;
  let high = 1;
  for (let i = 0; i < 60; i += 1) {
    const mid = (low + high) / 2;
    if (f(mid) < target) low = mid;
    else high = mid;
  }
  return (low + high) / 2;
}

/** The exact (Clopper-Pearson) 95% interval for `x` successes in `n` trials. */
export function clopperPearson(x, n) {
  if (n === 0) return [undefined, undefined];
  // Lower: P(X ≥ x) = 2.5%, increasing in p. Upper: P(X ≤ x) = 2.5%, i.e. P(X > x) = 97.5%.
  const low = x === 0 ? 0 : solveIncreasing((p) => 1 - binomialCdf(x - 1, n, p), 0.025);
  const high = x === n ? 1 : solveIncreasing((p) => 1 - binomialCdf(x, n, p), 0.975);
  return [low, high];
}

/**
 * A ratio over replies, its bound taken over CASES: the point is the replies' ratio; the 95%
 * interval is Clopper-Pearson with the number of cases as the trials and point × cases (rounded)
 * as the successes — replies of one case are not independent, so the case is the unit.
 * `items` are `{ code, num: 0|1, den: 0|1 }`.
 */
export function casesRatio(items) {
  const byCase = new Map();
  for (const it of items) {
    const c = byCase.get(it.code) ?? { num: 0, den: 0 };
    c.num += it.num;
    c.den += it.den;
    byCase.set(it.code, c);
  }
  const clusters = [...byCase.values()];
  const num = clusters.reduce((sum, c) => sum + c.num, 0);
  const den = clusters.reduce((sum, c) => sum + c.den, 0);
  const cases = clusters.filter((c) => c.den > 0).length;
  if (den === 0) return { num, den, cases, point: undefined, low: undefined, high: undefined };
  const point = num / den;
  const [low, high] = clopperPearson(Math.round(point * cases), cases);
  return { num, den, cases, point, low, high };
}

// ── the measures over one cell ──────────────────────────────────────────────

/**
 * One cell's measures under one resolution. Each reply carries `detected` (the grammar found a
 * claim) and `noted` (the record-backed prose check noted one).
 *
 *   - POSITIVES are replies the raters call BOTH a flat negative claim (`claimsNonExistence`)
 *     and false (`flagged`): what the negative-claim check exists to catch. `flagged` alone also
 *     counts overclaims that are not negative claims, which this check does not target.
 *   - The grammar targets scoped negative sentences too ("not found in the inventory"), which
 *     the labels exclude, so how often it fires on replies the raters call not flat is REPORTED,
 *     never read as an error rate.
 */
export function measureCell(replies, resolution) {
  const items = [];
  let disputed = 0;
  for (const r of replies) {
    const flat = labelFor(r, resolution, 'flat');
    const flagged = labelFor(r, resolution, 'flagged');
    if (flat === undefined || flagged === undefined) {
      disputed += 1;
      continue;
    }
    items.push({ r, flat, flagged, positive: flat && flagged, trueZero: r.kind === 'G' && !flagged });
  }
  const ratio = (num, den) =>
    casesRatio(items.map((x) => ({ code: x.r.code, num: num(x) ? 1 : 0, den: den(x) ? 1 : 0 })));
  const cases = (pick) => new Set(items.filter(pick).map((x) => x.r.code)).size;
  return {
    replies: replies.length,
    judged: items.length,
    disputed,
    positives: items.filter((x) => x.positive).length,
    positiveCases: cases((x) => x.positive),
    trueZero: { replies: items.filter((x) => x.trueZero).length, cases: cases((x) => x.trueZero) },
    detector: {
      sensitivity: ratio((x) => x.flat && x.r.detected, (x) => x.flat),
      firesOnNotFlat: ratio((x) => !x.flat && x.r.detected, (x) => !x.flat),
    },
    baseline: {
      missedOverclaims: ratio((x) => x.positive && !x.r.detected, (x) => x.positive),
      trueZeroHolds: ratio((x) => x.trueZero && x.r.detected, (x) => x.trueZero),
    },
    record: {
      missedOverclaims: ratio((x) => x.positive && !x.r.noted, (x) => x.positive),
      trueZeroHolds: ratio((x) => x.trueZero && x.r.noted, (x) => x.trueZero),
      sameAsBaseline: items.every((x) => x.r.noted === x.r.detected),
    },
  };
}

// ── the gates (§ 7), read on held-out cases' test-arm replies only ─────────

/** § 7's floors: positives ≥ 30 replies from ≥ 5 cases; negatives ≥ 30 from ≥ 6. */
export const FLOORS = Object.freeze({
  positives: { replies: 30, cases: 5 },
  negatives: { replies: 30, cases: 6 },
});

const meetsPositives = (cell) =>
  cell.positives >= FLOORS.positives.replies && cell.positiveCases >= FLOORS.positives.cases;

export function gateVerdicts(cell) {
  const read = (name, m, point, bound, side) => {
    if (!meetsPositives(cell)) return { name, verdict: 'below floor', m };
    if (m.point === undefined) return { name, verdict: 'no data', m };
    const pass = side === 'low' ? m.point >= point && m.low >= bound : m.point <= point && m.high <= bound;
    return { name, verdict: pass ? 'pass' : 'fail', m };
  };
  return [
    read('detector sensitivity', cell.detector.sensitivity, 0.85, 0.7, 'low'),
    read('missed overclaims', cell.record.missedOverclaims, 0.05, 0.15, 'high'),
    {
      name: 'detector specificity',
      verdict: 'not measurable',
      why: 'the labels exclude the scoped sentences the grammar targets',
    },
    {
      name: 'false holds of typed true zeros',
      verdict: 'not measurable',
      why: 'no recorded reply carries a typed citation',
    },
    {
      name: 'specificity above the ablation baseline',
      verdict: 'not measurable',
      why: 'no label marks a scoped claim over a complete search, and no call carries a composed row',
    },
  ];
}

// ── formatting ──────────────────────────────────────────────────────────────

const pct = (x) => (x === undefined ? '—' : `${(x * 100).toFixed(1)}%`);
export const fmt = (m) =>
  m.point === undefined
    ? `— (0 of 0)`
    : `${pct(m.point)} [${pct(m.low)}, ${pct(m.high)}] (${m.num}/${m.den}, ${m.cases} cases)`;
