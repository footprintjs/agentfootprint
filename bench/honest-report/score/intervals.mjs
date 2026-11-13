/**
 * bench/honest-report/score/intervals.mjs — rates over instances, their intervals, and the paired
 * comparison (RULE.md § 8, § 10).
 *
 * The unit is the instance, nested in its base task: an instance's value is the mean of its
 * runs, a rate is the mean over instances. The interval is a two-stage bootstrap — base tasks
 * drawn with replacement, then instances within each drawn base task — seeded, so the same rows
 * always print the same interval. A paired comparison works on per-instance differences (the
 * same instance under both builds) and adds an exact sign-flip test over the base tasks' mean
 * differences, whose smallest possible p is 2 / 2^k.
 *
 * Example: `rate(units)` with 12 base tasks of 12 instances each, every value 0.5 →
 * `{ value: 0.5, lo: 0.5, hi: 0.5, instances: 144, baseTasks: 12 }`.
 */

import { prng } from '../../inputs/labels.mjs';
import { PROPOSED } from '../rule-tables.mjs';

export const BOOTSTRAP_SEED = 20261113;

/**
 * Instance units from rows: `{ instanceId, baseTask, value }`, value = the mean of `indicator`
 * over the instance's rows. Rows for which `indicator` returns undefined are left out.
 */
export function unitsOf(rows, indicator) {
  const by = new Map();
  for (const r of rows) {
    const v = indicator(r);
    if (v === undefined) continue;
    const u = by.get(r.instanceId) ?? { instanceId: r.instanceId, baseTask: r.baseTask, sum: 0, n: 0 };
    u.sum += v ? 1 : 0;
    u.n += 1;
    by.set(r.instanceId, u);
  }
  return [...by.values()].map((u) => ({ instanceId: u.instanceId, baseTask: u.baseTask, value: u.sum / u.n, runs: u.n }));
}

const mean = (xs) => (xs.length === 0 ? NaN : xs.reduce((a, b) => a + b, 0) / xs.length);

function groupByTask(units) {
  const g = new Map();
  for (const u of units) g.set(u.baseTask, [...(g.get(u.baseTask) ?? []), u]);
  return [...g.values()];
}

/** The two-stage bootstrap's percentile interval of the mean of `value` over units. */
export function bootstrap(units, draws = PROPOSED.bootstrapDraws, seed = BOOTSTRAP_SEED) {
  const groups = groupByTask(units);
  if (groups.length === 0) return { lo: NaN, hi: NaN };
  const rng = prng(seed);
  const stats = [];
  for (let b = 0; b < draws; b += 1) {
    const values = [];
    for (let t = 0; t < groups.length; t += 1) {
      const g = groups[Math.floor(rng() * groups.length)];
      for (let i = 0; i < g.length; i += 1) values.push(g[Math.floor(rng() * g.length)].value);
    }
    stats.push(mean(values));
  }
  stats.sort((a, b) => a - b);
  return { lo: stats[Math.floor(0.025 * (draws - 1))], hi: stats[Math.ceil(0.975 * (draws - 1))] };
}

/** A rate with its interval and the counts it rests on. */
export function rate(units) {
  const value = mean(units.map((u) => u.value));
  return { value, ...bootstrap(units), instances: units.length, baseTasks: groupByTask(units).length, runs: units.reduce((a, u) => a + u.runs, 0) };
}

/** Exact two-sided sign-flip p over `diffs` (one per base task): share of sign assignments with |sum| ≥ observed. */
export function signFlip(diffs) {
  const k = diffs.length;
  if (k === 0) return { p: NaN, pFloor: NaN, k };
  if (k > 20) throw new Error(`sign flip is exact up to 20 base tasks; saw ${k}`);
  const observed = Math.abs(diffs.reduce((a, b) => a + b, 0));
  let atLeast = 0;
  for (let mask = 0; mask < 2 ** k; mask += 1) {
    let s = 0;
    for (let i = 0; i < k; i += 1) s += mask & (1 << i) ? -diffs[i] : diffs[i];
    if (Math.abs(s) >= observed - 1e-12) atLeast += 1;
  }
  return { p: atLeast / 2 ** k, pFloor: 2 / 2 ** k, k };
}

/**
 * The paired comparison of two unit lists (before, after) on the instances both hold:
 * after − before per instance; bootstrap interval; sign flip over base-task mean differences.
 */
export function paired(before, after) {
  const a = new Map(after.map((u) => [u.instanceId, u]));
  const diffs = before.filter((u) => a.has(u.instanceId)).map((u) => ({ instanceId: u.instanceId, baseTask: u.baseTask, value: a.get(u.instanceId).value - u.value, runs: 1 }));
  const byTask = groupByTask(diffs).map((g) => mean(g.map((u) => u.value)));
  return { diff: mean(diffs.map((d) => d.value)), ...bootstrap(diffs), ...signFlip(byTask), instances: diffs.length, baseTasks: byTask.length };
}

/** RULE.md § 10's decision for a paired comparison. */
export function decide(cmp, { notMeasurable } = {}) {
  if (notMeasurable) return 'not measurable';
  if (!Number.isFinite(cmp.diff)) return 'not measurable';
  const excludesZero = cmp.lo > 0 || cmp.hi < 0;
  const bigEnough = Math.abs(cmp.diff) >= PROPOSED.smallestDifference - 1e-12;
  const signFlipOk = cmp.k < PROPOSED.signFlipNeededFromBaseTasks || cmp.p < 0.05;
  return excludesZero && bigEnough && signFlipOk ? 'moved' : 'not detected';
}

/**
 * Holm's step-down adjustment of p values (same order out as in), for a family of `m` (at least
 * the p values given: a family member not computed in this folder still counts in `m`).
 */
export function holm(ps, m = ps.length) {
  const order = ps.map((p, i) => ({ p, i })).sort((x, y) => x.p - y.p);
  const out = new Array(ps.length);
  let running = 0;
  order.forEach(({ p, i }, j) => {
    running = Math.max(running, Math.min(1, (m - j) * p));
    out[i] = running;
  });
  return out;
}
