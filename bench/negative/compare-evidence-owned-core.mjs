/** Compare two runtime renderers over the SAME historically admitted candidates.
 * The historical parser/admission is deliberately unchanged. No data repair,
 * model call, fuzzy label matching, or evidence reconstruction occurs here. */
import { isDeepStrictEqual } from 'node:util';
import { hash, reparseTrial, summarizeReparse } from './reparse-core.mjs';

export const ORIGINAL_DENOMINATORS = Object.freeze({
  trials: 784,
  schemaPass: 621,
  schemaFail: 120,
  noAnswer: 43,
  zeroClaims: 84,
  claims: 540,
  established: 20,
});

export function compareTrial(artifact, scheduled, baselineLib, currentLib) {
  const original = JSON.stringify(artifact);
  const baseline = reparseTrial(artifact, scheduled, baselineLib);
  const result = { row: scheduled, baseline, current: null, transitions: [] };
  if (baseline.status !== 'schema-pass') return result;
  const record = artifact.raw.turns.at(-1).nativeRecord;
  if (hash(JSON.stringify(record)) !== baseline.evidenceSha256)
    throw new Error('Comparison evidence differs from admitted baseline.');
  const candidate = baseline.candidate,
    candidateBefore = JSON.stringify(baseline.candidate);
  const rendered = currentLib.renderNegativeCandidate(
    candidate,
    { field: 'negatives', tools: Object.keys(record.tools), unestablished: 'withhold' },
    record,
    (call) => call.trustedContext === true && record.ledgerComplete,
  );
  const before = baseline.counterfactual.checks,
    after = rendered.answer.checks;
  if (
    before.length !== candidate.negatives.length ||
    after.length !== before.length ||
    before.some((row, index) => row.index !== index || after[index].index !== index)
  )
    throw new Error('Comparison changed the fixed claim denominator.');
  if (JSON.stringify(artifact) !== original || JSON.stringify(candidate) !== candidateBefore)
    throw new Error('Comparison mutated original inputs.');
  result.current = {
    answer: rendered.answer,
    allowed: rendered.allowed,
    correctionNeeded: rendered.correction,
    allClaimsEstablished: after.length > 0 && after.every((c) => c.code === 'established'),
  };
  result.transitions = before.map((prior, index) => ({
    index,
    baselineCode: prior.code,
    currentCode: after[index].code,
    baselineDisposition: prior.disposition,
    currentDisposition: after[index].disposition,
    baselineResults: prior.results,
    currentResults: after[index].results,
  }));
  result.evidenceUnchanged = true;
  return result;
}

const add = (obj, key) => (obj[key] = (obj[key] ?? 0) + 1);
const empty = () => ({
  trials: 0,
  admittedAnswers: 0,
  claims: 0,
  zeroClaimAnswers: 0,
  baselineEstablished: 0,
  currentEstablished: 0,
  currentUnestablished: 0,
  currentNonemptyAllEstablished: 0,
  currentCorrectionNeeded: 0,
  baselineCodes: {},
  currentCodes: {},
  transitions: {},
});

export function summarizeComparison(trials, expected = ORIGINAL_DENOMINATORS) {
  const baseline = summarizeReparse(trials.map((t) => t.baseline));
  const actual = {
    trials: baseline.totals.trials,
    schemaPass: baseline.totals['schema-pass'] ?? 0,
    schemaFail: baseline.totals['schema-fail'] ?? 0,
    noAnswer: baseline.totals['no-answer'] ?? 0,
    zeroClaims: baseline.totals['zero-claim-answers'] ?? 0,
    claims: baseline.totals.claims ?? 0,
    established: baseline.totals['claims-established'] ?? 0,
  };
  if (!isDeepStrictEqual(actual, expected))
    throw new Error('Historical replay denominator/result drift.');
  const totals = empty(),
    groups = new Map();
  for (const trial of trials) {
    const { model, cell, arm } = trial.row,
      key = JSON.stringify([model, cell, arm]);
    if (!groups.has(key)) groups.set(key, { model, cell, arm, counts: empty() });
    for (const counts of [totals, groups.get(key).counts]) {
      counts.trials++;
      if (!trial.current) continue;
      counts.admittedAnswers++;
      if (trial.baseline.zeroClaims) counts.zeroClaimAnswers++;
      if (trial.current.allClaimsEstablished) counts.currentNonemptyAllEstablished++;
      if (trial.current.correctionNeeded) counts.currentCorrectionNeeded++;
      for (const row of trial.transitions) {
        counts.claims++;
        if (row.baselineCode === 'established') counts.baselineEstablished++;
        if (row.currentCode === 'established') counts.currentEstablished++;
        else counts.currentUnestablished++;
        add(counts.baselineCodes, row.baselineCode);
        add(counts.currentCodes, row.currentCode);
        add(counts.transitions, `${row.baselineCode} -> ${row.currentCode}`);
      }
    }
  }
  return {
    kind: 'counterfactual-fixed-candidate-comparison',
    denominators: actual,
    totals,
    groups: [...groups.values()],
    baselineSchemaReasons: Object.fromEntries(
      Object.entries(baseline.totals).filter(([key]) => key.startsWith('schema-issue:')),
    ),
    limitations: [
      'The original 784 trials and 540 historically admitted claims are fixed. No original response or record was changed.',
      'The original application parser decides admission for both sides: 120 schema failures and 43 no-answer trials are retained but not re-admitted under a new schema.',
      'Eighty-four zero-claim answers are not successful established negative answers.',
      'Baseline uses the old runtime renderer. Current uses the new default kind/subject derivation over the exact same saved native record and original candidate.',
      'No fuzzy about matching, kind rewriting, subject rewriting, evidence injection, tool execution, model generation, or correction call occurs in this comparison runner.',
      'New library statements and correction needs are counterfactual only, not original delivery, factual accuracy, usefulness, or semantic repetition measurements.',
      'Newly established claims may expose later blockers. No establishment count from an exploratory reviewer run is assumed.',
    ],
  };
}
