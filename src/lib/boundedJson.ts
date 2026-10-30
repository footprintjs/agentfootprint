/** Strict, bounded JSON data helpers shared by internal validation boundaries. */
import { isHighSurrogate, isLowSurrogate, utf8Length } from './utf8.js';

/**
 * The UTF-8 bytes `value` serializes to — `JSON.stringify` and all its
 * escaping included: a control character or a lone surrogate is six bytes
 * (`\u0001`), a quote or a backslash two, a BMP character up to three, an
 * astral one four. THE measure for every bound stated in serialized bytes —
 * {@link copyJson}'s, the answer account's (`answer-account/size.ts`). `0`
 * for a value JSON writes nothing for (`undefined`, a function). The text
 * JSON writes holds no lone surrogate (each is escaped), so its UTF-8 length
 * is exact.
 */
export function jsonBytes(value: unknown): number {
  const text = JSON.stringify(value);
  return text === undefined ? 0 : utf8Length(text);
}

/**
 * The longest prefix of `text`, in whole code points, whose JSON string form
 * (its quotes excluded) is at most `maxBytes` UTF-8 bytes — `text` itself
 * when it fits. Each code point is measured by JSON's own escaping
 * ({@link jsonBytes}), never by a second table of it.
 *
 * @example
 * ```ts
 * cutToJsonBytes('abc', 2);              // 'ab'
 * cutToJsonBytes('\u0001\u0001', 6);     // '\u0001' — JSON writes each as six bytes
 * ```
 */
export function cutToJsonBytes(text: string, maxBytes: number): string {
  // UTF-16 length is a lower bound on JSON content bytes. Avoid serializing
  // an arbitrarily long identity when only its bounded prefix can be returned.
  if (text.length <= maxBytes && jsonBytes(text) - 2 <= maxBytes) return text;
  let used = 0;
  let end = 0;
  while (end < text.length) {
    const width =
      isHighSurrogate(text.charCodeAt(end)) && isLowSurrogate(text.charCodeAt(end + 1)) ? 2 : 1;
    const bytes = jsonBytes(text.slice(end, end + width)) - 2;
    if (used + bytes > maxBytes) break;
    used += bytes;
    end += width;
  }
  return text.slice(0, end);
}

export function ownData(value: unknown, allowed?: readonly string[]): Record<string, unknown> {
  if (
    value === null ||
    typeof value !== 'object' ||
    Array.isArray(value) ||
    ![Object.prototype, null].includes(Object.getPrototypeOf(value))
  )
    throw new Error('Expected a plain data object.');
  const result: Record<string, unknown> = Object.create(null) as Record<string, unknown>;
  for (const key of Reflect.ownKeys(value)) {
    if (typeof key !== 'string' || (allowed && !allowed.includes(key)))
      throw new Error('Unknown property.');
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (!descriptor?.enumerable || !('value' in descriptor))
      throw new Error('Expected an enumerable data property.');
    Object.defineProperty(result, key, { value: descriptor.value, enumerable: true });
  }
  return result;
}

/** A list as {@link readOwnList} read it. */
export interface OwnList {
  /** The entries read, in index order — a hole or an accessor entry is `undefined` (its getter never called). */
  readonly entries: readonly unknown[];
  /** How many entries the list holds past the bound — counted, never read. */
  readonly unread: number;
}

/**
 * Read a list the way {@link copyJson} reads an array — a plain array only
 * (`Array.prototype`), its own `length`, the own DATA property at each index —
 * as a READER that does not refuse an ordinary array: at most `maxEntries`
 * entries, a hole or an accessor entry read as `undefined` (the getter is never
 * called), and the entries past the bound counted in `unread`, never walked. It
 * never calls the list's iterator, an index getter or a method, so an ordinary
 * array from a record the library did not build cannot hide its entries or run
 * code inside the reader. `undefined` when `value` is not a plain array: the
 * caller says what that means for its own question, the conservative way.
 *
 * The guarantee covers an ordinary (non-Proxy) array and its own index
 * accessors and iterator, nothing more. A Proxy around an array passes
 * `Array.isArray`, and its traps (`getPrototypeOf`, `getOwnPropertyDescriptor`)
 * run code inside the reader and can throw out of it; a revoked Proxy throws
 * from `Array.isArray` itself. An entry is handed back as it is: a getter on an
 * entry object runs when the caller reads that property.
 *
 * @example
 * ```ts
 * const list = ['a'];
 * list.length = 3;                                                      // a hole at 1 and 2
 * Object.defineProperty(list, Symbol.iterator, { value: function* () {} }); // never called
 * readOwnList(list, 2); // { entries: ['a', undefined], unread: 1 }
 * ```
 */
