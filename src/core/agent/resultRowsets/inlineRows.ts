import { jsonBytes, ownData } from '../../../lib/boundedJson.js';
import type { RowsetReading } from '../../../integrity/column-types/check.js';

/** An unavailable binding is not a fabricated column violation. */
export class RowsetUnavailable extends Error {
  constructor(readonly reason: 'source-over-bound' | 'unsupported-shape') {
    super(reason);
  }
}

/**
 * Detach the declared inline rows without executing accessors or serialization
 * hooks. Primitive types and genuine Dates retain the existing column judge's
 * semantics. The byte budget counts JSON punctuation/escaping; non-JSON atoms
 * use their literal spelling, and Dates use their ISO-width representation.
 */
export function inlineSnapshot(value: unknown, maxBytes = 1048576, maxDepth = 16): unknown {
  if (!Number.isSafeInteger(maxDepth) || maxDepth < 0 || maxDepth > 33)
    throw new RowsetUnavailable('source-over-bound');
  let remaining = maxBytes;
  const ancestors = new Set<object>();
  const spend = (bytes: number): void => {
    remaining -= bytes;
    if (remaining < 0) throw new RowsetUnavailable('source-over-bound');
  };
  const copy = (item: unknown, depth: number): unknown => {
    if (depth > maxDepth) throw new RowsetUnavailable('source-over-bound');
    if (item === undefined) {
      spend(9);
      return item;
    }
    if (item === null || typeof item === 'boolean' || typeof item === 'number') {
      spend(String(item).length);
      return item;
    }
    if (typeof item === 'string') {
      if (item.length > remaining) throw new RowsetUnavailable('source-over-bound');
      spend(jsonBytes(item));
      return item;
    }
    if (typeof item !== 'object') throw new RowsetUnavailable('unsupported-shape');
    if (Object.getPrototypeOf(item) === Date.prototype) {
      let instant: number;
      try {
        instant = Date.prototype.getTime.call(item);
      } catch {
        throw new RowsetUnavailable('unsupported-shape');
      }
      // Dates may not smuggle own executable or unrelated properties.
      if (Reflect.ownKeys(item).length !== 0) throw new RowsetUnavailable('unsupported-shape');
      spend(26);
      return Object.freeze(new Date(instant));
    }
    if (ancestors.has(item)) throw new RowsetUnavailable('unsupported-shape');
    ancestors.add(item);
    try {
      if (Array.isArray(item)) {
        if (Object.getPrototypeOf(item) !== Array.prototype)
          throw new RowsetUnavailable('unsupported-shape');
        const size = Object.getOwnPropertyDescriptor(item, 'length')?.value as number;
        // Each slot consumes at least one byte; reject before allocating/walking.
        if (!Number.isSafeInteger(size) || size < 0 || size > remaining)
          throw new RowsetUnavailable('source-over-bound');
        if (Reflect.ownKeys(item).length !== size + 1)
          throw new RowsetUnavailable('unsupported-shape');
        spend(2 + Math.max(0, size - 1));
        const result: unknown[] = [];
        for (let index = 0; index < size; index++) {
          const slot = Object.getOwnPropertyDescriptor(item, String(index));
          if (!slot?.enumerable || !('value' in slot))
            throw new RowsetUnavailable('unsupported-shape');
          result.push(copy(slot.value, depth + 1));
        }
        return Object.freeze(result);
      }
      let data: Record<string, unknown>;
      try {
        data = ownData(item);
      } catch {
        throw new RowsetUnavailable('unsupported-shape');
      }
      const result: Record<string, unknown> = Object.create(null);
      spend(2);
      let first = true;
      for (const key of Object.keys(data)) {
        if (key.length > remaining) throw new RowsetUnavailable('source-over-bound');
        spend(jsonBytes(key) + 1 + (first ? 0 : 1));
        first = false;
        Object.defineProperty(result, key, { value: copy(data[key], depth + 1), enumerable: true });
      }
      return Object.freeze(result);
    } finally {
      ancestors.delete(item);
    }
  };
  return copy(value, 0);
}

/** Read only bounded own row objects; empty is deliberately left to the caller. */
export function inlineRowset(value: unknown, maxRows = 1000, maxBytes = 1048576): RowsetReading {
  if (!Array.isArray(value) || Object.getPrototypeOf(value) !== Array.prototype)
    throw new RowsetUnavailable('unsupported-shape');
  const length = Object.getOwnPropertyDescriptor(value, 'length')?.value as unknown;
  if (typeof length !== 'number' || length > maxRows)
    throw new RowsetUnavailable('source-over-bound');
  const rows = inlineSnapshot(value, maxBytes) as readonly Readonly<Record<string, unknown>>[];
  if (
    rows.some(
      (row) => row === null || typeof row !== 'object' || Array.isArray(row) || row instanceof Date,
    )
  )
    throw new RowsetUnavailable('unsupported-shape');
  return { rows };
}
