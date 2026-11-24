import { sameRange } from '../../../time/range.js';
import {
  answersOf,
  clockOf,
  readingsOf,
  timeRowIsWellFormed,
  type CallWindowRow,
  type ClockRow,
} from '../../../time/rows.js';
import type { TurnWindow } from '../../../time/windows.js';
import type { TimeInputs } from '../arguments/subflow.js';

function comparisonBindingOf(
  ledger: readonly unknown[] | undefined,
  clock: ClockRow,
): TurnWindow | undefined {
  const first = ledger?.find((value): value is CallWindowRow => {
    if (value === null || typeof value !== 'object') return false;
    const row = value as Readonly<Record<string, unknown>>;
    return (
      row.kind === 'call-window' &&
      row.turn === clock.turn &&
      row.comparison !== undefined &&
      timeRowIsWellFormed(row)
    );
  });
  const person = first?.person;
  if (person?.source !== 'answered') return undefined;
  const range = { from: person.from, to: person.to };
  const confirmation = answersOf(ledger, clock.turn, { includeComparison: true }).find(
    (answer) => answer.mention === person.mention && sameRange(answer, range),
  );
  return {
    source: 'answered',
    range,
    zone: confirmation?.zone ?? clock.zone,
    ...(person.mention !== undefined && { mention: person.mention }),
    ...(person.endpoint !== undefined && { endpoint: person.endpoint }),
  };
}

/**
 * This turn's clock and readings, off the parent's ledger — `undefined` when
 * the turn has no clock (a turn paused by a runtime without the layer).
 */
export function timeInputsOf(parent: Record<string, unknown>): TimeInputs | undefined {
  const ledger = parent.findingsLedger as readonly unknown[] | undefined;
  const clock = clockOf(ledger);
  if (clock === undefined) return undefined;
  const turn = parent.turnNumber as number;
  return {
    clock,
    readings: [...readingsOf(ledger, turn)],
    answers: [...answersOf(ledger, turn)],
    ...(clock.turn === turn &&
      clock.comparison !== undefined && {
        comparisonAnswers: answersOf(ledger, turn, { includeComparison: true }),
        comparisonBoundWindow: comparisonBindingOf(ledger, clock),
      }),
  };
}
