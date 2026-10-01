/**
 * bench/time-checks/metrics.mjs — one saved run → one row, and rows → tables. Everything is read
 * from the record the run left (the tools' read log, the ledger's rows, the standing, the served
 * requests, the model's own words) and the planted truth (`cases.mjs`). No model judges.
 *
 * THE TRUTH (`truthOf`) is the tools' OWN read log against the person's window, per tool of the
 * case: `missing` — a piece of the window no read of that tool covered (a tool never read at all
 * misses the whole window); `extra` — a piece a read covered outside the window. Pieces of at most
 * `TOLERANCE_MS` (one minute: a look-back that ran a few seconds after the message) do not count.
 * The library's own check is never consulted for the truth.
 */

import { ACTIVITY_RETENTION, CASES, MIN } from './cases.mjs';
import { claimsPast, labelAnswer } from './labels.mjs';

/** A piece of a window at most this long is not a difference (the truth's tolerance). */
export const TOLERANCE_MS = MIN;

/** Step T8's two fold reasons. */
export const T8_REASONS = Object.freeze(['period-differs-from-asked', 'period-beyond-retention']);

/** The served line's lead (`arguments/serve.ts` · `timeLimitsSentence`). */
export const LIMITS_LEAD = 'The time the tools read is not the time asked about';
/**
 * Its opening since round 1 (`arguments/serve.ts` · `TIME_LIMITS_SOURCE`, since packet "serving"
 * `TIME_LINE_SOURCE`, which opens EVERY served time line once) — either marks the line. It marks
 * the limits half only because this bench arms `.time()` without a reader: no windows half is served.
 */
export const LIMITS_SOURCE = 'A note from the library';

const byId = new Map(CASES.map((c) => [c.id, c]));

/** Sorted, merged ranges. */
export function union(ranges) {
  const sorted = [...ranges].filter((r) => r.from < r.to).sort((a, b) => a.from - b.from);
  const out = [];
  for (const r of sorted) {
    const last = out[out.length - 1];
    if (last !== undefined && r.from <= last.to) last.to = Math.max(last.to, r.to);
    else out.push({ from: r.from, to: r.to });
  }
  return out;
}

/** `a` minus the merged ranges `bs`: the pieces of `a` no `b` covers. */
export function minus(a, bs) {
  let pieces = [{ from: a.from, to: a.to }];
  for (const b of bs) {
    const next = [];
    for (const p of pieces) {
      if (b.to <= p.from || b.from >= p.to) next.push(p);
      else {
        if (b.from > p.from) next.push({ from: p.from, to: b.from });
        if (b.to < p.to) next.push({ from: b.to, to: p.to });
      }
    }
    pieces = next;
  }
  return pieces;
}

const longer = (pieces) => pieces.filter((p) => p.to - p.from > TOLERANCE_MS);

/** The run's truth: per tool of the case, the reads against the person's window. */
export function truthOf(caseDef, raw) {
  const w = { from: Date.parse(raw.window.from), to: Date.parse(raw.window.to) };
  let missing = false;
  let extra = false;
  const reads = [];
  for (const tool of caseDef.tools) {
    const r = union(
      raw.readLog.filter((e) => e.tool === tool && e.read !== undefined).map((e) => e.read),
    );
    reads.push(...r);
    if (longer(minus(w, r)).length > 0) missing = true;
    for (const piece of r) if (longer(minus(piece, [w])).length > 0) extra = true;
  }
  return { missing, extra, covered: !missing && !extra, reads };
}

const isRow = (kind) => (r) => r?.kind === kind;

