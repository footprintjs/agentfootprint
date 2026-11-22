import { readOwnList } from '../../../../../lib/boundedJson.js';
import { readCallOccurrenceKey } from '../../../../../lib/callOccurrence.js';
import { MAX_ENTERED_TOOL_CALLS } from '../../../honesty/enteredToolCalls.js';
import { copyLibraryResultLimit } from '../../../honesty/libraryResultLimits.js';
import type { readToolSettlements } from '../../../recordedCalls.js';
import { statePointer } from '../../pointer.js';
import type { AssessmentPointer } from '../../types.js';

/** The Window stage attests to these drops at the applied history write. */
export function windowDropWitnesses(
  recordedLimits: unknown,
  turn: unknown,
  settlements: NonNullable<ReturnType<typeof readToolSettlements>>,
): readonly AssessmentPointer[] {
  const rows = readOwnList(recordedLimits, MAX_ENTERED_TOOL_CALLS);
  if (rows === undefined) return [];
  const drops = new Map<string, number | null>();
  for (const [index, entry] of rows.entries.entries()) {
    const row = copyLibraryResultLimit(entry);
    if (row?.kind !== 'result-dropped-from-window' || row.turn !== turn) continue;
    const key = readCallOccurrenceKey(row);
    if (typeof key !== 'string') continue;
    drops.set(key, drops.has(key) ? null : index);
  }
  const witnesses: AssessmentPointer[] = [];
  for (const [key, index] of drops) {
    const settlement = settlements.byKey.get(key)?.fact;
    if (
      index !== null &&
      settlement?.execution === 'returned' &&
      (settlement.delivery === 'native' || settlement.delivery === 'rewritten')
    ) {
      witnesses.push(statePointer('libraryResultLimits', index, 'strategy'));
    }
  }
  return witnesses;
}

export function windowDropClause(count: number): string {
  const subject =
    count === 1 ? '1 result from this turn was' : `${count} results from this turn were`;
  return `${subject} dropped from the conversation before the answer`;
}
