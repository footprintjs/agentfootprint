import { readCallOccurrenceKey } from '../../../../../lib/callOccurrence.js';
import { witnessRowIndex } from '../../pointer.js';
import type { AssessmentPointer, AssessmentReason } from '../../types.js';

const PERIOD_WORD_REASONS: ReadonlySet<AssessmentReason> = new Set([
  'period-not-held',
  'period-partly-held',
  'period-unknown',
  'period-undeclared',
  'period-differs-from-asked',
  'period-beyond-retention',
]);

export function periodUsesToolWords(reason: AssessmentReason): boolean {
  return PERIOD_WORD_REASONS.has(reason);
}

/** A retained period witness supplies the exact occurrence of its declaration. */
export function periodWordsOccurrenceReader(
  readRetained: () => unknown,
): (pointer: AssessmentPointer) => string | undefined {
  let retained: { readonly rows: unknown } | undefined;
  return (pointer) => {
    if (pointer.kind !== 'state' || pointer.key !== 'findingsLedger') return undefined;
    const index = witnessRowIndex(pointer.path);
    if (index === undefined) return undefined;
    retained ??= { rows: readRetained() };
    if (!Array.isArray(retained.rows)) return undefined;
    const row = Object.getOwnPropertyDescriptor(retained.rows, String(index))?.value;
    if (row === null || typeof row !== 'object') return undefined;
    if (Object.getOwnPropertyDescriptor(row, 'kind')?.value !== 'period') return undefined;
    const occurrence = readCallOccurrenceKey(row);
    return typeof occurrence === 'string' ? occurrence : undefined;
  };
}
