import { readOwnList } from '../../../lib/boundedJson.js';
import { readCallOccurrenceKey, type CallOccurrenceKey } from '../../../lib/callOccurrence.js';
import { MAX_ENTERED_TOOL_CALLS } from '../honesty/enteredToolCalls.js';
import { isRecord } from './record.js';

/** One delivered result removed by the applied window, without its payload. */
export interface WindowResultDrop {
  readonly callOccurrenceKey: CallOccurrenceKey;
  readonly strategy: string;
}

/** Ambiguous occurrences supply no proof. Valid rows keep their stored indices. */
export function readWindowResultDrops(value: unknown) {
  const list = readOwnList(value, MAX_ENTERED_TOOL_CALLS);
  if (list === undefined) return undefined;
  const byKey = new Map<string, { readonly index: number; readonly fact: WindowResultDrop }>();
  const ambiguous = new Set<string>();
  let complete = list.unread === 0;
  for (const [index, item] of list.entries.entries()) {
    if (!isRecord(item)) {
      complete = false;
      continue;
    }
    const key = readCallOccurrenceKey(item);
    const strategy: unknown = Object.getOwnPropertyDescriptor(item, 'strategy')?.value;
    if (typeof key !== 'string' || typeof strategy !== 'string') {
      complete = false;
      continue;
    }
    if (byKey.has(key) || ambiguous.has(key)) {
      byKey.delete(key);
      ambiguous.add(key);
      complete = false;
      continue;
    }
    const callOccurrenceKey = key.split('.').map(Number) as unknown as CallOccurrenceKey;
    byKey.set(key, { index, fact: { callOccurrenceKey, strategy } });
  }
  return { byKey, complete };
}
