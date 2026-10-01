/**
 * bench/time/rule-unread.mjs — `RULE-unread.md` as code: the `time-rule-unread` verdict, computed
 * from the rows, never argued. Where this file and `RULE-unread.md` disagree, the page wins and
 * this file is fixed before any paid run reads it; `test/bench/time/rule-unread.test.ts` fails if
 * the margins drift from the page's table.
 *
 * The question: does the unread-words line (`arguments/serve.ts` · `unreadSentence` — the
 * library's conclusion and the ONE next step first) make the library's free-entry time ask OPEN
 * on words the reader could not read, against the released line (arm `before`), without harming
 * the controls? Every label is read from the saved record (`harness.mjs` · `runCase`); no model
 * judges.
 */

export const RULE_ID = 'time-rule-unread (registered 2026-10-01)';

/** The arms: the released build (9.134.2) and this branch's build — both T6b's arm `on`. */
export const UNREAD_ARMS = Object.freeze(['before', 'after']);

/** The rule's cases (`cases.mjs` · `CASES`): the two unread phrases, then two controls. */
export const UNREAD_CASES = Object.freeze(['yesterday-morning', 'last-week', 'c-node', 'c-backup']);

/** The unread cases — each run ends at its first ask (`maxAnsweredAsks: 0`). */
export const UNREAD_ONLY = Object.freeze(['yesterday-morning', 'last-week']);

/** The new line's opening, as the `after` build serves it and the `before` build never does. */
export const NEW_LINE_MARK = 'The library could not read “';

/** A literal of the new line's source (`serve.ts` · `unreadSentence`) — how a BUILD is told apart. */
export const BUILD_MARK = 'Do not ask about the time in the reply';

/** The registered margins — `RULE-unread.md`, "Margins". */
export const MARGINS = Object.freeze({
  gain: 0.4,
  completedMargin: 0.1,
  controlTimeAsks: 0,
  errorRate: 0.05,
  servedNewLine: 0.95,
});

const PERIOD_TOOLS = new Set(['client_activity', 'search_logs']);

/** Every ask the run raised, in order: the answered ones, then the one it ended on. */
function asksOf(raw) {
  return [...(raw.asks ?? []), ...(raw.pendingAsk !== undefined ? [raw.pendingAsk] : [])];
}

/**
 * Whether an ask is the library's free-entry time ask: a `time-range` field that offered no value.
 * An answered ask's fields carry the person's answers (`offered` there is the list); a pending
 * one carries the count.
 */
export function isFreeEntryAsk(ask, answeredOffers = []) {
  return (ask.fields ?? []).some((f, i) => {
    if (f.format !== 'time-range') return false;
    if (typeof f.offered === 'number') return f.offered === 0;
    const offered = answeredOffers[i]?.offered;
    return Array.isArray(offered) && offered.length === 0;
  });
}

/** One saved run → one row. */
export function unreadRowOf(raw) {
  const asks = asksOf(raw);
  const first = asks[0];
  const firstAnswers = (raw.asks ?? [])[0]?.answers ?? [];
  const freeEntry = first !== undefined && isFreeEntryAsk(first, firstAnswers);
  const timeAsks = asks.filter((a) =>
    (a.fields ?? []).some((f) => f.format === 'time-range' || f.format === 'zone'),
  ).length;
  const lines = (raw.requests ?? []).map((q) => q.timeLine);
  const firstLine = lines[0];
  const toolCalls = (raw.readLog ?? []).length;
  const reads = (raw.readLog ?? []).filter((r) => PERIOD_TOOLS.has(r.tool) && r.window !== undefined);
  const answer = typeof raw.answer === 'string' ? raw.answer : undefined;
  return {
    key: raw.key,
    arm: raw.arm,
    caseId: raw.caseId,
    unread: UNREAD_ONLY.includes(raw.caseId),
    rep: raw.rep,
    ...(raw.variant !== undefined && { variant: raw.variant }),
    freeEntry,
    timeAsks,
    proseAsk: answer !== undefined && toolCalls === 0 && asks.length === 0 && answer.includes('?'),
    ownWindow: reads.length > 0 && (raw.asks ?? []).length === 0 && raw.pendingAsk === undefined,
    completed: answer !== undefined,
    stuck: raw.stuck === true,
    errored: raw.error !== undefined,
    servedNewLine: typeof firstLine === 'string' && firstLine.includes(NEW_LINE_MARK),
    anyNewLine: lines.some((l) => typeof l === 'string' && l.includes(NEW_LINE_MARK)),
    calls: raw.usage?.calls ?? 0,
    usd: raw.usd ?? 0,
  };
}

