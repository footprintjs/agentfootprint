import { isSaidByPerson } from '../../../lib/saidByPerson.js';
import type { LLMMessage } from '../../../provider-contract/types.js';
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

const qualifiedPhrases: ReadonlySet<string> = new Set(provenLookback.phrases);

interface ReadingScope {
  readonly findingsLedger?: unknown;
  readonly turnNumber?: unknown;
  readonly userMessage?: unknown;
  readonly history?: unknown;
}

/** Project a qualified row only from the active native scope, never from a portable row alone. */
export function activeTimeReadings(
  scope: ReadingScope,
  clock?: ClockRow,
): readonly TimeReadingRow[] {
  const ledger = scope.findingsLedger as readonly unknown[] | undefined;
  const rows = readingsOf(ledger, scope.turnNumber as number);
  const row = rows[0];
  const proof = row?.qualifiedLookback;
  if (
    rows.length !== 1 ||
    row === undefined ||
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
    retained?.turn !== row.turn ||
    position === undefined ||
    proof.inputPosition !== position ||
    proof.clockNow !== retained.now ||
    row.quote !== scope.userMessage ||
    typeof row.quote !== 'string' ||
    !qualifiedPhrases.has(row.quote) ||
    !Array.isArray(scope.history)
  ) {
    return rows;
  }
  const input = (scope.history as readonly LLMMessage[])[position];
  const choice = row.choice;
  const candidate = row.candidates?.[0];
  if (
    input == null ||
    typeof input !== 'object' ||
    !isSaidByPerson(input) ||
    input.content !== row.quote ||
    row.mentions !== 1 ||
    row.mention !== 0 ||
    row.refused !== undefined ||
    row.problem !== undefined ||
    row.reader.id !== provenLookback.reader.id ||
    row.reader.version !== provenLookback.reader.version ||
    row.reader.kind !== provenLookback.reader.kind ||
    row.reader.locale !== provenLookback.reader.locale ||
    choice?.by !== 'open' ||
    choice.open.length !== 1 ||
    choice.open[0] !== 'confirm' ||
    choice.remaining.length !== 1 ||
    choice.remaining[0] !== 0 ||
    row.candidates?.length !== 1 ||
    candidate?.window.kind !== 'lookback' ||
    candidate.endpoint?.end !== 'exclusive' ||
    candidate.endpoint.cutoff !== retained.now
  ) {
    return rows;
  }
  return [{ ...row, choice: { by: 'only', candidate: 0 } }];
}

/**
 * This turn's clock and readings, off the parent's ledger — `undefined` when
 * the turn has no clock (a turn paused by a runtime without the layer).
 */
export function timeInputsOf(parent: Record<string, unknown>): TimeInputs | undefined {
  const ledger = parent.findingsLedger as readonly unknown[] | undefined;
  const clock = clockOf(ledger);
  if (clock === undefined) return undefined;
  return {
    clock,
    readings: [...activeTimeReadings(parent, clock)],
    answers: [...answersOf(ledger, parent.turnNumber as number)],
  };
}
