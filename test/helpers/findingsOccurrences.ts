import type { FindingsLedger } from '../../src/core/agent/findings/types.js';
import { readCallOccurrenceKey } from '../../src/lib/callOccurrence.js';

/** Compare independent runs while preserving the relationships between model findings. */
export function normalizeFindingOccurrences(ledger: FindingsLedger | undefined) {
  const ordinals = new Map<string, number>();
  const normalize = (row: object) => {
    const key = readCallOccurrenceKey(row);
    if (typeof key !== 'string') return row;
    if (!ordinals.has(key)) ordinals.set(key, ordinals.size);
    return { ...row, callOccurrenceKey: ordinals.get(key) };
  };
  return ledger?.map((row) => {
    if (row.kind !== 'basis' && row.kind !== 'standing') return row;
    const normalized = normalize(row);
    return row.kind === 'standing' && row.declaredOn !== 'answer'
      ? { ...normalized, declaredOn: normalize(row.declaredOn) }
      : normalized;
  });
}
