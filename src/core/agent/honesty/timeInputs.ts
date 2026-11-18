import { answersOf, clockOf, readingsOf } from '../../../time/rows.js';
import type { TimeInputs } from '../arguments/subflow.js';

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
  };
}
