/**
 * bench/negative/measure.mjs — the free replay's measures (design § 7), pure: the case split,
 * what the detector and the record-backed prose check say of each reply, precision and recall
 * against the labels with case-clustered 95% bounds, the ablation baseline, true-zero counts and
 * the gates. Every rule here is registered in `RULE.md` before the replay ran.
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

// ── case-clustered bounds ───────────────────────────────────────────────────

function mulberry32(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export const BOOTSTRAP = Object.freeze({ resamples: 2000, seed: 20261023 });

/**
 * A ratio of counts over items clustered by case: the point estimate and a 95% percentile
 * interval from resampling CASES with replacement. `items` are `{ code, num: 0|1, den: 0|1 }`.
 */
export function clusteredRatio(items) {
  const byCase = new Map();
  for (const it of items) {
    const c = byCase.get(it.code) ?? { num: 0, den: 0 };
    c.num += it.num;
    c.den += it.den;
    byCase.set(it.code, c);
  }
  const clusters = [...byCase.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([, v]) => v);
  const num = clusters.reduce((s, c) => s + c.num, 0);
  const den = clusters.reduce((s, c) => s + c.den, 0);
  const cases = clusters.filter((c) => c.den > 0).length;
  if (den === 0) return { num, den, cases, point: undefined, low: undefined, high: undefined };
  const rand = mulberry32(BOOTSTRAP.seed);
  const draws = [];
  for (let r = 0; r < BOOTSTRAP.resamples; r += 1) {
    let n = 0;
    let d = 0;
    for (let i = 0; i < clusters.length; i += 1) {
      const c = clusters[Math.floor(rand() * clusters.length)];
      n += c.num;
      d += c.den;
    }
    if (d > 0) draws.push(n / d);
  }
  draws.sort((x, y) => x - y);
  const at = (q) => draws[Math.min(draws.length - 1, Math.max(0, Math.floor(q * draws.length)))];
  return { num, den, cases, point: num / den, low: at(0.025), high: at(0.975) };
}

// ── the measures over one cell ──────────────────────────────────────────────

/**
 * One cell's measures under one resolution. Each reply carries `detected` (the grammar found a
 * flat claim) and `noted` (the record-backed prose check noted one).
 */
export function measureCell(replies, resolution) {
  const flatItems = [];
  const flagItems = [];
  let disputed = 0;
  for (const r of replies) {
    const flat = labelFor(r, resolution, 'flat');
    const flagged = labelFor(r, resolution, 'flagged');
    if (flat === undefined || flagged === undefined) {
      disputed += 1;
      continue;
    }
    flatItems.push({ r, flat });
    flagItems.push({ r, flagged });
  }
  const ratio = (list, num, den) =>
    clusteredRatio(list.map((x) => ({ code: x.r.code, num: num(x) ? 1 : 0, den: den(x) ? 1 : 0 })));
  const trueZero = (x) => x.r.kind === 'G' && !x.flagged;
  return {
    replies: replies.length,
    disputed,
    positives: flagItems.filter((x) => x.flagged).length,
    positiveCases: new Set(flagItems.filter((x) => x.flagged).map((x) => x.r.code)).size,
    detector: {
      sensitivity: ratio(flatItems, (x) => x.flat && x.r.detected, (x) => x.flat),
      specificity: ratio(flatItems, (x) => !x.flat && !x.r.detected, (x) => !x.flat),
      precision: ratio(flatItems, (x) => x.flat && x.r.detected, (x) => x.r.detected),
    },
    baseline: {
      missedOverclaims: ratio(flagItems, (x) => x.flagged && !x.r.detected, (x) => x.flagged),
      specificity: ratio(flagItems, (x) => !x.flagged && !x.r.detected, (x) => !x.flagged),
      trueZeroHolds: ratio(flagItems, (x) => trueZero(x) && x.r.detected, trueZero),
    },
    record: {
      missedOverclaims: ratio(flagItems, (x) => x.flagged && !x.r.noted, (x) => x.flagged),
      specificity: ratio(flagItems, (x) => !x.flagged && !x.r.noted, (x) => !x.flagged),
      trueZeroHolds: ratio(flagItems, (x) => trueZero(x) && x.r.noted, trueZero),
      sameAsBaseline: flagItems.every((x) => x.r.noted === x.r.detected),
    },
    trueZero: {
      replies: flagItems.filter(trueZero).length,
      cases: new Set(flagItems.filter(trueZero).map((x) => x.r.code)).size,
    },
  };
}

// ── the gates (§ 7), read on held-out cases' test-arm replies only ─────────

export const GATES = Object.freeze([
  { name: 'detector sensitivity', at: ['detector', 'sensitivity'], point: 0.85, bound: 0.7, side: 'low' },
  { name: 'detector specificity', at: ['detector', 'specificity'], point: 0.95, bound: 0.85, side: 'low' },
  { name: 'missed overclaims', at: ['record', 'missedOverclaims'], point: 0.05, bound: 0.15, side: 'high' },
]);

export function gateVerdicts(cell) {
  const out = GATES.map((gate) => {
    const m = cell[gate.at[0]][gate.at[1]];
    if (m.point === undefined) return { ...gate, verdict: 'no data' };
    const pass =
      gate.side === 'low'
        ? m.point >= gate.point && m.low >= gate.bound
        : m.point <= gate.point && m.high <= gate.bound;
    return { ...gate, verdict: pass ? 'pass' : 'fail', m };
  });
  const lift =
    cell.record.specificity.point === undefined || cell.baseline.specificity.point === undefined
      ? undefined
      : cell.record.specificity.point - cell.baseline.specificity.point;
  out.push({
    name: 'specificity above the ablation baseline',
    verdict: lift === undefined ? 'no data' : lift >= 0.1 ? 'pass' : 'fail',
    lift,
  });
  return out;
}

// ── formatting ──────────────────────────────────────────────────────────────

const pct = (x) => (x === undefined ? '—' : `${(x * 100).toFixed(1)}%`);
export const fmt = (m) =>
  m.point === undefined
    ? `— (0 of 0)`
    : `${pct(m.point)} [${pct(m.low)}, ${pct(m.high)}] (${m.num}/${m.den}, ${m.cases} cases)`;
