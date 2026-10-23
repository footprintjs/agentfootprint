/**
 * frozenCopyOf — a callback's copy of a value, frozen all the way down.
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
 * way the arguments that run are untouched.
 *
 * A copy freezing SEALS ({@link isSealed}) cannot change, so ONE is shared by
 * every callback and event that sees a call before it runs ({@link frozenView}):
 * a large argument is copied once, not once per callback. That is every JSON
 * value — all a model ever proposes. A copy holding a container `Object.freeze`
 * cannot seal — a `Map` or `Set` (their own `set`/`add`/`delete`), a `Date`
 * (its setters), an `ArrayBuffer` or a typed array or view (their bytes) — is
 * NOT sealed: one callback could still change what the next one judges, so
 * such a copy is never shared and each callback is handed its own. (Refusing
 * such arguments instead would break a tool an app hands a `Date` or a `Map`
 * through its own provider or middleware; a copy per callback costs only those
 * calls their extra copies.) A `SharedArrayBuffer` is shared, not copied, by
 * `structuredClone` — its bytes would be every copy's and the tool's — so each
 * one (and every view over one) is copied into a plain buffer first.
 *
 * `undefined` when no copy can be made (a function, a symbol, a foreign proxy
 * — what `structuredClone` refuses). The caller decides what that means, and
 * fails closed: a consent gate trips, a permission check denies.
 *
 * Never throws.
 */

import { isDevMode } from 'footprintjs';

/**
 * Every object a SEALED copy {@link frozenCopyOf} made holds, at every depth —
 * frozen, and holding nothing freezing leaves writable: safe to hand on.
 */
const sealed = new WeakSet<object>();

export function frozenCopyOf<T>(value: T): T | undefined {
  let copy: T;
  try {
    copy = structuredClone(value);
  } catch {
    return undefined;
  }
  if (isSharedMemory(copy)) copy = plainCopyOf(copy) as T;
  const reached = new Set<object>();
  if (freezeDeep(copy, reached)) for (const object of reached) sealed.add(object);
  return copy;
}

/**
 * A frozen, detached projection of `value` for an event that must carry
 * SOMETHING when no copy can be made ({@link frozenCopyOf} gave `undefined`):
 * what JSON writes down of it (a function is dropped), or a frozen empty
 * object when JSON cannot write it either. Never a live object of `value`.
 */
export function frozenProjectionOf<T>(value: T): T {
  let projected: unknown;
  try {
    projected = JSON.parse(JSON.stringify(value) ?? '{}');
  } catch {
    projected = {};
  }
  freezeDeep(projected, new Set<object>());
  return projected as T;
}

const SHARED_MEMORY = typeof SharedArrayBuffer === 'function' ? SharedArrayBuffer : undefined;

/** A `SharedArrayBuffer`, or a view over one: memory a clone shares rather than copies. */
function isSharedMemory(value: unknown): value is SharedArrayBuffer | ArrayBufferView {
  if (SHARED_MEMORY === undefined) return false;
  return (
    value instanceof SHARED_MEMORY ||
    (ArrayBuffer.isView(value) && value.buffer instanceof SHARED_MEMORY)
  );
}

/** The same bytes in a plain buffer (or a view of the same kind over one) no one else holds. */
function plainCopyOf(value: SharedArrayBuffer | ArrayBufferView): ArrayBuffer | ArrayBufferView {
  if (!ArrayBuffer.isView(value)) {
    const copy = new ArrayBuffer(value.byteLength);
    new Uint8Array(copy).set(new Uint8Array(value));
    return copy;
  }
  const bytes = new Uint8Array(value.buffer, value.byteOffset, value.byteLength).slice();
  if (value instanceof DataView) return new DataView(bytes.buffer);
  const View = value.constructor as new (buffer: ArrayBuffer) => ArrayBufferView;
  return new View(bytes.buffer);
}

/** `value`, or its plain copy when it is shared memory ({@link isSharedMemory}). */
function unshared(value: unknown): unknown {
  return isSharedMemory(value) ? plainCopyOf(value) : value;
}

/**
 * Whether `value` is (part of) a copy {@link frozenCopyOf} made that freezing
 * sealed — nothing in it can change, so it may be shared between callbacks.
 * `false` for a copy holding a container freezing cannot seal (a `Map`, a
 * `Set`, a `Date`, an `ArrayBuffer`, a typed array or view), and for any value
 * this module did not copy.
 */
export function isSealed(value: unknown): boolean {
  return typeof value === 'object' && value !== null && sealed.has(value);
}

/**
 * `value` itself when it is already (part of) a sealed copy ({@link isSealed}),
 * so sharing it is safe — else a new copy, which is the caller's alone when it
 * holds a container freezing cannot seal.
 */
export function frozenView<T>(value: T): T | undefined {
  return isSealed(value) ? value : frozenCopyOf(value);
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

/**
 * Freeze `value` and everything it reaches (collected in `reached`), and say
 * whether that SEALED it: `false` when it holds a container freezing leaves
 * writable — a `Map` or `Set` (their methods still write), a `Date` (its
 * setters), an `ArrayBuffer`, a typed array or a view (their bytes; a view
 * cannot even be frozen while it has elements). Such a copy is never shared.
 */
function freezeDeep(value: unknown, reached: Set<object>): boolean {
  if (typeof value !== 'object' || value === null || reached.has(value)) return true;
  reached.add(value);
  if (ArrayBuffer.isView(value)) return false;
  let sealable = !(
    value instanceof Map ||
    value instanceof Set ||
    value instanceof Date ||
    value instanceof ArrayBuffer ||
    (typeof SharedArrayBuffer === 'function' && value instanceof SharedArrayBuffer)
  );
  // Shared memory a clone kept is replaced by a plain copy BEFORE this
  // container is frozen — the container is the fresh clone's own.
  if (value instanceof Map) {
    const entries = [...value].map(([key, entry]) => [unshared(key), unshared(entry)] as const);
    value.clear();
    for (const [key, entry] of entries) {
      value.set(key, entry);
      sealable = freezeDeep(key, reached) && sealable;
      sealable = freezeDeep(entry, reached) && sealable;
    }
  } else if (value instanceof Set) {
    const entries = [...value].map(unshared);
    value.clear();
    for (const entry of entries) {
      value.add(entry);
      sealable = freezeDeep(entry, reached) && sealable;
    }
  }
  for (const key of Reflect.ownKeys(value)) {
    const field = Object.getOwnPropertyDescriptor(value, key);
    if (field === undefined || !('value' in field)) continue;
    const child = unshared(field.value);
    if (child !== field.value) (value as Record<PropertyKey, unknown>)[key] = child;
    sealable = freezeDeep(child, reached) && sealable;
  }
  Object.freeze(value);
  return sealable;
}
