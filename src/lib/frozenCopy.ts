/**
 * frozenCopyOf — a callback's OWN copy of a value, frozen all the way down.
 *
 * Role:  Support. A leaf: it reads its argument and nothing else.
 * Reads: its argument.
 * Emits: N/A.
 *
 * The boundary between a call's arguments and the app code that looks at them
 * before the call runs (a `checkIn` predicate, the evidence assembler, the
 * permission checker). App callbacks are trusted code, and trusted code can
 * still be buggy: a predicate that writes into the object it was handed would
 * otherwise write into the arguments the tool then runs with — after a person
 * approved them, or after the predicate itself answered "no check-in needed".
 * So the callback is handed a copy (`structuredClone`) that no one else holds,
 * frozen at every depth: a write to it throws in strict code and is ignored in
 * sloppy code, and either way the arguments that run are untouched. (A `Map`
 * or `Set` in the copy still answers its own `set`/`add` — a tool's arguments
 * are JSON values, which hold neither.)
 *
 * `undefined` when no copy can be made (a function, a symbol, a foreign proxy
 * — what `structuredClone` refuses). The caller decides what that means, and
 * fails closed: a consent gate trips, a permission check denies.
 *
 * Never throws.
 */
export function frozenCopyOf<T>(value: T): T | undefined {
  let copy: T;
  try {
    copy = structuredClone(value);
  } catch {
    return undefined;
  }
  freezeDeep(copy, new Set<object>());
  return copy;
}

/** Freeze `value` and everything it reaches. A fresh clone holds no foreign object. */
function freezeDeep(value: unknown, seen: Set<object>): void {
  if (typeof value !== 'object' || value === null || seen.has(value)) return;
  seen.add(value);
  // A typed array or view cannot be frozen while it has elements; its bytes
  // are a copy no one else holds, so it is left as it is.
  if (ArrayBuffer.isView(value)) return;
  if (value instanceof Map) {
    for (const [key, entry] of value) {
      freezeDeep(key, seen);
      freezeDeep(entry, seen);
    }
  } else if (value instanceof Set) {
    for (const entry of value) freezeDeep(entry, seen);
  }
  for (const key of Reflect.ownKeys(value)) {
    const field = Object.getOwnPropertyDescriptor(value, key);
    if (field !== undefined && 'value' in field) freezeDeep(field.value, seen);
  }
  Object.freeze(value);
}
