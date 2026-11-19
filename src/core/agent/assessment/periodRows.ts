import { isRecord, str } from './recordValues.js';

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
    if (str(row.toolCallId) === undefined || verdict === undefined) return;
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
