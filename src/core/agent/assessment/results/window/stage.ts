import { readWindowResultDrops, type readToolSettlements } from '../../../recordedCalls.js';
import { statePointer } from '../../pointer.js';
import type { AssessmentPointer } from '../../types.js';

/** The Window stage attests to these drops at the applied history write. */
export function windowDropWitnesses(
  recordedDrops: unknown,
  settlements: NonNullable<ReturnType<typeof readToolSettlements>>,
): readonly AssessmentPointer[] {
  const drops = readWindowResultDrops(recordedDrops);
  if (drops === undefined) return [];
  const witnesses: AssessmentPointer[] = [];
  for (const [key, { index }] of drops.byKey) {
    const settlement = settlements.byKey.get(key)?.fact;
    if (
      settlement?.execution === 'returned' &&
      (settlement.delivery === 'native' || settlement.delivery === 'rewritten')
    ) {
      witnesses.push(statePointer('windowResultDrops', index, 'strategy'));
    }
  }
  return witnesses;
}

export function windowDropClause(count: number): string {
  const subject =
    count === 1 ? '1 result from this turn was' : `${count} results from this turn were`;
  return `${subject} dropped from the conversation before the answer`;
}