/** One saved run → one row. */
export function readRun(raw) {
  const c = byId.get(raw.caseId);
  if (c === undefined) throw new Error(`no case ${raw.caseId}`);
  const rows = raw.rows ?? [];
  const caseTools = new Set(c.tools);
  const reached =
    raw.readLog.some((e) => caseTools.has(e.tool)) ||
    rows.some((r) => r.kind === 'call-window' && caseTools.has(r.toolName));
  const truth = truthOf(c, raw);
  const reasons = raw.standing?.reasons ?? [];
  const t8 = reasons.filter((r) => T8_REASONS.includes(r));
  const standing = raw.standing?.standing;
  const zones = new Set(rows.filter(isRow('source-clock')).map((r) => r.zone));
  const checkedRows = rows.filter(
    (r) =>
      r.kind === 'period' &&
      (r.differs !== undefined || r.beyondRetention === true || r.shifted !== undefined),
  );
  const served = (raw.requests ?? []).filter(
    (q) =>
      typeof q.timeLine === 'string' &&
      (q.timeLine.includes(LIMITS_LEAD) ||
        q.timeLine.includes(LIMITS_SOURCE) ||
        q.timeLine.includes('Clocks:')),
  ).length;
  const answered = raw.answer !== undefined;
  const retentionsMs = c.tools.includes('client_activity') ? [ACTIVITY_RETENTION] : [];
  const labels = labelAnswer(raw.modelAnswer, c, {
    reads: truth.reads,
    retentionsMs,
    asked: { from: Date.parse(raw.window.from), to: Date.parse(raw.window.to) },
  });
  const usage = raw.usage ?? { calls: 0, input: 0, output: 0, cacheRead: 0, cacheWrite: 0 };
  return {
    key: raw.key,
    arm: raw.arm,
    caseId: raw.caseId,
    kind: c.kind,
    rep: raw.rep,
    ...(raw.variant !== undefined && { variant: raw.variant }),
    answered,
    failed: raw.error !== undefined || raw.stuck === true,
    ...(raw.error !== undefined && { error: raw.error }),
    reached,
    truthMissing: truth.missing,
    truthExtra: truth.extra,
    covered: truth.covered,
    standing,
    notSure: standing === 'not-sure' || standing === 'ask',
    t8Reasons: t8,
    checkedRows: checkedRows.length,
    sourceClockZones: zones.size,
    servedLimits: served,
    asks: raw.asks?.length ?? 0,
    scoped: labels.scoped === true,
    hedged: labels.hedged === true,
    ...(labels.facts !== undefined && { facts: labels.facts }),
    ...(labels.counted !== undefined && { counted: labels.counted }),
    ...(claimsPast(c.kind, labels) !== undefined && { claimsPast: claimsPast(c.kind, labels) }),
    calls: usage.calls,
    inputTokens: usage.input + usage.cacheRead + usage.cacheWrite,
    outputTokens: usage.output,
    usd: raw.usd ?? 0,
  };
}

// ── tables ──────────────────────────────────────────────────────────────────────

/** `k` of `n` rows (of `arm`, passing `pick`) pass `test`; `share` is `k/n` (0 when `n` is 0). */
export function tally(rows, arm, pick, test) {
  const set = rows.filter((r) => r.arm === arm && pick(r));
  const k = set.filter(test).length;
  return { k, n: set.length, share: set.length === 0 ? 0 : k / set.length };
}
const both = (rows, pick, test) => ({
  off: tally(rows, 'off', pick, test),
  on: tally(rows, 'on', pick, test),
});
const mean = (xs) => (xs.length === 0 ? 0 : xs.reduce((a, b) => a + b, 0) / xs.length);

/** The sets the rule reads. */
export const SETS = Object.freeze({
  /** A provoking run whose asked window was, in truth, not wholly read — "not sure" is honest. */
  missingTruth: (r) => r.reached && r.truthMissing,
  /** A run whose reads matched the person's window in truth. */
  coveredTruth: (r) => r.reached && r.covered,
  /** A provoking case (missing or extra) the run reached a tool on and answered. */
  provokingAnswered: (r) => (r.kind === 'missing' || r.kind === 'extra') && r.reached && r.answered,
  /** A control the run reached a tool on and answered. */
  controlAnswered: (r) => r.kind === 'control' && r.reached && r.answered,
  /** Every run that reached a tool. */
  reached: (r) => r.reached,
});