// ── the tallies ─────────────────────────────────────────────────────────────

const share = (k, n) => (n === 0 ? undefined : k / n);
const fmt = (x) => (x === undefined ? 'n/a' : x.toFixed(2));

/** Per (case, arm): the counts the report prints. */
export function aggregateUnread(rows) {
  const out = [];
  for (const caseId of UNREAD_CASES) {
    for (const arm of UNREAD_ARMS) {
      const r = rows.filter((x) => x.caseId === caseId && x.arm === arm);
      if (r.length === 0) continue;
      const k = (f) => r.filter(f).length;
      out.push({
        caseId,
        arm,
        runs: r.length,
        freeEntry: k((x) => x.freeEntry),
        proseAsk: k((x) => x.proseAsk),
        ownWindow: k((x) => x.ownWindow),
        completed: k((x) => x.completed),
        timeAsks: k((x) => x.timeAsks > 0),
        servedNewLine: k((x) => x.servedNewLine),
        errored: k((x) => x.errored),
        calls: r.reduce((a, x) => a + x.calls, 0),
        usd: r.reduce((a, x) => a + x.usd, 0),
      });
    }
  }
  return out;
}

/** The per-case table, markdown. */
export function formatUnreadReport(aggregates) {
  const head =
    '| case | arm | runs | free-entry ask opened | asked in prose | wrote its own window | completed | time asks | served the new line | errored | model calls | usd |\n' +
    '|---|---|---|---|---|---|---|---|---|---|---|---|';
  const body = aggregates.map(
    (a) =>
      `| ${a.caseId} | ${a.arm} | ${a.runs} | ${a.freeEntry} | ${a.proseAsk} | ${a.ownWindow} | ` +
      `${a.completed} | ${a.timeAsks} | ${a.servedNewLine} | ${a.errored} | ${a.calls} | ${a.usd.toFixed(4)} |`,
  );
  return [head, ...body].join('\n');
}

// ── the verdict ─────────────────────────────────────────────────────────────

const clause = (id, what, pass, detail) => ({ id, what, pass, detail });

/**
 * The verdict over ONE interleaved invocation's rows (`unreadRowOf`). PASS only when every clause
 * passes; FAIL when one fails; NOT-MEASURABLE when a clause had nothing to count (and none failed).
 */
