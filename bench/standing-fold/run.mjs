/**
 * Step 1 bench — the standing fold over every recorded run the repository holds ($0).
 *
 * The registered rule is `bench/standing-fold/RULE.md` (committed before this ran). This script
 * reads recordings only; it calls no model. It needs a build (`npm run build`): the fold is read
 * from `dist/esm/observe.js` · `assessAnswer`, the commit-log fold from `foottrace` ·
 * `stateAt`.
 *
 *   node bench/standing-fold/run.mjs            # writes bench/standing-fold/results.json
 *
 * The RQ3 oracle below is a COPY of `test/core/agent/assessment/rq3-parity.test.ts` · `rq3`
 * (with `returnedRows` and `listed`), types removed, logic unchanged — the test's transcription
 * of the study's registered rule, reading EVENTS only. It imports no library reader.
 */

import { readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

import { stateAt } from 'foottrace';

import { assessAnswer } from '../../dist/esm/observe.js';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, '..', '..');
const load = (rel) => JSON.parse(readFileSync(join(ROOT, rel), 'utf8'));

// ── the app's declarations for fixture A (test/lib/answer-account/helpers.ts · NEO_DECLARATIONS) ──
const NEO_DECLARATIONS = Object.freeze({
  id: 'neo-seo',
  version: '1',
  skills: { 'array-inventory': { label: 'array estate report' } },
  tools: { powerstore_get_volumes: { rowsAt: 'volumes' } },
  routing: { appDecides: true },
});

/** The committed keys the fold reads (assess.ts · assessAnswer). */
const FOLD_KEYS = [
  'history',
  'coverageDeclared',
  'pausedToolCallId',
  'findingsLedger',
  'unsupportedValues',
  'stoppedEarly',
  'answerValidation',
];

// ── the oracle: RQ3 over recorded EVENTS (copy of rq3-parity.test.ts · rq3) ──

const isObj = (x) => typeof x === 'object' && x !== null && !Array.isArray(x);

function returnedRows(result, rowsKey) {
  let value = result;
  if (typeof value === 'string') {
    try {
      value = JSON.parse(value);
    } catch {
      return false;
    }
  }
  if (Array.isArray(value)) return value.length > 0;
  if (isObj(value) && rowsKey !== undefined) {
    const rows = value[rowsKey];
    return Array.isArray(rows) && rows.length > 0;
  }
  return false;
}

const listed = (x) => Array.isArray(x) && x.length > 0;

function rq3(events, entity, rowsKey) {
  const of = (type) => events.filter((e) => e.type === `agentfootprint.${type}`);
  const asks = of('pause.request').filter(
    (e) => isObj(e.payload.questionPayload) && isObj(e.payload.questionPayload.awaitingInput),
  );
  const lastAsk = asks[asks.length - 1];
  if (lastAsk !== undefined) {
    const at = events.indexOf(lastAsk);
    if (!events.slice(at).some((e) => e.type === 'agentfootprint.agent.turn_end')) return 'ASKED';
  }
  const forEntity = of('stream.tool_start')
    .filter((e) => JSON.stringify(e.payload.args ?? {}).includes(entity))
    .map((e) => String(e.payload.toolCallId));
  const ids = new Set(forEntity);
  const declarations = [...of('tools.absent'), ...of('tools.coverage_declared')].filter((e) =>
    ids.has(String(e.payload.toolCallId)),
  );
  if (declarations.some((e) => listed(e.payload.notChecked) || listed(e.payload.cannotCover))) {
    return 'NOT-COVERED';
  }
  const ends = of('stream.tool_end');
  const endOf = (id) => ends.filter((e) => String(e.payload.toolCallId) === id).pop();
  const last = forEntity[forEntity.length - 1];
  if (last !== undefined) {
    const end = endOf(last);
    const absentEvent = of('tools.absent').some((e) => String(e.payload.toolCallId) === last);
    if (end?.payload.status === 'absent' || absentEvent) return 'DECLARED-ABSENT';
  }
  const found = forEntity.some((id) => {
    const end = endOf(id);
    if (end === undefined || end.payload.error === true) return false;
    const seen = 'modelResult' in end.payload ? end.payload.modelResult : end.payload.result;
    return returnedRows(seen, rowsKey);
  });
  return found ? 'FOUND' : 'UNKNOWN';
}