export function aggregate(rows) {
  const armRows = (arm) => rows.filter((r) => r.arm === arm);
  const perArm = (arm) => {
    const rs = armRows(arm);
    const calls = rs.reduce((a, r) => a + r.calls, 0);
    return {
      runs: rs.length,
      failed: rs.filter((r) => r.failed).length,
      reached: rs.filter((r) => r.reached).length,
      calls,
      callsPerRun: rs.length === 0 ? 0 : calls / rs.length,
      inputTokensPerCall: calls === 0 ? 0 : rs.reduce((a, r) => a + r.inputTokens, 0) / calls,
      usd: rs.reduce((a, r) => a + r.usd, 0),
      standings: Object.fromEntries(
        [...new Set(rs.map((r) => String(r.standing)))].map((s) => [
          s,
          rs.filter((r) => String(r.standing) === s).length,
        ]),
      ),
    };
  };
  const perCase = Object.fromEntries(
    CASES.map((c) => {
      const pick = (r) => r.caseId === c.id;
      return [
        c.id,
        {
          kind: c.kind,
          reached: both(rows, pick, (r) => r.reached),
          covered: both(
            rows,
            (r) => pick(r) && r.reached,
            (r) => r.covered,
          ),
          notSure: both(
            rows,
            (r) => pick(r) && r.reached,
            (r) => r.notSure,
          ),
          t8Reason: both(
            rows,
            (r) => pick(r) && r.reached,
            (r) => r.t8Reasons.length > 0,
          ),
          served: both(
            rows,
            (r) => pick(r) && r.reached,
            (r) => r.servedLimits > 0,
          ),
          claimsPast: both(
            rows,
            (r) => pick(r) && r.claimsPast !== undefined,
            (r) => r.claimsPast === true,
          ),
          hedged: both(
            rows,
            (r) => pick(r) && r.answered,
            (r) => r.hedged,
          ),
          scoped: both(
            rows,
            (r) => pick(r) && r.answered,
            (r) => r.scoped,
          ),
        },
      ];
    }),
  );
  const factsMean = (arm) =>
    mean(
      rows
        .filter((r) => r.arm === arm && SETS.controlAnswered(r) && r.facts !== undefined)
        .map((r) => r.facts),
    );
  return {
    perArm: { off: perArm('off'), on: perArm('on') },
    honest: both(rows, SETS.missingTruth, (r) => r.notSure),
    foldAgrees: both(rows, SETS.reached, (r) => r.t8Reasons.length > 0 === !r.covered),
    falseNotSureT8: both(rows, SETS.coveredTruth, (r) => r.notSure && r.t8Reasons.length > 0),
    notSureOnCovered: both(rows, SETS.coveredTruth, (r) => r.notSure),
    claimsPast: both(rows, SETS.provokingAnswered, (r) => r.claimsPast === true),
    controlHedged: both(rows, SETS.controlAnswered, (r) => r.hedged),
    controlFacts: { off: factsMean('off'), on: factsMean('on') },
    t8OnOff: tally(
      rows,
      'off',
      () => true,
      (r) => r.t8Reasons.length > 0,
    ),
    servedOff: tally(
      rows,
      'off',
      () => true,
      (r) => r.servedLimits > 0,
    ),
    servedWhenChecked: tally(
      rows,
      'on',
      (r) => r.checkedRows > 0 && r.calls >= 2,
      (r) => r.servedLimits > 0,
    ),
    clocksLabelled: tally(
      rows,
      'on',
      (r) => r.caseId === 'clocks-differ' && r.reached && r.covered,
      (r) => r.sourceClockZones >= 2,
    ),
    clocksFalseLabel: tally(
      rows,
      'on',
      (r) => r.caseId === 'c-clocks-offsets',
      (r) => r.sourceClockZones > 0,
    ),
    tq8: tally(
      rows,
      'on',
      (r) =>
        r.kind === 'extra' && r.reached && r.counted === true && r.truthExtra && !r.truthMissing,
      (r) => r.notSure && r.t8Reasons.includes('period-differs-from-asked'),
    ),
    perCase,
  };
}

