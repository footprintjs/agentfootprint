import { readCallOccurrenceKey } from '../../../lib/callOccurrence.js';
import { isRecord, str } from './recordValues.js';
import type { ArgumentRowRead } from './argumentRows.js';
import { fire, type Gathered } from './gathered.js';
import { statePointer } from './pointer.js';
import type { AssessmentPointer, AssessmentReason } from './types.js';

/** One `period` row of this turn — one judged call. */
export interface PeriodRowRead {
  readonly index: number;
  readonly historyIndex?: number;
  readonly verdict: string;
  /** The argument the tool's `ToolPeriod` names — the join key to the call's argument row. */
  readonly argument?: string;
  /** The time layer's checks on the row (step T8) — filed only under `.time()`. */
  readonly differs: boolean;
  readonly beyondRetention: boolean;
}

/**
 * This turn's period verdicts (honesty layer 3): EVERY `period` row whose
 * `turn` is the run's `turnNumber`, in ledger order. A record with no
 * `turnNumber` reads every period row (it may over-report; it never hides).
 *
 * Never collapsed by call id. The layer files one row per judged call — each
 * batch judged once (`honesty/resultsInput.ts` · `batchToJudge`) — so a second row
 * under an id is ANOTHER call: a provider's synthetic counter restarts with
 * each provider instance, so a resumed leg repeats the ids of the leg that
 * failed (whose rows ride the checkpoint, under the same turn), and a provider
 * may reuse an id across batches. "The last per call" would let a later
 * `covered` hide an earlier `not-held` the answer can still rest on.
 */
export function periodRows(
  state: Readonly<Record<string, unknown>>,
  resultIndexOf: (row: Readonly<Record<string, unknown>>) => number | undefined,
  nativeFacts: (row: Readonly<Record<string, unknown>>, address?: number) => boolean,
): readonly PeriodRowRead[] {
  const ledger = Array.isArray(state.findingsLedger) ? state.findingsLedger : [];
  const turn = typeof state.turnNumber === 'number' ? state.turnNumber : undefined;
  const rows: PeriodRowRead[] = [];
  ledger.forEach((row: unknown, index) => {
    if (!isRecord(row) || row.kind !== 'period') return;
    if (turn !== undefined && row.turn !== turn) return;
    const verdict = str(row.verdict);
    if (
      verdict === undefined ||
      (str(row.toolCallId) === undefined && readCallOccurrenceKey(row) === undefined)
    )
      return;
    const argument = str(row.argument);
    const historyIndex = resultIndexOf(row);
    if (!nativeFacts(row, historyIndex)) return;
    rows.push({
      index,
      ...(historyIndex !== undefined && { historyIndex }),
      verdict,
      ...(argument !== undefined && { argument }),
      differs: isRecord(row.differs),
      beyondRetention: row.beyondRetention === true,
    });
  });
  return rows;
}

/** The reason each period verdict fires — `covered` fires none. */
export const PERIOD_REASONS: Readonly<Record<string, AssessmentReason>> = {
  'not-held': 'period-not-held',
  'partly-held': 'period-partly-held',
  unknown: 'period-unknown',
  undeclared: 'period-undeclared',
};

/**
 * Layer 3, the results layer's verdicts: each period row of this turn — the
 * store did not hold the period the read asked for (`not-held`), held only
 * part of it (`partly-held`), could not say (`unknown`, adopted Q33: "not
 * sure" by default, on a non-empty result too), or the result said nothing
 * about its period though its tool declares a period argument (`undeclared`).
 * `covered` fires nothing — and supports nothing: a period the store held
 * keeps a reason from firing, never more.
 *
 * THE JOIN (results.md § 3.7): the inputs layer owns WHO chose the period
 * (the call's `argument` row for the argument its `ToolPeriod` names), this
 * layer owns WHAT the read covered. A period reason can witness both rows
 * when the occurrence and the argument name match. Neither parses the other's
 * words, so a reader can say "the hour you asked about" or "the 2 hours the
 * tool's rule assumed". Files the `result-period` check when the layer filed
 * any verdict this turn.
 */
export function readPeriodVerdicts(
  rows: readonly PeriodRowRead[],
  argumentVerdicts: readonly ArgumentRowRead[],
  g: Gathered,
): void {
  if (rows.length === 0) return;
  const witness: AssessmentPointer[] = [];
  for (const row of rows) {
    const at = statePointer('findingsLedger', row.index, 'verdict');
    witness.push(at);
    const chosenBy =
      row.historyIndex === undefined || row.argument === undefined
        ? undefined
        : argumentVerdicts.find(
            (a) => a.historyIndex === row.historyIndex && a.argument === row.argument,
          );
    const fireJoined = (reason: AssessmentReason, pointer: AssessmentPointer): void => {
      fire(g, reason, pointer);
      if (chosenBy !== undefined) {
        fire(g, reason, statePointer('findingsLedger', chosenBy.index, 'argument'));
      }
    };
    // The time layer's result checks (step T8), under `.time()` only: the
    // read is not what was asked (TQ8 — `extra` alone too), or the window was
    // older than the source keeps.
    if (row.differs) {
      fireJoined('period-differs-from-asked', statePointer('findingsLedger', row.index, 'differs'));
    }
    if (row.beyondRetention) {
      fireJoined(
        'period-beyond-retention',
        statePointer('findingsLedger', row.index, 'beyondRetention'),
      );
    }
    const reason = PERIOD_REASONS[row.verdict];
    if (reason === undefined) continue;
    fireJoined(reason, at);
  }
  g.checked.push({ layer: 3, check: 'result-period', ran: rows.length, of: rows.length, witness });
}