/** The fold's RQ3 class, by the design's mapping (copy of rq3-parity.test.ts · foldClass). */
function foldClass(a) {
  const reasons = a.reasons.map((r) => r.reason);
  if (a.standing === 'ask') return 'ASKED';
  if (reasons.includes('coverage-gap')) return 'NOT-COVERED';
  if (reasons.includes('declared-absent')) return 'DECLARED-ABSENT';
  if (a.assessment === 'unrefuted') return 'FOUND';
  const cannotVouch =
    a.assessment === 'not-applicable' ||
    (reasons.length > 0 && reasons.every((r) => r === 'empty-undeclared'));
  return cannotVouch ? 'UNKNOWN' : 'OTHER';
}

// ── the recorded runs ────────────────────────────────────────────────────────

/** Every record: { id, tier, source, record, declarations?, missing?, rq3? }. */
function collect() {
  const out = [];
  const refDir = 'test/core/tools/reference';
  for (const file of readdirSync(join(ROOT, refDir)).sort()) {
    if (!file.endsWith('.json')) continue;
    const source = `${refDir}/${file}`;
    const { commitLog } = load(source);
    const folded = stateAt({ commitLog }, commitLog.length - 1);
    out.push({
      id: `ref:${file.replace(/\.json$/, '')}`,
      tier: 'full',
      source,
      record: { snapshot: { sharedState: folded.state } },
      foldBasis: folded.basis,
      ...(folded.skipped !== undefined && { skipped: folded.skipped.length }),
    });
  }

  const fixtureA = load('test/lib/answer-account/fixtures/turn2.recorded.json');
  out.push({
    id: 'field:fixture-A',
    tier: 'full',
    source: 'test/lib/answer-account/fixtures/turn2.recorded.json',
    record: fixtureA,
    declarations: NEO_DECLARATIONS,
    missing: FOLD_KEYS.filter((k) => !(k in fixtureA.snapshot.sharedState)),
    rq3: { events: fixtureA.events, entity: 'SHPSTRPLPCL003', arm: 'DECLARED' },
  });

  const demo = load('test/recorders/observability/fixtures/demo-turn.json');
  out.push({
    id: 'demo:demo-turn',
    tier: 'full',
    source: 'test/recorders/observability/fixtures/demo-turn.json',
    record: { snapshot: { sharedState: demo.finalState } },
    rq3: { events: demo.events, entity: 'Heat', arm: 'PLAIN' },
  });

  const excerpt = (id, source, state) =>
    out.push({
      id,
      tier: 'excerpt',
      source,
      record: { snapshot: { sharedState: state } },
      missing: FOLD_KEYS.filter((k) => !(k in state)),
    });

  const crob = 'test/core/agent/reference/coverage-record-only-bytes.json';
  for (const [k, v] of Object.entries(load(crob))) {
    excerpt(`excerpt:coverage-record-only/${k}`, crob, {
      history: v.history,
      coverageDeclared: v.coverageDeclared,
    });
  }
  const bplc = 'test/core/scenario/reference/batch-pause-last-call.json';
  for (const [k, v] of Object.entries(load(bplc))) {
    excerpt(`excerpt:batch-pause-last-call/${k}`, bplc, { history: v.history });
  }
  const plna = 'test/core/agent/reference/paused-lookup-no-absence.json';
  excerpt('excerpt:paused-lookup-no-absence', plna, { history: load(plna).history });
  // The sentence reference keeps the history the model was sent and the coverage row; its
  // not-a-sentence twin keeps events and the model-read text only (listed as unreadable).
  const atis = 'test/core/agent/fixtures/absent-try-instead-sentence.reference.json';
  const sentence = load(atis);
  excerpt('excerpt:absent-try-instead-sentence', atis, {
    history: sentence.sent[sentence.sent.length - 1],
    coverageDeclared: sentence.coverageDeclared,
  });

  const hrmr = 'test/core/agent/reference/hand-raised-malformed-request.json';
  for (const [k, v] of Object.entries(load(hrmr))) {
    out.push({
      id: `excluded:hand-raised-malformed-request/${k}`,
      tier: 'excluded',
      source: hrmr,
      why: `the run ended in an error (${String(v.error).slice(0, 60)}…): no answer, no standing`,
    });
  }
  return out;
}

