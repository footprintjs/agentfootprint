/** Sequential, fixed-candidate comparison. Admission is the frozen PR 207
 * application contract; only the corrected runtime's interpretation changes. */
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
export const STAGES = Object.freeze(['baseline', 'kindOnly', 'kindAndSubject']);
const MODES = { kindOnly: 'kind-only', kindAndSubject: 'evidence-owned' };
const add = (counts, key) => (counts[key] = (counts[key] ?? 0) + 1);
const COMPLETE_ABSENCE_NOTICE =
  'The requested complete-list claim is not established; only this absence is.';

function renderedStage(candidate, record, lib, mode) {
  const result = lib.renderNegativeCandidate(
    candidate,
    { field: 'negatives', tools: Object.keys(record.tools), unestablished: 'withhold' },
    record,
    (call) => call.trustedContext === true && record.ledgerComplete,
    mode,
  );
  return {
    checks: result.answer.checks,
    claims: result.answer.claims,
    allowed: result.allowed,
    correctionNeeded: result.correction,
  };
}

/** No candidate fields, evidence rows or source identities are rewritten. */
export function compareStages(artifact, scheduled, baselineLib, correctedLib) {
  const before = JSON.stringify(artifact);
  const baseline = reparseTrial(artifact, scheduled, baselineLib);
  const trial = { row: scheduled, baseline, stages: null, transitions: [] };
  if (baseline.status !== 'schema-pass') return trial;
  const record = artifact.raw.turns.at(-1).nativeRecord;
  if (hash(JSON.stringify(record)) !== baseline.evidenceSha256)
    throw new Error('Staged comparison evidence differs from admitted baseline.');
  const candidate = baseline.candidate;
  const candidateBefore = JSON.stringify(candidate);
  const stages = { baseline: baseline.counterfactual };
  for (const [stage, mode] of Object.entries(MODES))
    stages[stage] = renderedStage(candidate, record, correctedLib, mode);
  const count = candidate.negatives.length;
  for (const stage of STAGES) {
    const checks = stages[stage].checks;
    if (checks.length !== count || checks.some((check, index) => check.index !== index))
      throw new Error('Staged comparison changed the fixed claim denominator/order.');
  }
  if (JSON.stringify(artifact) !== before || JSON.stringify(candidate) !== candidateBefore)
    throw new Error('Staged comparison mutated original inputs.');
  trial.stages = stages;
  trial.transitions = candidate.negatives.map((entry, index) => ({
    index,
    requestedKind: entry.kind,
    stages: Object.fromEntries(
      STAGES.map((stage) => {
        const check = stages[stage].checks[index];
        return [
          stage,
          {
            code: check.code,
            kind: check.kind,
            disposition: check.disposition,
            results: check.results,
            renderedKind: stages[stage].claims[index]?.kind,
            completeAbsenceNotice:
              entry.kind === 'complete' &&
              stages[stage].claims[index]?.statement?.includes(COMPLETE_ABSENCE_NOTICE) === true,
          },
        ];
      }),
    ),
  }));
  trial.evidenceUnchanged = true;
  return trial;
}

const emptyStage = () => ({
  established: 0,
  unestablished: 0,
  nonemptyAllEstablishedAnswers: 0,
  correctionNeededAnswers: 0,
  requestedCompleteSlots: 0,
  completeRequestedRenderedAbsence: 0,
  completeRequestsWithAbsenceFallback: 0,
  codes: {},
  notes: {},
});
const empty = () => ({
  trials: 0,
  admittedAnswers: 0,
  claims: 0,
  zeroClaimAnswers: 0,
  stages: Object.fromEntries(STAGES.map((stage) => [stage, emptyStage()])),
  baselineToKind: {},
  kindToSubject: {},
});

export function summarizeStages(trials, expected = ORIGINAL_DENOMINATORS) {
  const historical = summarizeReparse(trials.map((t) => t.baseline));
  const counts = historical.totals;
  const denominators = {
    trials: counts.trials,
    schemaPass: counts['schema-pass'] ?? 0,
    schemaFail: counts['schema-fail'] ?? 0,
    noAnswer: counts['no-answer'] ?? 0,
    zeroClaims: counts['zero-claim-answers'] ?? 0,
    claims: counts.claims ?? 0,
    established: counts['claims-established'] ?? 0,
  };
  if (!isDeepStrictEqual(denominators, expected))
    throw new Error('Historical replay denominator/result drift.');
  const totals = empty(),
    groups = new Map();
  for (const trial of trials) {
    const { model, cell, arm } = trial.row;
    const key = JSON.stringify([model, cell, arm]);
    if (!groups.has(key)) groups.set(key, { model, cell, arm, counts: empty() });
    for (const group of [totals, groups.get(key).counts]) {
      group.trials++;
      if (!trial.stages) continue;
      group.admittedAnswers++;
      if (trial.baseline.zeroClaims) group.zeroClaimAnswers++;
      group.claims += trial.transitions.length;
      for (const stage of STAGES) {
        const target = group.stages[stage],
          result = trial.stages[stage];
        if (result.correctionNeeded) target.correctionNeededAnswers++;
        if (result.checks.length > 0 && result.checks.every((row) => row.code === 'established'))
          target.nonemptyAllEstablishedAnswers++;
        for (const row of result.checks) {
          target[row.code === 'established' ? 'established' : 'unestablished']++;
          add(target.codes, row.code);
          for (const note of row.notes ?? []) add(target.notes, note);
        }
      }
      for (const row of trial.transitions) {
        const { baseline, kindOnly, kindAndSubject } = row.stages;
        add(group.baselineToKind, `${baseline.code} -> ${kindOnly.code}`);
        add(group.kindToSubject, `${kindOnly.code} -> ${kindAndSubject.code}`);
        if (row.requestedKind === 'complete')
          for (const stage of STAGES) {
            group.stages[stage].requestedCompleteSlots++;
            if (['none', 'not-found'].includes(row.stages[stage].renderedKind))
              group.stages[stage].completeRequestedRenderedAbsence++;
            if (row.stages[stage].completeAbsenceNotice)
              group.stages[stage].completeRequestsWithAbsenceFallback++;
          }
      }
    }
  }
  return {
    kind: 'counterfactual-sequential-kind-subject-comparison',
    denominators,
    totals,
    groups: [...groups.values()],
    baselineSchemaReasons: Object.fromEntries(
      Object.entries(counts).filter(([key]) => key.startsWith('schema-issue:')),
    ),
    stages: {
      baseline: 'Unchanged PR 207 renderer and application admission.',
      kindOnly: 'Corrected requested-kind verification, retaining the old exact-subject rule.',
      kindAndSubject:
        'Same corrected kind verification, then bounded normalized subject containment.',
    },
    limitations: [
      'All 784 trials and 540 admitted claim slots are fixed. No response, native record or bank fixture is rewritten.',
      'The original parser retains 120 schema failures and 43 no-answer trials; 84 zero-claim answers are not established negatives.',
      'Each stage reports its first blocked reason. Resolving a prior reason may expose another; counts are not additive estimates of false holds.',
      'The two corrected stages share runtime admission, trust and evidence guards. Their only mode difference is exact versus normalized containment subject matching.',
      'A complete-request rendering an absence is counted separately and never proves the requested completeness proposition.',
      'No model, tool, correction or live delivery runs. These are counterfactual checker outcomes, not factual accuracy, usefulness or semantic repetition measurements.',
      'Superseded evidence-owned v1/v2/v3 analyses remain historical artifacts; their over-establishment is not the baseline of this comparison.',
    ],
  };
}
