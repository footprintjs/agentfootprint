import { isSaidByPerson } from '../../../lib/saidByPerson.js';
import type { LLMMessage } from '../../../provider-contract/types.js';
import { measuredLookbackOf } from '../../../time/provenForms/measuredLookback.js';
import { provenLookback } from '../../../time/provenForms/proof.js';
import {
  answersOf,
  clockOf,
  readingsOf,
  timeRowIsWellFormed,
  type ClockRow,
  type TimeReadingRow,
} from '../../../time/rows.js';
import type { TimeInputs } from '../arguments/subflow.js';

interface ReadingScope {
  readonly findingsLedger?: unknown;
  readonly turnNumber?: unknown;
  readonly userMessage?: unknown;
  readonly history?: unknown;
  readonly provenWindowWithdrawn?: unknown;
}

/** Project a qualified row only from the active native scope, never from a portable row alone. */
export function activeTimeReadings(
  scope: ReadingScope,
  allowProven: boolean,
  clock?: ClockRow,
): readonly TimeReadingRow[] {
  const ledger = scope.findingsLedger as readonly unknown[] | undefined;
  const rows = readingsOf(ledger, scope.turnNumber as number);
  if (!allowProven) return rows;
  const row = rows[0];
  const proof = row?.qualifiedLookback;
  if (
    row?.choice?.by !== 'proven' ||
    scope.provenWindowWithdrawn === true ||
    proof === null ||
    typeof proof !== 'object' ||
    proof.receipt !== provenLookback.receipt ||
    !timeRowIsWellFormed(row as unknown as Readonly<Record<string, unknown>>)
  ) {
    return rows;
  }

  const retained = clock ?? clockOf(ledger);
  const position = retained?.provenInputPosition;
  if (
    row.turn !== 1 ||
    retained === undefined ||
    position !== 0 ||
    proof.inputPosition !== position ||
    proof.clockNow !== retained.now ||
    row.quote !== scope.userMessage ||
    !Array.isArray(scope.history)
  ) {
    return rows;
  }
  const input = (scope.history as readonly LLMMessage[])[position];
  if (
    input == null ||
    typeof input !== 'object' ||
    !isSaidByPerson(input) ||
    input.content !== row.quote ||
    measuredLookbackOf(row.quote, retained, rows) === undefined
  ) {
    return rows;
  }
  return [{ ...row, choice: { by: 'only', candidate: 0 } }];
}

/**
 * This turn's clock and readings, off the parent's ledger — `undefined` when
 * the turn has no clock (a turn paused by a runtime without the layer).
 */
export function timeInputsOf(
  parent: Record<string, unknown>,
  allowProven: boolean,
): TimeInputs | undefined {
  const ledger = parent.findingsLedger as readonly unknown[] | undefined;
  const clock = clockOf(ledger);
  if (clock === undefined) return undefined;
  return {
    clock,
    readings: [...activeTimeReadings(parent, allowProven, clock)],
    answers: [...answersOf(ledger, parent.turnNumber as number)],
  };
}
