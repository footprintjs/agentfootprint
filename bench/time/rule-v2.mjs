/**
 * bench/time/rule-v2.mjs — `RULE-v2.md` as code: the `time-rule-t6b-v2` verdict, computed from
 * the rows, never argued. Where this file and `RULE-v2.md` disagree, the page wins and this file
 * is fixed before any paid run reads it; `test/bench/time/rule-v2.test.ts` fails if the margins
 * drift from the page's table.
 *
 * v2 is v1 (`rule.mjs`, frozen, untouched) with ONE clause split: v1's T2 counted ANY late time
 * line on an on-arm control, and the run clock (time G16) now opens that line on every request
 * by design. So T2 becomes T2a (no time STEERING on controls) and T2b (a clock-only line is
 * allowed, bounded by T5 and the new T7: no answer misreads it as the person). Every other clause
 * is v1's own, computed by v1's `judge` — not a copy — so the two cannot drift.
 */

import { MISREAD } from '../time-checks/rule-shift.mjs';
import { readRun } from './metrics.mjs';
import { MARGINS as V1_MARGINS, judge as judgeV1 } from './rule.mjs';

export const RULE_ID = 'time-rule-t6b-v2 (registered 2026-10-01)';

/** The registered margins — `RULE-v2.md`, "Margins". v1's, with T2's line count replaced. */
export const MARGINS = Object.freeze({
  alpha: V1_MARGINS.alpha,
  gain: V1_MARGINS.gain,
  controlTimeAsks: V1_MARGINS.controlTimeAsks,
  controlReadingRows: V1_MARGINS.controlReadingRows,
  controlSteeringLines: 0,
  controlMisreads: 0,
  completedMargin: V1_MARGINS.completedMargin,
  askMargin: V1_MARGINS.askMargin,
  hurtMargin: V1_MARGINS.hurtMargin,
  inputTokensRatio: V1_MARGINS.inputTokensRatio,
  saidRows: V1_MARGINS.saidRows,
  errorRate: V1_MARGINS.errorRate,
});

// ── the served line's parts ─────────────────────────────────────────────────

/** The run clock sentence (`arguments/serve.ts` · `clockSentence`) — it carries no full stop inside. */
const CLOCK_SENTENCE = /^This turn's time: [^.]*\.(?:\s+|$)/;

/**
 * What a served time line says BESIDES the run clock: the line with its opening note (who says
 * it, `[…]`) and its clock sentence taken off, trimmed. Empty → a clock-only line. Anything left —
 * a settled, pending, unread, refused, limit or control part — is STEERING. Read by position and
 * the clock sentence's own words; nothing else in the line is named, so a steering part this
 * file has never seen still counts as steering.
 *
 * @example
 * steeringOf("[A note …] This turn's time: Friday 2026-10-09 09:00 America/Los_Angeles (UTC-07:00).") // ''
 * steeringOf("[A note …] This turn's time: … . The window for “yesterday” is not settled yet: …")     // 'The window …'
 */
export function steeringOf(line) {
  let rest = String(line).trim();
  if (rest.startsWith('[')) {
    const end = rest.indexOf(']');
    rest = end < 0 ? rest : rest.slice(end + 1).trim();
  }
  return rest.replace(CLOCK_SENTENCE, '').trim();
}

/** One saved run → one row: v1's row (`metrics.mjs` · `readRun`) and the three fields v2 reads. */
export function v2RowOf(raw) {
  const lines = (raw.requests ?? []).map((q) => q.timeLine).filter((l) => typeof l === 'string');
  const steering = lines.filter((l) => steeringOf(l).length > 0).length;
  return {
    ...readRun(raw),
    steeringLines: steering,
    clockOnlyLines: lines.length - steering,
    misread: typeof raw.answer === 'string' && MISREAD.test(raw.answer),
  };
}

// ── the verdict ─────────────────────────────────────────────────────────────

const clause = (id, what, pass, detail) => ({ id, what, pass, detail });

/** Counts over rows matching `pick`. */
const count = (rows, pick, test) => {
  const r = rows.filter(pick);
  return { k: r.filter(test).length, n: r.length };
};

/**
 * The v2 verdict over ONE interleaved invocation's rows (`v2RowOf`). PASS only when every clause
 * passes; FAIL when one fails; NOT-MEASURABLE when a clause had nothing to count (and none failed).
 */
export function judge(rows) {
  const v1 = judgeV1(rows);
  const M = MARGINS;
  const of = (id) => v1.clauses.find((c) => c.id === id);
  const onControl = (r) => r.arm === 'on' && r.cell === 'control';

  // T2a — no time STEERING on no-time-word controls (arm on).
  const asks = count(rows, onControl, (r) => r.timeAsks > 0);
  const readings = count(rows, onControl, (r) => r.readingRows > 0);
  const steering = count(rows, onControl, (r) => r.steeringLines > 0);
  const t2a =
    asks.n === 0
      ? clause('T2a', 'controls carry no time steering', undefined, 'no control run')
      : clause(
          'T2a',
          'controls, arm on: no time ask, no reading row, no steering part in a served line',
          asks.k <= M.controlTimeAsks &&
            readings.k <= M.controlReadingRows &&
            steering.k <= M.controlSteeringLines,
          `time asks ${asks.k}/${asks.n}, reading rows ${readings.k}/${readings.n}, ` +
            `runs with a steering part ${steering.k}/${steering.n}`,
        );

  // T7 — no answer misreads the clock line as the person: control runs (either arm) whose
  // every served line was clock-only, so an opening misread is attributable to it.
  const clockOnly = (r) => r.cell === 'control' && r.clockOnlyLines > 0 && r.steeringLines === 0;
  const misread = count(rows, clockOnly, (r) => r.misread);
  const t7 =
    misread.n === 0
      ? clause('T7', 'no answer misreads the clock line as the person', undefined, 'no clock-only control run')
      : clause(
          'T7',
          'controls served only the clock line (both arms): no answer opens as if the person corrected it',
          misread.k <= M.controlMisreads,
          `misread openings ${misread.k}/${misread.n}`,
        );

  // T2b — the clock-only line is ALLOWED on every request; it holds when its bounds hold.
  const t5 = of('T5');
  const lines = rows
    .filter(onControl)
    .reduce((acc, r) => ({ k: acc.k + r.clockOnlyLines, n: acc.n + r.calls }), { k: 0, n: 0 });
  const bounds = [t5.pass, t7.pass];
  const t2b = clause(
    'T2b',
    'a clock-only line is allowed on every request, bounded by T5 and T7',
    bounds.includes(false) ? false : bounds.includes(undefined) ? undefined : true,
    `clock-only lines on on-arm control requests ${lines.k}/${lines.n}; T5 ${t5.pass ? 'pass' : t5.pass === false ? 'FAIL' : 'not measurable'}, ` +
      `T7 ${t7.pass ? 'pass' : t7.pass === false ? 'FAIL' : 'not measurable'}`,
  );

  const clauses = [];
  for (const c of v1.clauses) {
    if (c.id === 'T2') clauses.push(t2a, t2b);
    else clauses.push(c);
    if (c.id === 'T6') clauses.push(t7);
  }
  const failed = clauses.filter((c) => c.pass === false);
  const unmeasured = clauses.filter((c) => c.pass === undefined);
  const verdict = failed.length > 0 ? 'FAIL' : unmeasured.length > 0 ? 'NOT-MEASURABLE' : 'PASS';
  return { rule: RULE_ID, verdict, clauses };
}
