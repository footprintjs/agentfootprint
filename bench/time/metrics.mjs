/**
 * bench/time/metrics.mjs — the reader: one saved run (`harness.mjs` · `runCase`) becomes one row,
 * and rows become the tables. Every field is read from the record and the planted truth — the
 * tools' read log, the asks and the person's replies, the time rows of the ledger, the served
 * requests, the usage. No model judges; nothing here reads what the model says about itself.
 */

import { caseOf, meantWindow, sameWindow } from './cases.mjs';

const DAY = 86_400_000;
const PERIOD_TOOLS = new Set(['client_activity', 'search_logs']);
/** The period arguments of the sheet's two tools — the only arguments a time reading can fill. */
const PERIOD_ARGUMENTS = new Set(['start_time', 'end_time', 'window']);

/**
 * Whether the run's reads are right for its case (`cases.mjs` · `CRITERIA`), and why not.
 * `exact` and `covers` judge the FIRST period read — the window the answer was built on first.
 */
export function rightOf(caseDef, raw) {
  const now = Date.parse(raw.now);
  const reads = raw.readLog.filter((r) => PERIOD_TOOLS.has(r.tool));
  if (caseDef.criterion === 'completed') return { right: raw.answer !== undefined };
  if (caseDef.criterion === 'no-future') {
    const future = reads.filter((r) => r.window !== undefined && r.window.from > now);
    return future.length === 0 ? { right: true } : { right: false, why: 'read-the-future' };
  }
  const first = reads[0];
  if (first === undefined) return { right: false, why: 'no-read' };
  if (first.window === undefined) return { right: false, why: 'unread-window' };
  const truth = meantWindow(caseDef, now);
  if (caseDef.criterion === 'exact') {
    return sameWindow(first.window, truth, caseDef.tol)
      ? { right: true }
      : { right: false, why: 'other-window' };
  }
  // covers
  const w = first.window;
  const ok = w.from <= truth.from + caseDef.tol && w.to >= truth.to - caseDef.tol && w.from >= truth.from - DAY;
  return ok ? { right: true } : { right: false, why: w.from > truth.from + caseDef.tol ? 'misses-start' : 'other-window' };
}

/** One saved run → one row. */
export function readRun(raw) {
  const c = caseOf(raw.caseId);
  const judged = rightOf(c, raw);
  const fields = raw.asks.flatMap((a) => a.answers);
  const confirms = fields.filter((f) => f.kind === 'confirm');
  const readings = raw.rows.filter((r) => r.kind === 'time-reading' && (r.mentions ?? 0) > 0);
  const windows = raw.rows.filter((r) => r.kind === 'call-window');
  const firstWindowRow = windows[0];
  const lines = raw.requests.map((q) => q.timeLine).filter((l) => l !== undefined);
  const pendingServed = lines.some((l) => l.startsWith('The person has not confirmed'));
  const settledServed = lines.some((l) => l.startsWith("The person's time words"));
  const saidRows =
    raw.rows.filter(
      (r) =>
        r.kind === 'argument' &&
        (r.period === true || PERIOD_ARGUMENTS.has(r.argument)) &&
        r.source === 'said',
    ).length +
    readings.filter((r) => (r.candidates ?? []).some((k) => (k.said ?? []).length > 0)).length;
  const calls = raw.usage.calls;
  const inputTokens = raw.usage.input + raw.usage.cacheRead + raw.usage.cacheWrite;
  return {
    key: raw.key,
    arm: raw.arm,
    caseId: raw.caseId,
    cell: c.cell,
    rep: raw.rep,
    ...(raw.variant !== undefined && { variant: raw.variant }),
    completed: raw.answer !== undefined,
    ...(raw.error !== undefined && { error: raw.error }),
    ...(raw.stuck === true && { stuck: true }),
    right: judged.right,
    ...(judged.why !== undefined && { why: judged.why }),
    periodReads: raw.readLog.filter((r) => PERIOD_TOOLS.has(r.tool)).length,
    asks: raw.asks.length,
    timeAsks: fields.filter((f) => f.kind === 'zone' || f.kind === 'confirm').length,
    zoneAsked: fields.some((f) => f.kind === 'zone'),
    confirmRaised: confirms.length > 0,
    ...(confirms.length > 0 && { prefill: confirms[0].pick }),
    toolAsks: fields.filter((f) => f.kind === 'tool-ask').length,
    unknownAsks: fields.filter((f) => f.kind === 'unknown').length,
    readingRows: readings.length,
    unreadable: readings.some((r) => r.problem === 'unreadable'),
    ...(firstWindowRow !== undefined && { firstCallWindow: firstWindowRow.how }),
    // The model wrote its own window while a reading waited on the person (§ 7.3: runs as sent).
    bypass: readings.some((r) => r.choice?.by === 'open') && ['model', 'model-chosen'].includes(firstWindowRow?.how),
    answered: raw.rows.filter((r) => r.kind === 'time-answer').map((r) => r.how),
    timeLines: lines.length,
    pendingServed,
    settledServed,
    saidRows,
    calls,
    inputTokens,
    outputTokens: raw.usage.output,
    usd: raw.usd,
  };
}

const share = (k, n) => (n === 0 ? undefined : k / n);
const pct = (x) => (x === undefined ? '—' : `${(100 * x).toFixed(0)}%`);

/** Counts over rows matching `pick`, per arm. */
export function tally(rows, pick, test) {
  const out = {};
  for (const arm of ['off', 'on']) {
    const r = rows.filter((x) => x.arm === arm && pick(x));
    const k = r.filter(test).length;
    out[arm] = { k, n: r.length, share: share(k, r.length) };
  }
  return out;
}

