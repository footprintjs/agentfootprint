import type { AssessmentReason } from './types.js';

/** Common pure vocabulary, shared by declaration stages without sibling-stage imports. */
export const PERIOD_REASONS: Readonly<Record<string, AssessmentReason>> = {
  'not-held': 'period-not-held',
  'partly-held': 'period-partly-held',
  unknown: 'period-unknown',
  undeclared: 'period-undeclared',
};
export const PERIOD_QUALIFIERS = {
  differs: 'period-differs-from-asked',
  beyondRetention: 'period-beyond-retention',
} as const satisfies Readonly<Record<string, AssessmentReason>>;
const periodReasons = new Set<AssessmentReason>([
  ...Object.values(PERIOD_REASONS),
  ...Object.values(PERIOD_QUALIFIERS),
]);
export const isPeriodDeclarationReason = (reason: AssessmentReason): boolean =>
  periodReasons.has(reason);

/** Declaration witnesses, including a period's joined argument; all other evidence stays native. */
export function isDeclarationWitness(
  holder: string,
  kind: unknown,
  reason: AssessmentReason,
): boolean {
  if (holder === 'coverageDeclared')
    return (
      (kind === 'ledger' || kind === 'absence') &&
      (reason === 'coverage-gap' || reason === 'declared-absent')
    );
  return (
    holder === 'findingsLedger' &&
    (kind === 'period' || kind === 'argument') &&
    isPeriodDeclarationReason(reason)
  );
}

export type ReasonWitnessKind = 'ordinary' | 'argument' | 'answer' | 'period' | 'retention-refusal';
type ReasonClass = 'input' | 'result' | 'settlement' | 'turn';

const CLASSES: Readonly<Record<AssessmentReason, ReasonClass>> = {
  asked: 'turn',
  'argument-asked': 'turn',
  'argument-assumed': 'input',
  'argument-unverified': 'input',
  'argument-read': 'input',
  'value-contingent': 'input',
  'unsupported-argument': 'input',
  'call-not-completed': 'settlement',
  'result-withheld': 'settlement',
  'work-not-finished': 'result',
  'coverage-gap': 'result',
  'declared-absent': 'result',
  'empty-undeclared': 'result',
  'period-not-held': 'result',
  'period-partly-held': 'result',
  'period-unknown': 'result',
  'period-undeclared': 'result',
  'period-differs-from-asked': 'result',
  'period-beyond-retention': 'result',
  'sources-conflict': 'result',
  'column-type-mismatch': 'result',
  'missing-column': 'result',
  'value-unsupported': 'turn',
  'value-survived-revision': 'turn',
  'derived-from-reading': 'turn',
  'script-unmatched': 'turn',
  'stopped-early': 'turn',
  'steps-unfinished': 'turn',
  'step-skipped': 'turn',
  'negative-prose-unverified': 'turn',
  'invariant-violation': 'turn',
  'unsupported-claim': 'turn',
  'claim-unsettled': 'turn',
  'claim-exceeds-search': 'turn',
  'declaration-overclaimed': 'result',
  'answer-check-failed': 'turn',
  'check-unreachable': 'turn',
};

interface ClassifiedReason {
  readonly reason: AssessmentReason;
  readonly witness: ReasonWitnessKind;
  readonly class: ReasonClass;
}

const EXCEPTIONS: readonly ClassifiedReason[] = [
  { reason: 'value-contingent', witness: 'answer', class: 'turn' },
  { reason: 'period-beyond-retention', witness: 'retention-refusal', class: 'settlement' },
];

/** The admission rules follow the witness, including codes shared by two producers. */
export const REASON_WITNESS_CLASSES: readonly ClassifiedReason[] = [
  ...(Object.entries(CLASSES) as [AssessmentReason, ReasonClass][]).map(([reason, kind]) => ({
    reason,
    class: kind,
    witness: primaryWitness(reason),
  })),
  ...EXCEPTIONS,
];

function primaryWitness(reason: AssessmentReason): ReasonWitnessKind {
  if (reason === 'value-contingent') return 'argument';
  if (reason === 'period-beyond-retention') return 'period';
  return 'ordinary';
}

export function reasonClassOf(reason: AssessmentReason, witness: ReasonWitnessKind): ReasonClass {
  return (
    EXCEPTIONS.find((row) => row.reason === reason && row.witness === witness)?.class ??
    CLASSES[reason]
  );
}
