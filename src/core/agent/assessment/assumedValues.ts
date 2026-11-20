import { isRecord } from './recordValues.js';
import type { AnswerAssessment } from './types.js';

/**
 * Where this turn's assumed values are read from: the ledger, the turn, and
 * the before-tool rewrites a row may have been superseded by — handed to the
 * "Assumed" block's own reader (`arguments/serve/assumed.ts` · `assumedLinesFor`),
 * which the caller loads: the answer layer's stage through `import()` (the
 * optional-family law), the answer account statically.
 */
export interface AssumedValuesSource {
  readonly ledger: readonly { readonly kind: string }[];
  readonly turn: number;
  readonly readDecisions: (() => readonly unknown[]) | undefined;
}

// FOLD · the one choice of what the line's assumed values are read from
// consumers read this and never re-derive it: assessment/stage.ts · assessAnswerStage (to compose
// the line), answer-account/account.ts · appendedStandingLine (to find it again in the answer)
/**
 * The source of the line's assumed values in `record` (committed state) —
 * `undefined` when the line names none: no `argument-assumed` reason, no
 * turn, or no `argument` row. Rows that are not objects are passed over, so a
 * damaged record is read, never thrown on.
 */
export function assumedValuesSourceOf(
  assessment: AnswerAssessment,
  record: Readonly<Record<string, unknown>>,
): AssumedValuesSource | undefined {
  const assumed = assessment.reasons.find((row) => row.reason === 'argument-assumed');
  if (assumed === undefined) return undefined;
  const turn = record.turnNumber;
  if (typeof turn !== 'number') return undefined;
  const rows: readonly unknown[] = Array.isArray(record.findingsLedger)
    ? record.findingsLedger
    : [];
  const accepted = new Set(
    assumed.witness.flatMap((pointer) =>
      pointer.kind === 'state' && pointer.key === 'findingsLedger'
        ? [Number(pointer.path.split('/')[1])]
        : [],
    ),
  );
  const ledger = rows.filter(
    (row, index): row is { readonly kind: string } =>
      accepted.has(index) && isRecord(row) && typeof row.kind === 'string',
  );
  if (!ledger.some((row) => row.kind === 'argument')) return undefined;
  const decisions = record.middlewareDecisions;
  return {
    ledger,
    turn,
    readDecisions: Array.isArray(decisions) ? () => decisions as readonly unknown[] : undefined,
  };
}
