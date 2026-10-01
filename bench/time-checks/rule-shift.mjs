/**
 * bench/time-checks/rule-shift.mjs — `RULE-shift.md` as code: the pause/shift follow-up verdict
 * (`time-rule-shift`), computed from the rows, never argued. Where this file and `RULE-shift.md`
 * disagree, the page wins and this file is fixed before any paid run reads it;
 * `test/bench/time-checks/rule-shift.test.ts` fails if the margins drift from the page's table.
 *
 * Rows are the T8 bench's (`metrics.mjs` · `readRun`) plus three fields this rule reads
 * (`shiftRowOf`): whether a request served the conclusion, whether the record holds a shifted
 * `period` row, and whether the model's final words open with the misread-as-the-person pattern.
 */

import { fisherGreater } from '../time/rule.mjs';
import { readRun } from './metrics.mjs';

export const RULE_ID = 'time-rule-shift (registered 2026-09-30)';

/** The two arms: the reference build (two-range line) and this branch (the conclusion). */
export const SHIFT_ARMS = Object.freeze(['before', 'after']);

/** The shift case and the two controls, from the T8 sheet (`cases.mjs` · `CASES`). */
export const SHIFT_CASE = 'lookback-after-pause';
export const CONTROL_CASES = Object.freeze(['c-lookback-hour', 'c-clamp-7d']);
export const SHIFT_CASES = Object.freeze([SHIFT_CASE, ...CONTROL_CASES]);

/** The registered margins — `RULE-shift.md`, "Margins". */
export const MARGINS = Object.freeze({
  alpha: 0.05,
  gain: 0.2,
  provocationFloor: 0.25,
  hedgeMargin: 0.1,
  completedMargin: 0.1,
  inputTokensRatio: 1.1,
  errorRate: 0.05,
  servedWhenShifted: 0.95,
});

/** The served conclusion's marker (`coverage/period.ts` · `shiftedConclusion`). */
export const CONCLUSION_MARK = 'so its result does not cover';

/**
 * The round-0 pattern: the model answering the library's line as if the person had corrected it.
 * Matched against the OPENING of the model's own final words only.
 */
