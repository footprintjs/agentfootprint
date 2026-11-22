import { readEmptiness, type ValueDeclaration } from '../emptiness.js';
import type { IssuedPairs } from '../placedTickets.js';
import { groupOccurrenceEvidence } from '../recordedCalls.js';
import type { CoverageRow } from './coverageRows.js';
import { fire, type Gathered } from './gathered.js';
import { historyPointer, statePointer } from './pointer.js';
import type { TurnResult } from './turnResults.js';
import type { AssessmentDeclarations, AssessmentPointer } from './types.js';
import { declarationsForResult } from './results/coverage/declarations.js';

/** Layer 3, the tools' own declarations: every absence and every declared gap. */
export function readCoverageRows(coverage: readonly CoverageRow[], g: Gathered): void {
  for (const row of coverage) {
    const at = statePointer('coverageDeclared', row.index, 'kind');
    if (row.kind === 'absence') fire(g, 'declared-absent', at);
    if (row.gap) fire(g, 'coverage-gap', at);
  }
}

/**
 * One result of the turn, with what the record holds about its call: the
 * committed coverage rows, and — only when there are none — the envelope in
 * the result itself (`agent/emptiness.ts` · `declaredByValue`).
 */
interface ResultRead {
  readonly result: TurnResult;
  readonly at: AssessmentPointer;
  readonly rows: readonly CoverageRow[];
  readonly declared: boolean;
  /**
   * The result's OWN envelope, read when its call has no committed row: the run
   * filed none (an envelope it never recognized, such as JSON text), or the row
   * was lost on the way here (a history restored by `resumeOnError` carries no
   * `coverageDeclared`; a trimmed recording drops it). Never read as silence.
   */
  readonly own?: ValueDeclaration;
}

export function readResults(
  results: readonly TurnResult[],
  coverage: readonly CoverageRow[],
): readonly ResultRead[] {
  const { byOccurrence } = groupOccurrenceEvidence(coverage, (row) => row.historyIndex);
  return results.map((result) => {
    return {
      result,
      at: historyPointer(result),
      ...declarationsForResult(result, byOccurrence.get(result.index) ?? []),
    };
  });
}

/**
 * Layer 3, what came back: every result of the turn through the ONE emptiness
 * reader. A call with committed coverage rows is read through the door those
 * rows are; a call with none is handed NO door, so the reader reads the
 * envelope in the bytes by the rule the run's recognizer files rows — and a gap
 * that envelope lists is a reason too.
 */
export function readTurnResults(
  reads: readonly ResultRead[],
  declarations: AssessmentDeclarations | undefined,
  issued: IssuedPairs,
  opportunities: number,
  g: Gathered,
  legacyReasons = true,
): void {
  const readable: AssessmentPointer[] = [];
  for (const { result, at, rows, own } of reads) {
    const absenceRow = rows.some((c) => c.kind === 'absence');
    const door =
      rows.length > 0
        ? { absent: absenceRow, bounded: rows.some((c) => c.kind === 'ledger') }
        : undefined;
    const rowsAt =
      result.toolName !== undefined ? declarations?.tools?.[result.toolName]?.rowsAt : undefined;
    const reading = readEmptiness(result.content, {
      placement: { toolCallId: result.toolCallId, issued },
      ...(door !== undefined && { door }),
      ...(rowsAt !== undefined && { rowsAt }),
    });
    if (reading.emptiness !== 'unknown') readable.push(at);
    // An empty rowset inside a declared boundary, or an absence no row holds; an absence row fired for itself.
    const fromBytes = legacyReasons || reading.source === 'app';
    if (fromBytes && reading.emptiness === 'declared-absent' && !absenceRow)
      fire(g, 'declared-absent', at);
    if (fromBytes && reading.emptiness === 'undeclared-empty' && rows.length === 0) {
      fire(g, 'empty-undeclared', at);
    }
    // A gap the result's own envelope lists, when no row holds it.
    if (legacyReasons && own?.gap === true) fire(g, 'coverage-gap', at);
  }
  if (opportunities > 0) {
    g.checked.push({
      layer: 3,
      check: 'result-shape',
      ran: readable.length,
      of: opportunities,
      witness: readable,
    });
  }
}

/**
 * A call declared coverage when its rows or its own envelope say so.
 * Unplaced coverage rows remain evidence. They add no call to either count.
 */
export function readTurnCalls(
  reads: readonly ResultRead[],
  coverage: readonly CoverageRow[],
  opportunities: number,
  g: Gathered,
): void {
  const witness = coverage
    .filter((row) => row.historyIndex !== undefined)
    .map((c) => statePointer('coverageDeclared', c.index, 'kind'));
  let declared = 0;
  for (const { at, declared: hasDeclaration, own } of reads) {
    if (hasDeclaration) declared += 1;
    if (own !== undefined) witness.push(at);
  }
  const of = opportunities;
  if (of > 0) {
    g.checked.push({
      layer: 3,
      check: 'tool-coverage',
      ran: declared,
      of,
      witness,
    });
  }
}

/** Settlement is assessed separately from facts drawn from a served result. */
export function readCallOutcomes(
  results: readonly TurnResult[],
  recovered: ReadonlySet<number>,
  g: Gathered,
): void {
  for (const result of results) {
    const at = historyPointer(result);
    if (
      (result.outcome !== undefined || result.outcomePath !== undefined) &&
      !recovered.has(result.index)
    ) {
      fire(g, 'call-not-completed', {
        ...at,
        path: result.batchRefusal
          ? '/toolResultExecution'
          : result.rewritten
          ? '/content'
          : result.outcomePath ?? '/outcome',
      });
    } else if (result.reportedStatus !== undefined && !recovered.has(result.index)) {
      fire(g, 'work-not-finished', {
        ...at,
        path: result.rewritten ? '/content' : '/reportedStatus',
      });
    }
  }
}