/** Tracked JSON files with no committed state the fold could read. */
function unreadable() {
  const files = [
    ...readdirSync(join(ROOT, 'test/observability-providers/reference')).map(
      (f) => `test/observability-providers/reference/${f}`,
    ),
    'test/integrity/reference/dangling-trap-narrative.json',
    'test/core/agent/fixtures/absent-try-instead-not-a-sentence.reference.json',
    'test/lib/answer-account/golden/turn2.A.account.json',
    'test/lib/answer-account/golden/turn2.A.shown.json',
    'test/lib/answer-account/golden/templates.reference.json',
  ];
  return files.filter((f) => f.endsWith('.json'));
}

// ── the checks ───────────────────────────────────────────────────────────────

const STANDINGS = ['known', 'consistent', 'not-sure', 'ask', 'not-assessed'];

/** A committed supporting row: the one tie check this version reads (assess.ts · readAnswerRows). */
function supportingRow(state) {
  const r = state.answerValidation;
  return (
    isObj(r) &&
    r.status === 'passed' &&
    r.mode === 'enforce' &&
    typeof r.candidateDigest === 'string'
  );
}

/** Rule 2 for one record: known ⇒ a supporting row; without the row, never known. */
function silenceCheck(record, declarations) {
  const state = record.snapshot.sharedState;
  const a = assessAnswer(record, declarations);
  const violations = [];
  if (a.assessment === 'known' && !supportingRow(state)) violations.push('known-without-row');
  if (a.assessment === 'known' && a.support === undefined) violations.push('known-without-support');
  const { answerValidation: _dropped, ...withoutRow } = state;
  const stripped = assessAnswer({ snapshot: { sharedState: withoutRow } }, declarations);
  if (stripped.assessment === 'known') violations.push('known-after-row-removed');
  return { a, violations };
}

/** Synthetic silence probes (named so): none may read "known" unless the tie row is there. */
function probes() {
  const user = { role: 'user', content: 'Which VMs run on host-9?' };
  const call = (id) => ({
    role: 'assistant',
    content: '',
    toolCalls: [{ id, name: 'find_vms', args: { host: 'host-9' } }],
  });
  const result = (id, content) => ({ role: 'tool', toolCallId: id, toolName: 'find_vms', content });
  const answer = { role: 'assistant', content: 'The answer.' };
  const rowsTurn = [user, call('c1'), result('c1', '[{"vm":"a"}]'), answer];
  const emptyTurn = [user, call('c1'), result('c1', '[]'), answer];
  const ledger = {
    kind: 'ledger',
    toolName: 'find_vms',
    toolCallId: 'c1',
    iteration: 1,
    checked: [{ what: 'inventory' }],
    notChecked: [],
    cannotCover: [],
  };
  const passed = (extra) => ({
    status: 'passed',
    mode: 'enforce',
    candidateDigest: 'd1',
    ...extra,
  });
  return [
    { id: 'probe:empty-state', state: {}, expectKnown: false },
    { id: 'probe:history-only-no-results', state: { history: [user, answer] }, expectKnown: false },
    { id: 'probe:rows-nothing-declared', state: { history: rowsTurn }, expectKnown: false },
    { id: 'probe:empty-rowset-undeclared', state: { history: emptyTurn }, expectKnown: false },
    {
      id: 'probe:declared-ledger-no-gap-rows',
      state: { history: rowsTurn, coverageDeclared: [ledger] },
      expectKnown: false,
    },
    {
      id: 'probe:validation-passed-observe-mode',
      state: { history: rowsTurn, answerValidation: passed({ mode: 'observe' }) },
      expectKnown: false,
    },
    {
      id: 'probe:validation-passed-no-digest',
      state: { history: rowsTurn, answerValidation: { status: 'passed', mode: 'enforce' } },
      expectKnown: false,
    },
    {
      id: 'probe:validation-passed-enforce-POSITIVE-CONTROL',
      state: { history: rowsTurn, answerValidation: passed() },
      expectKnown: true,
    },
    {
      id: 'probe:validation-passed-but-empty-undeclared',
      state: { history: emptyTurn, answerValidation: passed() },
      expectKnown: false,
    },
  ];
}

// ── run ──────────────────────────────────────────────────────────────────────

