/**
 * bench/results/metrics.mjs — the reader. Every number the results bench prints is computed
 * here from what a run left (`harness.mjs` · `runCase`): the stores' read log, the answer, the
 * standing fold's verdict, the ledger's period rows and the usage. Pure — no model, no network,
 * no library import — so saved runs can be re-read at any time (`run.mjs --rescore`), and every
 * clause of `RULE.md` is a function of these rows.
 *
 * WHAT A ROW SAYS
 *   reads          each call the store answered: the tool, the window it read, and the bench's
 *                  OWN verdict for that read (`cases.mjs` · `expectedVerdict` over the case's
 *                  planted instants) — the truth the fold is checked against
 *   expectedPeriodReasons / periodReasons
 *                  the `period-*` reasons the standing SHOULD carry (on arm: one per distinct
 *                  verdict that fires one; off arm: none — the layer is not mounted) and the
 *                  ones it DID carry (`assessAnswer`)
 *   label          the labeller's reading of the answer (`labels.mjs` · `labelAnswer`)
 *   flat           the answer read at least one store and is not scoped — on a provoking case,
 *                  a claim past the held period
 *   hedged         the answer doubts its coverage — on a control, a needless hedge
 *   facts          the share of the planted facts the answer restates (found cases only)
 *   falseNotSure   R3: the standing reads "not sure" naming `period-unknown` while the store
 *                  TRULY holds the period read (the planted truth of every R3 case)
 */

import {
  CASES,
  REASON_OF_VERDICT,
  caseById,
  expectedVerdict,
  factsOf,
  readStore,
  worldOf,
} from './cases.mjs';
import { labelAnswer } from './labels.mjs';
import { wilson } from '../inputs/metrics.mjs';

export { wilson };

/** The planted truth the labeller reads a case's answers against. */
export function truthOf(caseDef) {
  const world = worldOf(caseDef);
  const read = readStore(caseDef.expects.tool, caseDef.expects.args, world);
  return { edges: [{ held: read.held, queried: read.queried }], facts: factsOf(read) };
}

const sortedUnique = (xs) => [...new Set(xs)].sort();

/** The ledger's period rows (`kind: 'period'`), as `[toolName, verdict]`. */
function periodRowsOf(raw) {
  const ledger = raw.recording?.snapshot?.sharedState?.findingsLedger;
  return (Array.isArray(ledger) ? ledger : [])
    .filter((r) => r !== null && typeof r === 'object' && r.kind === 'period')
    .map((r) => [r.toolName, r.verdict]);
}

/**
 * Reads one raw run into the bench's row. Deterministic: the row carries no clock, no run id
 * and no duration, so the mock's rows are byte-stable and can be pinned.
 */
export function readRun(raw) {
  const caseDef = caseById(raw.caseId);
  if (caseDef === undefined) throw new Error(`run ${raw.key}: unknown case ${raw.caseId}`);
  const reads = (raw.readLog ?? [])
    .filter((e) => e.failed === undefined)
    .map((e) => ({
      tool: e.tool,
      window: e.window,
      found: e.found,
      verdict: expectedVerdict(e.queried, e.held),
    }));
  const readAny = reads.length > 0;
  const expectedPeriodReasons =
    raw.arm === 'on'
      ? sortedUnique(reads.map((r) => REASON_OF_VERDICT[r.verdict]).filter((x) => x !== undefined))
      : [];
  const reasons = Array.isArray(raw.standing?.reasons) ? raw.standing.reasons : [];
  const periodReasons = sortedUnique(reasons.filter((r) => r.startsWith('period-')));
  const label = labelAnswer(raw.answer, truthOf(caseDef));
  const usage = raw.usage ?? { calls: 0, input: 0, output: 0 };
  const expectedRead = reads.some((r) => r.tool === caseDef.expects.tool);
  return {
    key: raw.key,
    arm: raw.arm,
    caseId: raw.caseId,
    cell: caseDef.cell,
    role: caseDef.role,
    found: caseDef.found,
    rep: raw.rep,
    ...(raw.variant !== undefined && { variant: raw.variant }),
    outcome: raw.answer !== undefined ? 'answered' : raw.paused ? 'paused' : 'error',
    reads,
    readAny,
    expectedRead,
    periodRows: periodRowsOf(raw),
    expectedPeriodReasons,
    periodReasons,
    foldAgrees:
      readAny && expectedPeriodReasons.join() === periodReasons.join()
        ? true
        : readAny
        ? false
        : undefined,
    standing: raw.standing?.standing ?? (raw.standing?.error ? 'error' : undefined),
    reasons,
    label: {
      answered: label.answered,
      scoped: label.scoped,
      flat: label.answered && readAny && label.flat,
      hedged: label.hedged,
      ...(label.facts !== undefined && { facts: label.facts }),
      ...(label.matched !== undefined && { matched: label.matched }),
    },
    falseNotSure:
      caseDef.cell === 'R3' && expectedRead
        ? raw.standing?.standing === 'not-sure' && reasons.includes('period-unknown')
        : undefined,
    usage: { calls: usage.calls, input: usage.input, output: usage.output },
    usd: raw.usd ?? 0,
  };
}

