import { isRecord } from './recordValues.js';
import type { AnswerAssessment } from './types.js';

/** One value a tool's rule assumed this turn — the "Assumed" block's line, as data. */
export interface StandingAssumedValue {
  readonly toolName: string;
  readonly argument: string;
  readonly value: string;
  readonly hidden: boolean;
}

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
// the line), answer-account/facts/standing.ts · appendedStandingLine (to find it again in the answer)
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

/** The clause for one assumed value — its value only in the tool's own view; the tool in the app's words when it declares them. */
function assumedClause(line: StandingAssumedValue, displayName: string | undefined): string {
  const by = displayName === undefined ? `${line.toolName}'s rule` : `the rule of ${displayName}`;
  return line.hidden
    ? `${line.argument} was assumed by ${by} (its value is hidden by the tool's view), not given by you`
    : `${line.argument} = ${JSON.stringify(line.value)} was assumed by ${by}, not given by you`;
}

/** One clause per distinct (tool, argument, shown value), in the order the rows were filed. */
export function assumedClauses(
  lines: readonly StandingAssumedValue[],
  displayNames: ReadonlyMap<string, string> | undefined,
): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const line of lines) {
    const key = JSON.stringify([line.toolName, line.argument, line.hidden ? '' : line.value]);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(assumedClause(line, displayNames?.get(line.toolName)));
  }
  return out;
}