const pct = (t) => `${t.k}/${t.n}${t.n > 0 ? ` (${(100 * t.share).toFixed(0)}%)` : ''}`;

export function formatReport(agg) {
  const lines = [];
  lines.push('| | off | on |', '|---|---|---|');
  const a = agg.perArm;
  lines.push(`| runs (failed) | ${a.off.runs} (${a.off.failed}) | ${a.on.runs} (${a.on.failed}) |`);
  lines.push(`| reached a tool | ${a.off.reached} | ${a.on.reached} |`);
  lines.push(
    `| honest standing where the window was not wholly read | ${pct(agg.honest.off)} | ${pct(
      agg.honest.on,
    )} |`,
  );
  lines.push(
    `| the fold agrees with the truth | ${pct(agg.foldAgrees.off)} | ${pct(agg.foldAgrees.on)} |`,
  );
  lines.push(
    `| false "not sure" (T8 reason) on covered reads | ${pct(agg.falseNotSureT8.off)} | ${pct(
      agg.falseNotSureT8.on,
    )} |`,
  );
  lines.push(
    `| "not sure" (any reason) on covered reads | ${pct(agg.notSureOnCovered.off)} | ${pct(
      agg.notSureOnCovered.on,
    )} |`,
  );
  lines.push(
    `| answers claiming past what was read (provoking) | ${pct(agg.claimsPast.off)} | ${pct(
      agg.claimsPast.on,
    )} |`,
  );
  lines.push(
    `| needless hedges (controls) | ${pct(agg.controlHedged.off)} | ${pct(agg.controlHedged.on)} |`,
  );
  lines.push(
    `| facts restated (controls, mean) | ${agg.controlFacts.off.toFixed(
      3,
    )} | ${agg.controlFacts.on.toFixed(3)} |`,
  );
  lines.push(
    `| calls per run | ${a.off.callsPerRun.toFixed(2)} | ${a.on.callsPerRun.toFixed(2)} |`,
  );
  lines.push(
    `| input tokens per call | ${a.off.inputTokensPerCall.toFixed(
      0,
    )} | ${a.on.inputTokensPerCall.toFixed(0)} |`,
  );
  lines.push(`| spend | $${a.off.usd.toFixed(4)} | $${a.on.usd.toFixed(4)} |`);
  lines.push('');
  lines.push(
    `Standings — off: ${JSON.stringify(a.off.standings)}; on: ${JSON.stringify(a.on.standings)}.`,
  );
  lines.push(
    `Served the limits line where a check held and a call followed (on): ${pct(
      agg.servedWhenChecked,
    )}; off runs serving it: ${pct(agg.servedOff)}; off runs with a T8 reason: ${pct(
      agg.t8OnOff,
    )}.`,
  );
  lines.push(
    `Clocks labelled (on, clocks-differ, both read): ${pct(
      agg.clocksLabelled,
    )}; a clock label on the offsets control: ${pct(agg.clocksFalseLabel)}.`,
  );
  lines.push(`TQ8 — F, "not sure" on wider reads the model filtered right (on): ${pct(agg.tq8)}.`);
  lines.push('');
  lines.push(
    '| case | kind | reached off/on | covered off/on | not sure off/on | T8 reason off/on | served off/on | claims past off/on | hedged off/on |',
  );
  lines.push('|---|---|---|---|---|---|---|---|---|');
  for (const [id, c] of Object.entries(agg.perCase)) {
    const f = (t) => `${pct(t.off)} · ${pct(t.on)}`;
    lines.push(
      `| ${id} | ${c.kind} | ${f(c.reached)} | ${f(c.covered)} | ${f(c.notSure)} | ${f(
        c.t8Reason,
      )} | ${f(c.served)} | ${f(c.claimsPast)} | ${f(c.hedged)} |`,
    );
  }
  return lines.join('\n');
}