export function readOwnList(value: unknown, maxEntries: number): OwnList | undefined {
  if (!Array.isArray(value) || Object.getPrototypeOf(value) !== Array.prototype) return undefined;
  const length: unknown = Object.getOwnPropertyDescriptor(value, 'length')?.value;
  if (typeof length !== 'number' || !Number.isSafeInteger(length) || length < 0) return undefined;
  const read = Math.min(length, maxEntries);
  const entries: unknown[] = [];
  for (let index = 0; index < read; index++) {
    const slot = Object.getOwnPropertyDescriptor(value, String(index));
    entries.push(slot !== undefined && 'value' in slot ? slot.value : undefined);
  }
  return { entries, unread: length - read };
}

/** JSON copy without invoking toJSON/getters or silently dropping data. */
export function copyJson(
  value: unknown,
  maxBytes: number,
  freeze: boolean,
  maxDepth = 100,
): unknown {
  if (!Number.isSafeInteger(maxDepth) || maxDepth < 0 || maxDepth > 256)
    throw new Error('JSON nesting limit.');
  let budget = maxBytes;
  const ancestors = new Set<object>();
  const spend = (bytes: number) => {
    budget -= bytes;
    if (budget < 0) throw new Error('JSON byte limit.');
  };
  const string = (item: string) => {
    if (item.length > budget) throw new Error('JSON byte limit.');
    spend(jsonBytes(item));
  };
  const copy = (item: unknown, depth: number): unknown => {
    if (depth > maxDepth) throw new Error('JSON nesting limit.');
    if (item === null) {
      spend(4);
      return null;
    }
    if (typeof item === 'string') {
      string(item);
      return item;
    }
    if (typeof item === 'boolean') {
      spend(item ? 4 : 5);
      return item;
    }
    if (typeof item === 'number') {
      if (!Number.isFinite(item) || Object.is(item, -0))
        throw new Error('Non-lossless JSON number.');
      spend(JSON.stringify(item).length);
      return item;
    }
    if (typeof item !== 'object') throw new Error('Non-JSON value.');
    if (ancestors.has(item)) throw new Error('Cyclic JSON value.');
    ancestors.add(item);
    spend(2);
    let output: unknown;
    if (Array.isArray(item)) {
      if (Object.getPrototypeOf(item) !== Array.prototype)
        throw new Error('Non-JSON array prototype.');
      if (item.length > budget + 1) throw new Error('JSON byte limit.');
      const keys = Reflect.ownKeys(item);
      if (keys.length !== item.length + 1) throw new Error('Sparse or decorated array.');
      const result: unknown[] = [];
      for (let index = 0; index < item.length; index++) {
        const descriptor = Object.getOwnPropertyDescriptor(item, String(index));
        if (!descriptor?.enumerable || !('value' in descriptor))
          throw new Error('Sparse or accessor array.');
        if (index) spend(1);
        result.push(copy(descriptor.value, depth + 1));
      }
      output = result;
    } else {
      const fields = ownData(item);
      const result: Record<string, unknown> = {};
      let index = 0;
      for (const key of Object.keys(fields)) {
        if (index++) spend(1);
        string(key);
        spend(1);
        Object.defineProperty(result, key, {
          value: copy(fields[key], depth + 1),
          enumerable: true,
          writable: true,
          configurable: true,
        });
      }
      output = result;
    }
    ancestors.delete(item);
    return freeze ? Object.freeze(output) : output;
  };
  return copy(value, 0);
}
