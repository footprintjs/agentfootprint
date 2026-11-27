import type { TypedScope } from 'footprintjs';
import type { AgentState } from '../../types.js';
import type { FindingsLedger } from '../../findings/types.js';
import { activeTimeReadings } from '../../honesty/timeInputs.js';
import { answersOf, type TimeReadingRow } from '../../../../time/rows.js';
import { isOpenForPerson } from '../../../../time/windows.js';

/**
 * Under `.time({ reader })`: this turn's ONE open mention — the row the lazy
 * ask is about: a reading to confirm, a zone to name, or words the library
 * could not read (`time/windows.ts` · `isOpenForPerson`, the one owner). A mention
 * the person already settled in the time ask (its `time-answer` row) is not
 * open: it is asked once per turn.
 */
export function openReadingOf(scope: TypedScope<AgentState>, allowProven: boolean): TimeReadingRow | undefined {
  const ledger = scope.findingsLedger as FindingsLedger | undefined;
  const turn = scope.turnNumber as number;
  const answered = new Set(answersOf(ledger, turn).map((a) => a.mention));
  const open = activeTimeReadings(scope, allowProven).filter(
    (row) => isOpenForPerson(row) && !answered.has(row.mention ?? 0),
  );
  return open.length === 1 ? (structuredClone(open[0]) as TimeReadingRow) : undefined;
}
