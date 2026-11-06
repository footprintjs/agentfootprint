/**
 * assessment/integrityReasons — what each integrity finding does to the
 * answer's standing, as one table, and the fold step that reads it.
 *
 * Pattern: one frozen table plus one pure reader over the committed ledger.
 * Role:    the registry of the Context Integrity family. A check is one row
 *          here: its finding kind, whether it lowers the answer's standing
 *          (a `reason`) or only leaves a `note`, what it reads and who decides.
 *          `Record<ContextErrorKind, …>` makes a new kind without a row a
 *          compile error, and `src/integrity/README.md` is the contract.
 * Emits:   N/A.
 *
 * WHY A KIND IS A NOTE. A note marks a place to look, not a problem found about
 * this answer: `dangling-reference` fires at offer time for a tool the model
 * may never call; `empty-lookup` and `prior-turn-evidence` are advisory by
 * construction, because an empty result can be true and referring back is
 * ordinary conversation. A note never changes the standing and never counts as
 * a check that ran.
 *
 * A SAVED RECORDING IS UNTRUSTED. A kind this table does not hold, and a row
 * that is not this shape, are passed over: they fire nothing and support
 * nothing, so a row can never raise the standing. `support` is set only by a
 * passed enforcing report, in `assess.ts`.
 */

import type { ContextErrorKind } from '../../../integrity/finding/types.js';
import { statePointer } from './pointer.js';
import type { AnswerAssessment, AssessmentPointer, AssessmentReason } from './types.js';

/** What a check reads to reach its verdict. */
export type IntegrityCheckReads = 'tool-declaration' | 'record' | 'model-declaration';

/** Who decides the verdict: the library's code, a rule the app wrote, or the model and then code. */
export type IntegrityCheckDecider = 'code' | 'your-rule' | 'model-then-code';

export interface IntegrityFindingEntry {
  /** The reason this kind fires, or `'note'` when it leaves the standing alone. */
  readonly effect: AssessmentReason | 'note';
  readonly reads: readonly IntegrityCheckReads[];
  readonly decidedBy: IntegrityCheckDecider;
  /** No check ships for this kind, so no run can file it. */
  readonly noCheck?: true;
}

/** Every finding kind, once. `noCheck` kinds fail safe as a note if a recording claims one. */
export const INTEGRITY_FINDINGS: Readonly<Record<ContextErrorKind, IntegrityFindingEntry>> =
  Object.freeze({
    'invariant-violation': { effect: 'invariant-violation', reads: ['record'], decidedBy: 'code' },
    'unsupported-argument': {
      effect: 'unsupported-argument',
      reads: ['tool-declaration', 'record'],
      decidedBy: 'code',
    },
    'dangling-reference': {
      effect: 'note',
      reads: ['tool-declaration', 'record'],
      decidedBy: 'code',
    },
    'duplicate-execution': { effect: 'note', reads: [], decidedBy: 'code', noCheck: true },
    'unsupported-claim': {
      effect: 'unsupported-claim',
      reads: ['record', 'model-declaration'],
      decidedBy: 'your-rule',
    },
    'empty-lookup': { effect: 'note', reads: ['tool-declaration', 'record'], decidedBy: 'code' },
    'column-type-mismatch': {
      effect: 'column-type-mismatch',
      reads: ['tool-declaration', 'record'],
      decidedBy: 'code',
    },
    'missing-column': {
      effect: 'missing-column',
      reads: ['tool-declaration', 'record'],
      decidedBy: 'code',
    },
    'prior-turn-evidence': { effect: 'note', reads: ['record'], decidedBy: 'code' },
  });

/** Whether `value` is a finding kind the table holds — never an inherited key such as `constructor`. */
export function isIntegrityFindingKind(value: unknown): value is ContextErrorKind {
  return (
    typeof value === 'string' && Object.prototype.hasOwnProperty.call(INTEGRITY_FINDINGS, value)
  );
}

/** What the fold takes from this turn's integrity rows. */
export interface IntegrityReading {
  readonly fired: readonly { readonly reason: AssessmentReason; readonly at: AssessmentPointer }[];
  readonly notes: NonNullable<AnswerAssessment['notes']>;
}

const isRecord = (value: unknown): value is Readonly<Record<string, unknown>> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

/**
 * This turn's `integrity-finding` and `claim-unsettled` rows, through the
 * table. A record with no `turnNumber` reads every such row (it may over-report;
 * it never hides). Filed only while the answer layer is armed, so an unarmed
 * record holds none and this reads nothing.
 */
export function readIntegrityRows(state: Readonly<Record<string, unknown>>): IntegrityReading {
  const ledger: readonly unknown[] = Array.isArray(state.findingsLedger)
    ? state.findingsLedger
    : [];
  const turn = typeof state.turnNumber === 'number' ? state.turnNumber : undefined;
  const fired: { reason: AssessmentReason; at: AssessmentPointer }[] = [];
  const noted = new Map<ContextErrorKind, AssessmentPointer[]>();
  ledger.forEach((row, index) => {
    if (!isRecord(row) || (turn !== undefined && row.turn !== turn)) return;
    if (row.kind === 'claim-unsettled') {
      fired.push({ reason: 'claim-unsettled', at: statePointer('findingsLedger', index, 'field') });
      return;
    }
    if (row.kind !== 'integrity-finding' || !isIntegrityFindingKind(row.finding)) return;
    const at = statePointer('findingsLedger', index, 'finding');
    const { effect } = INTEGRITY_FINDINGS[row.finding];
    if (effect !== 'note') fired.push({ reason: effect, at });
    else noted.set(row.finding, [...(noted.get(row.finding) ?? []), at]);
  });
  return { fired, notes: [...noted].map(([finding, witness]) => ({ finding, witness })) };
}