// ── summaries ────────────────────────────────────────────────────────────────

const mean = (xs) => (xs.length === 0 ? undefined : xs.reduce((a, b) => a + b, 0) / xs.length);
const share = (k, n) => (n === 0 ? undefined : k / n);

/** One group's summary (any subset of rows). */
export function summarize(rows) {
  const answered = rows.filter((r) => r.outcome === 'answered');
  const measurable = answered.filter((r) => r.readAny);
  const flat = measurable.filter((r) => r.label.flat).length;
  const hedged = answered.filter((r) => r.label.hedged).length;
  const factRows = answered.filter((r) => r.label.facts !== undefined);
  const withRead = rows.filter((r) => r.readAny);
  const withCalls = rows.filter((r) => r.usage.calls > 0);
  const standings = {};
  for (const r of rows)
    standings[r.standing ?? 'none'] = (standings[r.standing ?? 'none'] ?? 0) + 1;
  const verdicts = {};
  for (const r of rows) for (const [, v] of r.periodRows) verdicts[v] = (verdicts[v] ?? 0) + 1;
  const r3 = rows.filter((r) => r.falseNotSure !== undefined);
  return {
    runs: rows.length,
    answered: answered.length,
    measurable: measurable.length,
    flat: {
      k: flat,
      n: measurable.length,
      rate: share(flat, measurable.length),
      ci: wilson(flat, measurable.length),
    },
    hedged: {
      k: hedged,
      n: answered.length,
      rate: share(hedged, answered.length),
      ci: wilson(hedged, answered.length),
    },
    facts: { n: factRows.length, mean: mean(factRows.map((r) => r.label.facts)) },
    fold: {
      k: withRead.filter((r) => r.foldAgrees === true).length,
      n: withRead.length,
      rate: share(withRead.filter((r) => r.foldAgrees === true).length, withRead.length),
    },
    periodReasonRuns: rows.filter((r) => r.periodReasons.length > 0).length,
    flatCaughtByRecord: {
      k: measurable.filter((r) => r.label.flat && r.periodReasons.length > 0).length,
      n: flat,
    },
    falseNotSure: {
      k: r3.filter((r) => r.falseNotSure).length,
      n: r3.length,
      rate: share(r3.filter((r) => r.falseNotSure).length, r3.length),
    },
    standings,
    verdicts,
    inputPerCall: share(
      withCalls.reduce((a, r) => a + r.usage.input, 0),
      withCalls.reduce((a, r) => a + r.usage.calls, 0),
    ),
    callsPerRun: mean(rows.map((r) => r.usage.calls)),
    usd: rows.reduce((a, r) => a + r.usd, 0),
  };
}

/** The row groups every table and clause reads. */
export const GROUPS = Object.freeze({
  provoking: (r) => r.role === 'provoking',
  pairedControls: (r) => r.role === 'control' && r.cell !== 'R3',
  pairedFound: (r) => r.cell !== 'R3' && r.found,
  paired: (r) => r.cell !== 'R3',
  r3Unknown: (r) => r.cell === 'R3' && r.role === 'held-unknown',
  r3Known: (r) => r.cell === 'R3' && r.role === 'control',
  r3UnknownFound: (r) => r.cell === 'R3' && r.role === 'held-unknown' && r.found,
  r3KnownFound: (r) => r.cell === 'R3' && r.role === 'control' && r.found,
});

/**
 * The provoking pairs: one per (case, repetition) that ran both arms, each side `true` (flat),
 * `false` (scoped) or `null` (not measurable: no answer, or no store read).
 */
