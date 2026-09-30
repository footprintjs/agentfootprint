/**
 * bench/time/rule.mjs — `RULE.md` as code: the step-T6b verdict, computed from the rows
 * (`metrics.mjs` · `readRun`), never argued. Where this file and `RULE.md` disagree, the page
 * wins and this file is fixed before any paid run reads it; `test/bench/time/rule.test.ts` fails
 * if the margins drift from the page's table.
 */

import { aggregate } from './metrics.mjs';

export const RULE_ID = 'time-rule-t6b (registered 2026-09-30)';

/** The registered margins — `RULE.md`, "Margins". */
export const MARGINS = Object.freeze({
  alpha: 0.05,
  gain: 0.15,
  controlTimeAsks: 0,
  controlReadingRows: 0,
  controlTimeLines: 0,
  completedMargin: 0.1,
  askMargin: 0.1,
  hurtMargin: 0.1,
  inputTokensRatio: 1.15,
  saidRows: 0,
  errorRate: 0.02,
});

// ── Fisher's exact test, one-sided ───────────────────────────────────────────

function logChoose(n, k) {
  if (k < 0 || k > n) return -Infinity;
  let s = 0;
  for (let i = 1; i <= k; i += 1) s += Math.log(n - k + i) - Math.log(i);
  return s;
}

/**
 * P(X ≥ a) for X hypergeometric with the table's margins: `a` of `n1` on-arm runs right, `c` of
 * `n0` off-arm runs right — the chance of at least this many right on-arm runs if the arm did
 * nothing. 1 when nothing varies.
 */
export function fisherGreater(a, n1, c, n0) {
  const N = n1 + n0;
  const K = a + c;
  if (N === 0) return 1;
  const denom = logChoose(N, n1);
  let p = 0;
  for (let x = a; x <= Math.min(K, n1); x += 1) {
    p += Math.exp(logChoose(K, x) + logChoose(N - K, n1 - x) - denom);
  }
  return Math.min(1, p);
}

// ── the verdict ──────────────────────────────────────────────────────────────

const clause = (id, what, pass, detail) => ({ id, what, pass, detail });

/**
 * The step-T6b verdict over ONE interleaved invocation's rows. PASS only when every clause
 * passes; FAIL when one fails; NOT-MEASURABLE when a clause had nothing to count (and none
 * failed).
 */
