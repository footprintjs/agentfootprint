/**
 * frozenCopyOf — a callback's OWN copy of a value, frozen all the way down.
 *
 * Role:  Support. A leaf: it reads its argument and nothing else.
 * Reads: its argument.
 * Emits: one dev-mode warning per kind of callback ({@link warnFrozenWrite}).
 *
 * The boundary between a call's arguments and the app code that looks at them
 * before the call runs (a `checkIn` predicate, the evidence assembler, the
 * permission checker, a `tool_start` listener). App callbacks are trusted
 * code, and trusted code can still be buggy: a predicate that writes into the
 * object it was handed would otherwise write into the arguments the tool then
 * runs with — after a person approved them, or after the predicate itself
 * answered "no check-in needed". So the callback is handed a copy
 * (`structuredClone`) that the tool never runs with, frozen at every depth: a
 * write to it throws in strict code and is ignored in sloppy code, and either
 * way the arguments that run are untouched. (A `Map` or `Set` in the copy
 * still answers its own `set`/`add` — a tool's arguments are JSON values,
 * which hold neither.)
 *
 * A frozen copy cannot change, so ONE is shared by every callback and event
 * that sees a call before it runs ({@link frozenView}): a large argument is
 * copied once, not once per callback.
 *
 * `undefined` when no copy can be made (a function, a symbol, a foreign proxy
 * — what `structuredClone` refuses). The caller decides what that means, and
 * fails closed: a consent gate trips, a permission check denies.
 *
 * Never throws.
 */

import { isDevMode } from 'footprintjs';

/** Every object a copy {@link frozenCopyOf} made holds, at every depth — frozen, so safe to hand on again. */
const made = new WeakSet<object>();

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

/**
 * `value` itself when it is already (part of) a copy {@link frozenCopyOf} made
 * — frozen at every depth, so sharing it is safe — else a new one.
 */
export function frozenView<T>(value: T): T | undefined {
  return typeof value === 'object' && value !== null && made.has(value)
    ? value
    : frozenCopyOf(value);
}

/**
 * Whether `error` is what strict code throws on a write to a frozen object —
 * the engines' own words for assigning a read-only property, adding to an
 * object that is not extensible, deleting or redefining a property.
 */
export function isFrozenWriteError(error: unknown): boolean {
  if (!(error instanceof TypeError)) return false;
  return /read[- ]only|not extensible|non-writable|object is frozen|Cannot delete property|Cannot redefine property|Cannot (assign|add|define)/i.test(
    error.message,
  );
}

/** The kinds already warned about — one warning each, per process. */
const warned = new Set<string>();

/**
 * In dev mode, once per kind of callback: say that `who` wrote into the frozen
 * copy it was handed, and what that did (`consequence`). A no-op for any other
 * error, outside dev mode, and after the first warning for `who`.
 *
 * @example
 *   warnFrozenWrite('permission checker', err, 'the call was denied');
 */
export function warnFrozenWrite(who: string, error: unknown, consequence: string): void {
  if (!isFrozenWriteError(error) || !isDevMode() || warned.has(who)) return;
  warned.add(who);
  // eslint-disable-next-line no-console
  console.warn(
    `[agentfootprint] a ${who} wrote into the arguments it was handed (${
      (error as Error).message
    }). It is handed a frozen copy — never the arguments the tool runs with — so the write ` +
      `threw and ${consequence}. Read the arguments; never change them in place.`,
  );
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
  made.add(value);
}