const records = collect();
const rows = [];
const silenceViolations = [];
const parity = [];
for (const r of records) {
  if (r.tier === 'excluded') {
    rows.push({ id: r.id, tier: r.tier, source: r.source, why: r.why });
    continue;
  }
  const { a, violations } = silenceCheck(r.record, r.declarations);
  for (const v of violations) silenceViolations.push({ id: r.id, violation: v });
  const shape = a.checked.find((c) => c.check === 'result-shape');
  const row = {
    id: r.id,
    tier: r.tier,
    source: r.source,
    assessment: a.assessment,
    standing: a.standing,
    reasons: a.reasons.map((x) => x.reason),
    checked: a.checked.map(({ layer, check, ran, of }) => ({ layer, check, ran, of })),
    turnFrom: a.turnFrom,
    resultsInTurn: shape?.of ?? 0,
    resultsUnreadable: shape !== undefined ? shape.of - shape.ran : 0,
    ...(r.missing !== undefined && r.missing.length > 0 && { missingFoldKeys: r.missing }),
    ...(r.foldBasis !== undefined && { commitLogFoldBasis: r.foldBasis }),
    ...(r.skipped !== undefined && { commitLogRowsSkipped: r.skipped }),
  };
  rows.push(row);
  if (r.rq3 !== undefined) {
    const turnStarts = r.rq3.events.filter((e) => e.type === 'agentfootprint.agent.turn_start');
    // No rows key is handed to RQ3: the tools these records call declare none (fixture A's app
    // declares `rowsAt` for powerstore_get_volumes only, which is turn 1's call, not this turn's).
    const oracle = rq3(r.rq3.events, r.rq3.entity, undefined);
    const fold = foldClass(a);
    parity.push({
      id: r.id,
      arm: r.rq3.arm,
      entity: r.rq3.entity,
      turnsInEvents: turnStarts.length,
      rq3: oracle,
      fold,
      standing: a.standing,
      agree: oracle === fold,
      difference: oracle === fold ? null : 'UNEXPLAINED — see notes',
    });
  }
}

const probeRows = probes().map((p) => {
  const a = assessAnswer({ snapshot: { sharedState: p.state } });
  const ok = (a.assessment === 'known') === p.expectKnown;
  if (!ok) silenceViolations.push({ id: p.id, violation: `known=${a.assessment === 'known'}` });
  return {
    id: p.id,
    assessment: a.assessment,
    standing: a.standing,
    expectKnown: p.expectKnown,
    ok,
  };
});

const mixOf = (tier) => {
  const m = Object.fromEntries(STANDINGS.map((s) => [s, 0]));
  for (const r of rows.filter((x) => x.tier === tier)) m[r.standing] += 1;
  return m;
};
const reasonsOf = (tier) => {
  const m = {};
  for (const r of rows.filter((x) => x.tier === tier))
    for (const reason of r.reasons) m[reason] = (m[reason] ?? 0) + 1;
  return m;
};
const unread = (tier) => {
  const t = rows.filter((x) => x.tier === tier);
  const of = t.reduce((n, r) => n + (r.resultsInTurn ?? 0), 0);
  const un = t.reduce((n, r) => n + (r.resultsUnreadable ?? 0), 0);
  return { resultsInTurn: of, unreadable: un, share: of === 0 ? null : un / of };
};

const results = {
  bench: 'honesty step 1 — the standing fold over the recorded runs',
  rule: 'bench/standing-fold/RULE.md',
  costUsd: 0,
  modelCalls: 0,
  ranAt: new Date().toISOString(),
  counts: {
    full: rows.filter((r) => r.tier === 'full').length,
    excerpt: rows.filter((r) => r.tier === 'excerpt').length,
    excluded: rows.filter((r) => r.tier === 'excluded').length,
    unreadable: unreadable().length,
    silenceProbes: probeRows.length,
  },
  standingMix: { full: mixOf('full'), excerpt: mixOf('excerpt') },
  reasons: { full: reasonsOf('full'), excerpt: reasonsOf('excerpt') },
  resultShape: { full: unread('full'), excerpt: unread('excerpt') },
  parityInRepoRecordings: parity,
  noKnownFromSilence: { violations: silenceViolations, probes: probeRows },
  records: rows,
  unreadableFiles: unreadable(),
};

const outFile = join(HERE, 'results.json');
writeFileSync(outFile, `${JSON.stringify(results, null, 2)}\n`);
console.log(
  JSON.stringify(
    {
      counts: results.counts,
      standingMix: results.standingMix,
      reasons: results.reasons,
      resultShape: results.resultShape,
      parity: parity.map(({ id, rq3: o, fold, agree }) => ({ id, rq3: o, fold, agree })),
      silenceViolations: silenceViolations.length,
      probes: probeRows.map((p) => `${p.ok ? 'ok ' : 'BAD'} ${p.id} → ${p.standing}`),
    },
    null,
    2,
  ),
);
console.log(`wrote ${relative(ROOT, outFile)}`);
