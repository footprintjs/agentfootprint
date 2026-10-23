/**
 * isJsonFaithful — does JSON write this value down faithfully?
 *
 * Role:  Fold. A leaf predicate: it reads its argument and nothing else.
 * Reads: its argument.
 * Emits: N/A.
 *
 * True when `JSON.parse(JSON.stringify(value))` gives back the same value —
 * the question a binding has to ask before it fingerprints a value with
 * `canonicalJson`, which (by design, for the audit chain) writes a `Date` as a
 * string, a `Map` as `{}` and `NaN` as `null`. Two different values that JSON
 * writes the same way would fingerprint the same, so a binding over them would
 * match what it never saw. This predicate is how such a value is refused by
 * its DOMAIN instead.
 *
 * Faithful: `null`, booleans, strings, finite numbers, dense arrays of
 * faithful values, and plain objects (prototype `Object.prototype` or `null`,
 * string keys, data properties) whose values are faithful.
 *
 * JSON's own two equivalences are accepted, because JSON is what a person is
 * shown and what a stored checkpoint holds: a property whose value is
 * `undefined` reads back as absent, and `-0` reads back as `0`.
 *
 * Not faithful: `undefined` at the top or in an array, `NaN`, `±Infinity`,
 * `bigint`, symbols, functions, a `Date`, `Map`, `Set`, `RegExp`, `Error`,
 * typed array or any class instance, an array with holes or a named property,
 * an object with a symbol key or an accessor property, a cycle, or nesting deeper than
 * {@link MAX_JSON_DEPTH}. A shared (non-cyclic) reference is fine.
 *
 * Never throws: a value it cannot read is not faithful.
 */

/** Nesting deeper than this is refused — a depth a tool's arguments never reach. */
export const MAX_JSON_DEPTH = 100;

export function isJsonFaithful(value: unknown): boolean {
  try {
    return faithful(value, 0, new Set<object>());
  } catch {
    return false;
  }
}

function faithful(value: unknown, depth: number, path: Set<object>): boolean {
  if (value === null) return true;
  switch (typeof value) {
    case 'string':
    case 'boolean':
      return true;
    case 'number':
      return Number.isFinite(value);
    case 'object':
      break;
    default:
      return false;
  }
  if (depth >= MAX_JSON_DEPTH) return false;
  const object = value as object;
  // A cycle is refused rather than followed; a reference shared by two
  // siblings is not a cycle, so the set holds only the current path.
  if (path.has(object)) return false;
  path.add(object);
  try {
    return Array.isArray(object)
      ? faithfulArray(object, depth, path)
      : faithfulObject(object, depth, path);
  } finally {
    path.delete(object);
  }
}

function faithfulArray(array: readonly unknown[], depth: number, path: Set<object>): boolean {
  if (Object.getPrototypeOf(array) !== Array.prototype) return false;
  // JSON writes the indices only: a named property on an array (`arr.note`)
  // would be dropped. Indices plus `length` is every own property it may have.
  if (Object.getOwnPropertySymbols(array).length > 0) return false;
  if (Object.getOwnPropertyNames(array).length !== array.length + 1) return false;
  for (let i = 0; i < array.length; i++) {
    // A hole and an `undefined` element both read back as `null`.
    if (!Object.prototype.hasOwnProperty.call(array, i)) return false;
    if (!faithful(array[i], depth + 1, path)) return false;
  }
  return true;
}

function faithfulObject(object: object, depth: number, path: Set<object>): boolean {
  const proto = Object.getPrototypeOf(object) as unknown;
  if (proto !== Object.prototype && proto !== null) return false;
  if (Object.getOwnPropertySymbols(object).length > 0) return false;
  for (const key of Object.getOwnPropertyNames(object)) {
    const descriptor = Object.getOwnPropertyDescriptor(object, key);
    // A getter can answer differently on every read; JSON skips a
    // non-enumerable property, so the value it holds would not be shown.
    if (descriptor === undefined || !('value' in descriptor) || !descriptor.enumerable) {
      return false;
    }
    if (descriptor.value === undefined) continue;
    if (!faithful(descriptor.value, depth + 1, path)) return false;
  }
  return true;
}
