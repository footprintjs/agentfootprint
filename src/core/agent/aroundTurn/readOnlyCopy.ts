/**
 * A frozen copy of a turn's plain data, for the wrapper to read.
 *
 * The run keeps the originals, so nothing the wrapper does to its copy can
 * reach the run, and the caller's own objects are never frozen. Anything that
 * is not plain data — an `AbortSignal`, a sealed request handle, a `Date`, a
 * function — keeps its identity and is passed as it is.
 *
 * Iterative, because a request body can nest deeper than the call stack. No
 * getter runs: an accessor property is copied as an accessor.
 */

function isPlainData(value: unknown): value is object {
  if (value === null || typeof value !== 'object') return false;
  if (Array.isArray(value)) return true;
  const prototype: unknown = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

export function readOnlyCopy<T>(value: T): T {
  const copies = new Map<object, object>();
  const pending: object[] = [];
  const copyOf = (held: unknown): unknown => {
    if (!isPlainData(held)) return held;
    const known = copies.get(held);
    if (known !== undefined) return known;
    const copy: object = Array.isArray(held) ? [] : Object.create(Object.getPrototypeOf(held));
    copies.set(held, copy);
    pending.push(held);
    return copy;
  };
  const root = copyOf(value) as T;
  for (let from = pending.pop(); from !== undefined; from = pending.pop()) {
    const to = copies.get(from) as object;
    for (const key of Reflect.ownKeys(from)) {
      const field = Object.getOwnPropertyDescriptor(from, key) as PropertyDescriptor;
      if ('value' in field) field.value = copyOf(field.value);
      Object.defineProperty(to, key, field);
    }
  }
  for (const copy of copies.values()) Object.freeze(copy);
  return root;
}
