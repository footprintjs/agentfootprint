import { readCallOccurrenceKey } from '../../../lib/callOccurrence.js';
import { isRecord } from './record.js';
import { readRecordedResultDecision, readResultRewriteName } from './resultDispositions.js';

interface ResultRewriteReference {
  readonly kind: 'rewritten' | 'blocked';
  /** The original ledger position, never its filtered position within one call. */
  readonly index: number;
  readonly name?: string;
}

export type ResultRewriteIndex = ReadonlyMap<string, ResultRewriteReference>;

/** One transient, descriptor-only pass over this read's ledger. No fact is persisted. */
export function indexResultRewrites(ledger: unknown): ResultRewriteIndex {
  const byOccurrence = new Map<string, ResultRewriteReference>();
  if (!Array.isArray(ledger)) return byOccurrence;
  for (let index = 0; index < ledger.length; index++) {
    const row: unknown = Object.getOwnPropertyDescriptor(ledger, String(index))?.value;
    if (!isRecord(row)) continue;
    const key = readCallOccurrenceKey(row);
    if (typeof key !== 'string') continue;
    const disposition = readRecordedResultDecision(row);
    if (disposition === 'rewritten') {
      const name = readResultRewriteName(row);
      byOccurrence.set(key, {
        kind: 'rewritten',
        index,
        ...(name !== undefined && { name }),
      });
    } else if (disposition === 'withheld' || disposition === 'unknown') {
      // An unavailable later decision blocks an earlier name; it grants no new delivery proof.
      byOccurrence.set(key, { kind: 'blocked', index });
    }
  }
  return byOccurrence;
}