export function judge(rows) {
  const arms = new Set(rows.map((r) => r.arm));
  if (!arms.has('off') || !arms.has('on')) {
    throw new Error('the rule compares arms off and on from ONE interleaved invocation');
  }
  const agg = aggregate(rows);
  const M = MARGINS;
  const clauses = [];

  // T1 — the gain on readable phrases.
  const rd = agg.perCell.readable.right;
  if (rd.on.n === 0 || rd.off.n === 0) clauses.push(clause('T1', 'right window on readable phrases', undefined, 'no readable run'));
  else {
    const diff = rd.on.share - rd.off.share;
    const p = fisherGreater(rd.on.k, rd.on.n, rd.off.k, rd.off.n);
    clauses.push(
      clause(
        'T1',
        `right window on readable phrases: on − off ≥ ${M.gain} and one-sided Fisher p < ${M.alpha}`,
        diff >= M.gain && p < M.alpha,
        `off ${rd.off.k}/${rd.off.n}, on ${rd.on.k}/${rd.on.n}, difference ${diff.toFixed(3)}, p = ${p.toExponential(2)}`,
      ),
    );
  }

  // T2 — no time words, no confirmation (arm on).
  const ct = agg.perCell.control;
  if (ct.timeAsk.on.n === 0) clauses.push(clause('T2', 'controls raise no confirmation', undefined, 'no control run'));
  else
    clauses.push(
      clause(
        'T2',
        'controls, arm on: no time ask, no reading row, no time line',
        ct.timeAsk.on.k <= M.controlTimeAsks &&
          ct.readingRow.on.k <= M.controlReadingRows &&
          ct.timeLine.on.k <= M.controlTimeLines,
        `time asks ${ct.timeAsk.on.k}/${ct.timeAsk.on.n}, reading rows ${ct.readingRow.on.k}/${ct.readingRow.on.n}, ` +
          `time lines ${ct.timeLine.on.k}/${ct.timeLine.on.n}`,
      ),
    );

  // T3 — controls are not harmed: completion and needless asks.
  if (ct.completed.on.n === 0 || ct.completed.off.n === 0)
    clauses.push(clause('T3', 'controls not harmed', undefined, 'no control run in an arm'));
  else {
    const dc = ct.completed.on.share - ct.completed.off.share;
    const da = ct.anyAsk.on.share - ct.anyAsk.off.share;
    clauses.push(
      clause(
        'T3',
        `controls: completion on ≥ off − ${M.completedMargin}; any ask on ≤ off + ${M.askMargin}`,
        dc >= -M.completedMargin && da <= M.askMargin,
        `completion off ${ct.completed.off.k}/${ct.completed.off.n}, on ${ct.completed.on.k}/${ct.completed.on.n}; ` +
          `any ask off ${ct.anyAsk.off.k}/${ct.anyAsk.off.n}, on ${ct.anyAsk.on.k}/${ct.anyAsk.on.n}`,
      ),
    );
  }

  // T4 — unreadable phrases and the future date are not harmed.
  const hurt = ['unreadable', 'future'].reduce(
    (acc, cell) => {
      const t = agg.perCell[cell].right;
      return { off: { k: acc.off.k + t.off.k, n: acc.off.n + t.off.n }, on: { k: acc.on.k + t.on.k, n: acc.on.n + t.on.n } };
    },
    { off: { k: 0, n: 0 }, on: { k: 0, n: 0 } },
  );
  if (hurt.on.n === 0 || hurt.off.n === 0) clauses.push(clause('T4', 'unreadable and future not harmed', undefined, 'no run'));
  else {
    const d = hurt.on.k / hurt.on.n - hurt.off.k / hurt.off.n;
    clauses.push(
      clause(
        'T4',
        `unreadable phrases and the future date: right on ≥ off − ${M.hurtMargin}`,
        d >= -M.hurtMargin,
        `off ${hurt.off.k}/${hurt.off.n}, on ${hurt.on.k}/${hurt.on.n}, difference ${d.toFixed(3)}`,
      ),
    );
  }

  // T5 — the tokens-per-call ceiling.
  const t = agg.tokens;
  if (t.on.perCall === undefined || t.off.perCall === undefined)
    clauses.push(clause('T5', 'tokens per call', undefined, 'no model call'));
  else
    clauses.push(
      clause(
        'T5',
        `input tokens per model call: on ≤ ${M.inputTokensRatio} × off`,
        t.on.perCall <= M.inputTokensRatio * t.off.perCall,
        `off ${t.off.perCall.toFixed(1)}, on ${t.on.perCall.toFixed(1)}, ratio ${(t.on.perCall / t.off.perCall).toFixed(3)}`,
      ),
    );

  // T6 — never filed as said (the owner's decision).
  clauses.push(
    clause('T6', 'arm on: no row files a chat reading as said', agg.said.on.k <= M.saidRows, `runs with a said row: ${agg.said.on.k}`),
  );

  // G1 — the harness and the library ran: errors and stuck runs.
  const e = agg.errors;
  clauses.push(
    clause(
      'G1',
      `errors or stuck runs ≤ ${M.errorRate} of each arm`,
      e.off.k <= M.errorRate * e.off.n && e.on.k <= M.errorRate * e.on.n,
      `off ${e.off.k}/${e.off.n}, on ${e.on.k}/${e.on.n}`,
    ),
  );

  // G2 — the arm was armed: every readable on-arm run filed a reading.
  const armed = agg.perCell.readable.readingRow.on;
  clauses.push(
    clause('G2', 'arm on: every readable run filed a time-reading row', armed.n > 0 && armed.k === armed.n, `${armed.k}/${armed.n}`),
  );

  const failed = clauses.filter((c) => c.pass === false);
  const unmeasured = clauses.filter((c) => c.pass === undefined);
  const verdict = failed.length > 0 ? 'FAIL' : unmeasured.length > 0 ? 'NOT-MEASURABLE' : 'PASS';
  return { rule: RULE_ID, verdict, clauses };
}

/** The verdict as Markdown. */
export function formatVerdict(v) {
  const mark = (p) => (p === true ? 'pass' : p === false ? '**FAIL**' : 'not measurable');
  return [
    `## Verdict — ${v.rule}: **${v.verdict}**`,
    '',
    '| clause | what | result | numbers |',
    '|---|---|---|---|',
    ...v.clauses.map((c) => `| ${c.id} | ${c.what} | ${mark(c.pass)} | ${c.detail} |`),
  ].join('\n');
}