export const MISREAD =
  /^\W*(?:you'?re (?:absolutely )?(?:right|correct)|you are (?:absolutely )?(?:right|correct)|good catch|my apologies|i apologi[sz]e for|i apologi[sz]e[.!—-]|thank(?:s| you) for (?:the |your |that )?(?:clarif|correct|confirm|catching|pointing))/i;

// ── rows ────────────────────────────────────────────────────────────────────

/** One saved run → one row: the T8 row and the fields this rule reads. */
export function shiftRowOf(raw) {
  const base = readRun(raw);
  const lines = (raw.requests ?? []).map((q) => q.timeLine).filter((l) => typeof l === 'string');
  const shiftedRow = (raw.rows ?? []).some((r) => r?.kind === 'period' && r.shifted !== undefined);
  const words = typeof raw.modelAnswer === 'string' ? raw.modelAnswer : raw.answer;
  return {
    ...base,
    servedConclusion: lines.some((l) => l.includes(CONCLUSION_MARK)),
    shiftedRow,
    laterCall: (raw.requests ?? []).length > 1,
    misread: typeof words === 'string' && MISREAD.test(words),
  };
}

// ── tallies ─────────────────────────────────────────────────────────────────

const tally = (rows, arm, pick, test) => {
  const set = rows.filter((r) => r.arm === arm && pick(r));
  const k = set.filter(test).length;
  return { k, n: set.length, share: set.length === 0 ? 0 : k / set.length };
};
const both = (rows, pick, test) => ({
  before: tally(rows, 'before', pick, test),
  after: tally(rows, 'after', pick, test),
});
const isShift = (r) => r.caseId === SHIFT_CASE;
const isControl = (r) => CONTROL_CASES.includes(r.caseId);

/** The numbers the rule and the report read. */
export function aggregateShift(rows) {
  const perArm = Object.fromEntries(
    SHIFT_ARMS.map((arm) => {
      const rs = rows.filter((r) => r.arm === arm);
      const calls = rs.reduce((a, r) => a + r.calls, 0);
      return [
        arm,
        {
          runs: rs.length,
          failed: rs.filter((r) => r.failed).length,
          calls,
          inputTokensPerCall: calls === 0 ? 0 : rs.reduce((a, r) => a + r.inputTokens, 0) / calls,
          usd: rs.reduce((a, r) => a + r.usd, 0),
          misread: rs.filter((r) => r.misread).length,
        },
      ];
    }),
  );
  const perCase = Object.fromEntries(
    SHIFT_CASES.map((id) => {
      const of = (r) => r.caseId === id;
      const answered = (r) => of(r) && r.reached && r.answered;
      return [
        id,
        {
          runs: both(rows, of, () => true),
          reached: both(rows, of, (r) => r.reached),
          answered: both(rows, of, (r) => r.answered),
          claimsPast: both(rows, answered, (r) => r.claimsPast === true),
          scoped: both(rows, answered, (r) => r.scoped),
          hedged: both(rows, answered, (r) => r.hedged),
          served: both(rows, of, (r) => r.servedConclusion),
          misread: both(rows, of, (r) => r.misread),
        },
      ];
    }),
  );
  return {
    perArm,
    perCase,
    claims: both(
      rows,
      (r) => isShift(r) && r.reached && r.answered,
      (r) => r.claimsPast === true,
    ),
    controlHedged: both(
      rows,
      (r) => isControl(r) && r.reached && r.answered,
      (r) => r.hedged,
    ),
    controlCompleted: both(rows, isControl, (r) => r.answered),
    served: tally(
      rows,
      'after',
      (r) => isShift(r) && r.shiftedRow && r.laterCall,
      (r) => r.servedConclusion,
    ),
    servedBefore: tally(
      rows,
      'before',
      () => true,
      (r) => r.servedConclusion,
    ),
  };
}

// ── the verdict ─────────────────────────────────────────────────────────────

const clause = (id, what, pass, detail) => ({ id, what, pass, detail });
const pct = (t) => `${t.k}/${t.n}`;

/**
 * The verdict over ONE interleaved invocation's rows. PASS only when every clause passes; FAIL
 * when one fails; NOT-MEASURABLE when a clause had nothing to count, or `before` did not provoke
 * (and none failed).
 */
export function judge(rows) {
  const arms = new Set(rows.map((r) => r.arm));
  if (!arms.has('before') || !arms.has('after'))
    throw new Error('the rule compares arms before and after from ONE interleaved invocation');
  const agg = aggregateShift(rows);
  const M = MARGINS;
  const clauses = [];

  // S1 — the primary: fewer claims past what was read on the shift case.
  const c = agg.claims;
  if (c.before.n === 0 || c.after.n === 0)
    clauses.push(
      clause(
        'S1',
        'claims past what was read on the shift case',
        undefined,
        'no answered shift run',
      ),
    );
  else if (c.before.share < M.provocationFloor)
    clauses.push(
      clause(
        'S1',
        'claims past what was read on the shift case',
        undefined,
        `before rate ${c.before.share.toFixed(3)} < ${
          M.provocationFloor
        }: the case did not provoke this model`,
      ),
    );
  else {
    // One-sided: fewer claims on `after` ⇔ more non-claims on `after`.
    const p = fisherGreater(c.after.n - c.after.k, c.after.n, c.before.n - c.before.k, c.before.n);
    const diff = c.before.share - c.after.share;
    clauses.push(
      clause(
        'S1',
        `claims past what was read on the shift case: after ≤ before − ${M.gain} and one-sided Fisher p < ${M.alpha}`,
        diff >= M.gain - 1e-12 && p < M.alpha,
        `after ${pct(c.after)} · before ${pct(c.before)} · difference ${diff.toFixed(
          3,
        )} · p ${p.toExponential(2)}`,
      ),
    );
  }

  // S2 — controls are not hedged.
  const h = agg.controlHedged;
  clauses.push(
    h.before.n === 0 || h.after.n === 0
      ? clause('S2', 'needless hedges on controls', undefined, 'no answered control')
      : clause(
          'S2',
          `needless hedges on controls: after ≤ before + ${M.hedgeMargin}`,
          h.after.share <= h.before.share + M.hedgeMargin + 1e-12,
          `after ${pct(h.after)} · before ${pct(h.before)}`,
        ),
  );

  // S3 — controls still complete.
  const k = agg.controlCompleted;
  clauses.push(
    k.before.n === 0 || k.after.n === 0
      ? clause('S3', 'controls complete', undefined, 'no control run')
      : clause(
          'S3',
          `answered controls: after ≥ before − ${M.completedMargin}`,
          k.after.share >= k.before.share - M.completedMargin - 1e-12,
          `after ${pct(k.after)} · before ${pct(k.before)}`,
        ),
  );

  // S4 — the token ceiling.
  const a = agg.perArm;
  clauses.push(
    a.before.calls === 0 || a.after.calls === 0
      ? clause('S4', 'input tokens per call', undefined, 'no call')
      : clause(
          'S4',
          `input tokens per call: after ≤ ${M.inputTokensRatio} × before`,
          a.after.inputTokensPerCall <= M.inputTokensRatio * a.before.inputTokensPerCall,
          `after ${a.after.inputTokensPerCall.toFixed(
            0,
          )} vs before ${a.before.inputTokensPerCall.toFixed(0)} (×${(
            a.after.inputTokensPerCall / a.before.inputTokensPerCall
          ).toFixed(3)})`,
        ),
  );

  // G1 — the harness ran.
  clauses.push(
    clause(
      'G1',
      `errors and stuck runs ≤ ${M.errorRate} of each arm`,
      SHIFT_ARMS.every((arm) => a[arm].runs > 0 && a[arm].failed / a[arm].runs <= M.errorRate),
      `before ${a.before.failed}/${a.before.runs} · after ${a.after.failed}/${a.after.runs}`,
    ),
  );

  // G2 — the arm was armed: the conclusion served where a shift held; never on `before`.
  const s = agg.served;
  clauses.push(
    s.n === 0
      ? clause(
          'G2',
          'the conclusion was served',
          undefined,
          'no after shift run with a shifted row and a later call',
        )
      : clause(
          'G2',
          `the conclusion served on ≥ ${M.servedWhenShifted} of after shift runs with a shifted row and a later call; 0 before runs`,
          s.share >= M.servedWhenShifted && agg.servedBefore.k === 0,
          `after ${pct(s)} · before ${pct(agg.servedBefore)}`,
        ),
  );

  const failed = clauses.some((x) => x.pass === false);
  const unmeasured = clauses.some((x) => x.pass === undefined);
  return {
    rule: RULE_ID,
    verdict: failed ? 'FAIL' : unmeasured ? 'NOT-MEASURABLE' : 'PASS',
    clauses,
  };
}

export function formatVerdict(v) {
  const lines = [
    `## Verdict — ${v.rule}: **${v.verdict}**`,
    '',
    '| clause | what | pass | detail |',
    '|---|---|---|---|',
  ];
  for (const c of v.clauses)
    lines.push(
      `| ${c.id} | ${c.what} | ${c.pass === undefined ? 'n/m' : c.pass ? 'yes' : 'NO'} | ${
        c.detail
      } |`,
    );
  return lines.join('\n');
}

/** The report's tables (reported, not judged). */
export function formatShiftReport(agg) {
  const cell = (t) => `${t.k}/${t.n}`;
  const lines = [
    '| | before | after |',
    '|---|---|---|',
    `| runs (failed) | ${agg.perArm.before.runs} (${agg.perArm.before.failed}) | ${agg.perArm.after.runs} (${agg.perArm.after.failed}) |`,
    `| input tokens per call | ${agg.perArm.before.inputTokensPerCall.toFixed(
      0,
    )} | ${agg.perArm.after.inputTokensPerCall.toFixed(0)} |`,
    `| answers misread as the person | ${agg.perArm.before.misread} | ${agg.perArm.after.misread} |`,
    `| spend | $${agg.perArm.before.usd.toFixed(4)} | $${agg.perArm.after.usd.toFixed(4)} |`,
    '',
    '| case | runs | reached | answered | claims past | scoped | hedged | served the conclusion | misread |',
    '|---|---|---|---|---|---|---|---|---|',
  ];
  for (const [id, c] of Object.entries(agg.perCase)) {
    const two = (t) => `${cell(t.before)} · ${cell(t.after)}`;
    lines.push(
      `| ${id} | ${two(c.runs)} | ${two(c.reached)} | ${two(c.answered)} | ${two(
        c.claimsPast,
      )} | ${two(c.scoped)} | ${two(c.hedged)} | ${two(c.served)} | ${two(c.misread)} |`,
    );
  }
  lines.push('', 'Each cell: before · after.');
  return lines.join('\n');
}
