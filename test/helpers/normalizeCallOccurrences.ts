import { readCallOccurrenceKey } from '../../src/lib/callOccurrence.js';

/** Compare separate recordings while preserving batch identity and call position. */
export function normalizeCallOccurrences(value: unknown): unknown {
  const batches = new Map<string, number>();

  const normalizeKey = (value: unknown) => {
    const key = readCallOccurrenceKey({ callOccurrenceKey: value });
    if (typeof key !== 'string') throw new Error('Invalid recorded callOccurrenceKey');
    const lastDot = key.lastIndexOf('.');
    const batch = key.slice(0, lastDot);
    let ordinal = batches.get(batch);
    if (ordinal === undefined) {
      ordinal = batches.size + 1;
      batches.set(batch, ordinal);
    }
    return [0, 0, 0, ordinal, Number(key.slice(lastDot + 1))];
  };

  const visit = (item: unknown): unknown => {
    if (Array.isArray(item)) return item.map(visit);
    if (item === null || typeof item !== 'object') return item;
    const prototype = Object.getPrototypeOf(item);
    if (prototype !== Object.prototype && prototype !== null) return item;
    return Object.fromEntries(
      Object.entries(item).map(([key, entry]) => [
        key,
        key === 'callOccurrenceKey' ? normalizeKey(entry) : visit(entry),
      ]),
    );
  };

  return visit(value);
}