export function judge(rows) {
  const arms = new Set(rows.map((r) => r.arm));
  if (!arms.has('before') || !arms.has('after'))
    throw new Error('time-rule-unread judges one invocation holding arms before and after');
  const M = MARGINS;
  const of = (arm, pick) => rows.filter((r) => r.arm === arm && pick(r));

  // U1 — the free-entry ask opens on unread words (primary), both cases pooled, errors excluded.
  const unreadOf = (arm) => of(arm, (r) => r.unread && !r.errored);
  const [ub, ua] = [unreadOf('before'), unreadOf('after')];
  const [rb, ra] = [ub, ua].map((r) => share(r.filter((x) => x.freeEntry).length, r.length));
  const u1 =
    rb === undefined || ra === undefined
      ? clause('U1', 'the free-entry ask opens on unread words', undefined, 'no unread run in an arm')
      : clause(
          'U1',
          'unread cases (pooled): after’s free-entry-ask share ≥ before’s + gain',
          ra >= rb + M.gain - 1e-9,
          `before ${ub.filter((x) => x.freeEntry).length}/${ub.length} (${fmt(rb)}), ` +
            `after ${ua.filter((x) => x.freeEntry).length}/${ua.length} (${fmt(ra)}), gain ${M.gain}`,
        );

  // U2 — controls still complete.
  const controlsOf = (arm) => of(arm, (r) => !r.unread);
  const [cb, ca] = [controlsOf('before'), controlsOf('after')];
  const [qb, qa] = [cb, ca].map((r) => share(r.filter((x) => x.completed).length, r.length));
  const u2 =
    qb === undefined || qa === undefined
      ? clause('U2', 'controls still complete', undefined, 'no control run in an arm')
      : clause(
          'U2',
          'controls: after’s answered share ≥ before’s − completedMargin',
          qa >= qb - M.completedMargin - 1e-9,
          `before ${cb.filter((x) => x.completed).length}/${cb.length} (${fmt(qb)}), ` +
            `after ${ca.filter((x) => x.completed).length}/${ca.length} (${fmt(qa)})`,
        );

  // U3 — controls raise no time ask.
  const [tb, ta] = [cb, ca].map((r) => r.filter((x) => x.timeAsks > 0).length);
  const u3 =
    cb.length === 0 || ca.length === 0
      ? clause('U3', 'controls raise no time ask', undefined, 'no control run in an arm')
      : clause(
          'U3',
          'controls: runs with a time ask, after ≤ before + controlTimeAsks',
          ta <= tb + M.controlTimeAsks,
          `before ${tb}/${cb.length}, after ${ta}/${ca.length}`,
        );

  // G1 — the harness ran: errors (and stuck controls) at most errorRate of each arm.
  const bad = (arm) => {
    const r = of(arm, () => true);
    return { k: r.filter((x) => x.errored || (!x.unread && x.stuck)).length, n: r.length };
  };
  const [gb, ga] = [bad('before'), bad('after')];
  const g1 = clause(
    'G1',
    'the harness ran: errored runs and stuck controls at most errorRate of each arm',
    gb.k <= M.errorRate * gb.n && ga.k <= M.errorRate * ga.n,
    `before ${gb.k}/${gb.n}, after ${ga.k}/${ga.n}`,
  );

  // G2 — the arm was armed: after's unread runs served the new line first; before never did.
  const served = ua.filter((x) => x.servedNewLine).length;
  const leaked = of('before', (r) => r.anyNewLine).length;
  const g2 =
    ua.length === 0
      ? clause('G2', 'the arm was armed', undefined, 'no after unread run')
      : clause(
          'G2',
          'after unread runs served the new line on their first request; no before run served it',
          served >= M.servedNewLine * ua.length && leaked === 0,
          `after ${served}/${ua.length}, before runs serving it ${leaked}`,
        );

  const clauses = [u1, u2, u3, g1, g2];
  const failed = clauses.filter((c) => c.pass === false);
  const unmeasured = clauses.filter((c) => c.pass === undefined);
  const verdict = failed.length > 0 ? 'FAIL' : unmeasured.length > 0 ? 'NOT-MEASURABLE' : 'PASS';
  return { rule: RULE_ID, verdict, clauses };
}

/** The verdict, markdown. */
export function formatVerdict(v) {
  const word = (p) => (p === true ? 'pass' : p === false ? 'FAIL' : 'not measurable');
  return [
    `## Verdict: ${v.verdict} (${v.rule})`,
    '',
    '| Clause | What | Result | Detail |',
    '|---|---|---|---|',
    ...v.clauses.map((c) => `| ${c.id} | ${c.what} | ${word(c.pass)} | ${c.detail} |`),
  ].join('\n');
}