export function provokingPairs(rows) {
  const byKey = new Map();
  for (const r of rows.filter(GROUPS.provoking)) {
    const k = `${r.caseId}/r${r.rep}`;
    const pair = byKey.get(k) ?? { caseId: r.caseId, rep: r.rep, off: null, on: null };
    const measurable = r.outcome === 'answered' && r.readAny;
    pair[r.arm] = measurable ? r.label.flat : null;
    byKey.set(k, pair);
  }
  return [...byKey.values()].sort((a, b) => a.caseId.localeCompare(b.caseId) || a.rep - b.rep);
}

/** Every summary the report and the rule read. */
export function aggregate(rows) {
  const arms = [...new Set(rows.map((r) => r.arm))];
  const byArm = {};
  for (const arm of arms) {
    const mine = rows.filter((r) => r.arm === arm);
    byArm[arm] = {
      all: summarize(mine),
      groups: Object.fromEntries(
        Object.entries(GROUPS).map(([g, f]) => [g, summarize(mine.filter(f))]),
      ),
      cases: Object.fromEntries(
        CASES.filter((c) => c.arms.includes(arm)).map((c) => [
          c.id,
          summarize(mine.filter((r) => r.caseId === c.id)),
        ]),
      ),
      cells: Object.fromEntries(
        ['R1', 'R2'].map((cell) => [
          cell,
          summarize(mine.filter((r) => r.cell === cell && r.role === 'provoking')),
        ]),
      ),
    };
  }
  return { arms, byArm, pairs: provokingPairs(rows) };
}

// ── the report ───────────────────────────────────────────────────────────────

const pct = (x) => (x === undefined ? '—' : `${Math.round(x * 100)}%`);
const ci = (c) => (c === undefined ? '' : ` [${Math.round(c[0] * 100)}–${Math.round(c[1] * 100)}]`);
const num = (x, d = 0) => (x === undefined ? '—' : x.toFixed(d));

/** The tables, as markdown. */
export function formatReport(aggregates) {
  const lines = [
    '| arm / case | runs | answered | flat (claims past the data) | hedged | facts | fold agrees | standings | input tok/call | calls/run |',
    '|---|---|---|---|---|---|---|---|---|---|',
  ];
  for (const arm of aggregates.arms) {
    for (const [id, s] of Object.entries(aggregates.byArm[arm].cases)) {
      const standings = Object.entries(s.standings)
        .map(([k, v]) => `${k} ${v}`)
        .join(', ');
      lines.push(
        `| ${arm} · ${id} | ${s.runs} | ${s.answered} | ${s.flat.k}/${s.flat.n} ${pct(
          s.flat.rate,
        )}${ci(s.flat.ci)} | ${s.hedged.k}/${s.hedged.n} ${pct(s.hedged.rate)} | ${num(
          s.facts.mean,
          2,
        )} | ${s.fold.k}/${s.fold.n} | ${standings} | ${num(s.inputPerCall)} | ${num(
          s.callsPerRun,
          2,
        )} |`,
      );
    }
  }
  const pairs = aggregates.pairs;
  const both = pairs.filter((p) => p.off !== null && p.on !== null);
  const b = both.filter((p) => p.off && !p.on).length;
  const c = both.filter((p) => !p.off && p.on).length;
  lines.push(
    '',
    `Provoking pairs (case × repetition, both arms measurable): ${both.length} of ${pairs.length}; ` +
      `flat off-only ${b}, flat on-only ${c}.`,
  );
  for (const arm of aggregates.arms) {
    const g = aggregates.byArm[arm].groups;
    lines.push(
      `- ${arm}: provoking flat ${g.provoking.flat.k}/${g.provoking.flat.n} ${pct(
        g.provoking.flat.rate,
      )}` +
        ` · controls hedged ${g.pairedControls.hedged.k}/${g.pairedControls.hedged.n}` +
        ` · flat answers the record still flags ${g.provoking.flatCaughtByRecord.k}/${g.provoking.flatCaughtByRecord.n}` +
        ` · spend $${g.paired.usd.toFixed(4)} paired + $${(
          aggregates.byArm[arm].all.usd - g.paired.usd
        ).toFixed(4)} R3`,
    );
  }
  return lines.join('\n');
}