/** The aggregates the report and the rule read. */
export function aggregate(rows) {
  const cells = ['readable', 'unreadable', 'future', 'control'];
  const perCase = {};
  for (const id of [...new Set(rows.map((r) => r.caseId))]) {
    perCase[id] = {
      right: tally(rows, (r) => r.caseId === id, (r) => r.right),
      confirm: tally(rows, (r) => r.caseId === id, (r) => r.confirmRaised),
      bypass: tally(rows, (r) => r.caseId === id, (r) => r.bypass),
      asks: tally(rows, (r) => r.caseId === id, (r) => r.asks > 0),
    };
  }
  const perCell = Object.fromEntries(
    cells.map((cell) => [
      cell,
      {
        right: tally(rows, (r) => r.cell === cell, (r) => r.right),
        completed: tally(rows, (r) => r.cell === cell, (r) => r.completed),
        anyAsk: tally(rows, (r) => r.cell === cell, (r) => r.asks > 0),
        timeAsk: tally(rows, (r) => r.cell === cell, (r) => r.timeAsks > 0),
        readingRow: tally(rows, (r) => r.cell === cell, (r) => r.readingRows > 0),
        timeLine: tally(rows, (r) => r.cell === cell, (r) => r.timeLines > 0),
      },
    ]),
  );
  const onReadable = rows.filter((r) => r.arm === 'on' && r.cell === 'readable');
  const confirmed = onReadable.filter((r) => r.confirmRaised);
  const prefill = {
    raised: { k: confirmed.length, n: onReadable.length },
    prefillRight: confirmed.filter((r) => r.prefill === 'prefill-right').length,
    otherOption: confirmed.filter((r) => r.prefill === 'other-option').length,
    edited: confirmed.filter((r) => r.prefill === 'edited').length,
    zoneAsked: onReadable.filter((r) => r.zoneAsked).length,
    bypass: onReadable.filter((r) => r.bypass).length,
    pendingServed: onReadable.filter((r) => r.pendingServed).length,
    settledServed: onReadable.filter((r) => r.settledServed).length,
  };
  const tokens = {};
  for (const arm of ['off', 'on']) {
    const r = rows.filter((x) => x.arm === arm);
    const calls = r.reduce((s, x) => s + x.calls, 0);
    const input = r.reduce((s, x) => s + x.inputTokens, 0);
    tokens[arm] = { calls, input, perCall: calls === 0 ? undefined : input / calls, usd: r.reduce((s, x) => s + x.usd, 0) };
  }
  const errors = tally(rows, () => true, (r) => r.error !== undefined || r.stuck === true);
  const said = tally(rows, () => true, (r) => r.saidRows > 0);
  return { perCase, perCell, prefill, tokens, errors, said };
}

/** The report's tables, as Markdown. */
export function formatReport(agg) {
  const lines = [];
  lines.push('| case | right off | right on | confirmation on | model wrote its own window (on) | any ask off | any ask on |');
  lines.push('|---|---|---|---|---|---|---|');
  for (const [id, a] of Object.entries(agg.perCase)) {
    lines.push(
      `| ${id} | ${a.right.off.k}/${a.right.off.n} | ${a.right.on.k}/${a.right.on.n} | ${a.confirm.on.k}/${a.confirm.on.n} | ${a.bypass.on.k}/${a.bypass.on.n} | ${a.asks.off.k}/${a.asks.off.n} | ${a.asks.on.k}/${a.asks.on.n} |`,
    );
  }
  lines.push('');
  lines.push('| cell | right off | right on | completed off | completed on | any ask off | any ask on | time ask on | reading row on |');
  lines.push('|---|---|---|---|---|---|---|---|---|');
  for (const [cell, a] of Object.entries(agg.perCell)) {
    if (a.right.off.n + a.right.on.n === 0) continue;
    lines.push(
      `| ${cell} | ${pct(a.right.off.share)} (${a.right.off.k}/${a.right.off.n}) | ${pct(a.right.on.share)} (${a.right.on.k}/${a.right.on.n}) | ${a.completed.off.k}/${a.completed.off.n} | ${a.completed.on.k}/${a.completed.on.n} | ${a.anyAsk.off.k}/${a.anyAsk.off.n} | ${a.anyAsk.on.k}/${a.anyAsk.on.n} | ${a.timeAsk.on.k}/${a.timeAsk.on.n} | ${a.readingRow.on.k}/${a.readingRow.on.n} |`,
    );
  }
  const p = agg.prefill;
  lines.push('');
  lines.push(
    `Readable cases, arm on: a confirmation was raised on ${p.raised.k}/${p.raised.n} runs — the pre-fill ` +
      `was the person's window on ${p.prefillRight} (one click), another offered reading on ${p.otherOption}, ` +
      `edited on ${p.edited}; a zone was asked on ${p.zoneAsked}; the pending line was served on ` +
      `${p.pendingServed}, the settled line on ${p.settledServed}; the model wrote its own window while the ` +
      `reading waited on ${p.bypass}.`,
  );
  const t = agg.tokens;
  lines.push(
    `Input tokens per model call: off ${t.off.perCall?.toFixed(0) ?? '—'} (${t.off.calls} calls), on ` +
      `${t.on.perCall?.toFixed(0) ?? '—'} (${t.on.calls} calls). Errors or stuck runs: off ${agg.errors.off.k}/` +
      `${agg.errors.off.n}, on ${agg.errors.on.k}/${agg.errors.on.n}. Runs with a row filed as said: off ` +
      `${agg.said.off.k}, on ${agg.said.on.k}.`,
  );
  return lines.join('\n');
}
