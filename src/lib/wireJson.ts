/**
 * wireJson — the ONE rule for how an `Error` inside an event reaches a wire.
 *
 * An event payload typed `unknown` (a tool's `result`, a hand-built emit) can
 * carry an `Error` — often one a client library decorated: an axios error
 * carries `config.headers.authorization`, a fetch wrapper the request it made.
 * `JSON.stringify` writes an Error's OWN ENUMERABLE properties and nothing
 * else, so on the synchronous delivery path every sink that serialized an
 * event (the NDJSON file, CloudWatch / AgentCore, the audit export, X-Ray
 * metadata, OTel attributes, the console) wrote that bearer token — while the
 * detached path's `structuredClone` dropped the same properties and wrote
 * `{}`. Two delivery paths, two byte shapes, and the leaky one was the default.
 *
 * The rule, for every Error at any depth: **`{ name, message, code? }` plus a
 * bounded `cause` chain — nothing else.** `code` is kept only when it is a
 * string or a number (the classifier every error vocabulary branches on);
 * `cause` is kept when it is itself an Error (rendered by this rule, at most
 * {@link MAX_CAUSE_DEPTH} deep, a cycle cut) or a primitive; an object cause is
 * dropped for the same reason custom properties are. `stack` is dropped — it
 * was never written (non-enumerable) and it names file paths.
 *
 * Both paths use it, so both write the same bytes:
 *  - SYNCHRONOUS: every serializer of the record writes {@link toWireJson}
 *    instead of `JSON.stringify` — the sinks, the browser stream, the
 *    recording artifact and file sink, the bug-report bundle, the tool-result
 *    text (`test/architecture/wireJsonOnly.test.ts` keeps it that way). A
 *    replacer that reads the HOLDER's raw value, so an Error's own `toJSON`
 *    (a real `AxiosError`'s returns its config and stack) never pre-empts the
 *    rule, and every non-Error value serializes exactly as before.
 *  - DETACHED: `strategies/attach.ts · snapshotEvent` renders Errors with
 *    {@link withWireErrors} BEFORE it clones, so what a detached sink
 *    serializes is already the rendered shape — and a detached sink that does
 *    not serialize receives no Error it could read a custom property off.
 *
 * @example
 * ```ts
 * const err = Object.assign(new Error('upstream 401'), {
 *   code: 'ERR_BAD_REQUEST',
 *   config: { headers: { authorization: 'Bearer …' } },
 * });
 * toWireJson({ result: err });
 * // → '{"result":{"name":"Error","message":"upstream 401","code":"ERR_BAD_REQUEST"}}'
 * ```
 */

/** How many `cause` links are rendered before the chain is cut. */
export const MAX_CAUSE_DEPTH = 4;

/** How deep {@link withWireErrors} walks before it treats a subtree as one value. */
const MAX_WALK_DEPTH = 64;

/** What an Error becomes on a wire. */
export interface WireError {
  readonly name: string;
  readonly message: string;
  readonly code?: string | number;
  readonly cause?: WireError | string | number | boolean;
}

/**
 * Is `value` an Error? True when ANY of three checks says so:
 *  - `Error.isError` (Node ≥ 24, browsers): the internal slot — unspoofable,
 *    across realms; false, by spec, for a Proxy around an Error;
 *  - `instanceof Error`: catches that Proxy (its prototype passes through);
 *  - Node's `util.types.isNativeError`: the internal slot again, so an Error
 *    from another realm (`vm`) is caught on Node 20/22 where `Error.isError`
 *    does not exist. Reached through `process.getBuiltinModule` at call time
 *    (no import: this module ships to browsers, where it is simply absent).
 * The OR makes the answer the same on every runtime the package supports.
 * Never `Object.prototype.toString`: a plain object with
 * `[Symbol.toStringTag]: 'Error'` would pass that brand. Never throws — a
 * revoked Proxy answers `false`.
 */
export function isErrorValue(value: unknown): value is Error {
  if (value === null || typeof value !== 'object') return false;
  return (
    guarded(() => (Error as { isError?: (candidate: unknown) => boolean }).isError?.(value)) ===
      true ||
    guarded(() => value instanceof Error) === true ||
    guarded(() => nodeIsNativeError()?.(value)) === true
  );
}

function guarded<T>(check: () => T): T | undefined {
  try {
    return check();
  } catch {
    return undefined;
  }
}

let nativeErrorCheck: ((candidate: unknown) => boolean) | null | undefined;

/** Node's `util.types.isNativeError`, looked up once; `null` where there is none. */
function nodeIsNativeError(): ((candidate: unknown) => boolean) | null {
  if (nativeErrorCheck !== undefined) return nativeErrorCheck;
  nativeErrorCheck = null;
  try {
    const host = (
      globalThis as {
        process?: { getBuiltinModule?: (id: string) => unknown };
      }
    ).process;
    const util = host?.getBuiltinModule?.('node:util') as
      | { types?: { isNativeError?: (candidate: unknown) => boolean } }
      | undefined;
    const check = util?.types?.isNativeError;
    if (typeof check === 'function') nativeErrorCheck = check;
  } catch {
    nativeErrorCheck = null;
  }
  return nativeErrorCheck;
}

/**
 * Render one Error by the rule. Never throws: a throwing getter, a `message`
 * whose `toString` throws, a revoked Proxy — each reads as absent.
 */
export function wireError(error: Error): WireError {
  return render(error, 0, new Set<object>());
}

function render(error: Error, depth: number, chain: Set<object>): WireError {
  chain.add(error);
  const name = readString(error, 'name') ?? 'Error';
  const message = readString(error, 'message') ?? '';
  const code = read(error, 'code');
  const cause = read(error, 'cause');
  let renderedCause: WireError | string | number | boolean | undefined;
  if (isErrorValue(cause)) {
    if (depth + 1 < MAX_CAUSE_DEPTH && !chain.has(cause)) {
      renderedCause = render(cause, depth + 1, chain);
    }
  } else if (typeof cause === 'string' || typeof cause === 'boolean') {
    renderedCause = cause;
  } else if (typeof cause === 'number' && Number.isFinite(cause)) {
    renderedCause = cause;
  }
  return {
    name,
    message,
    ...((typeof code === 'string' || (typeof code === 'number' && Number.isFinite(code))) && {
      code,
    }),
    ...(renderedCause !== undefined && { cause: renderedCause }),
  };
}

function read(target: object, key: string): unknown {
  try {
    return (target as Record<string, unknown>)[key];
  } catch {
    return undefined;
  }
}

function readString(target: object, key: string): string | undefined {
  const value = read(target, key);
  if (typeof value === 'string') return value;
  if (value === undefined) return undefined;
  try {
    return String(value);
  } catch {
    return undefined;
  }
}

/**
 * The `JSON.stringify` replacer that applies the rule — on the HOLDER's raw
 * value (`this[key]`), not on `value`. `JSON.stringify` calls `toJSON()` before
 * the replacer sees anything, and a real `AxiosError`'s `toJSON` returns its
 * `config` (request headers included) and `stack` as a plain object; a
 * replacer that read `value` would never see the Error at all. The root holder
 * is `{ '': value }`, so a root Error is covered too.
 */
function wireReplacer(this: unknown, key: string, value: unknown): unknown {
  // `value` first: an Error with no `toJSON`, and a `toJSON` that RETURNS an
  // Error (recheck SF1), both arrive here as the Error itself.
  if (isErrorValue(value)) return wireError(value);
  // The holder's raw value is needed only when `value` could be what an
  // Error's `toJSON` returned — a non-null object. A primitive never is, and a
  // DATA property is read from its descriptor (no getter runs). Only an
  // ACCESSOR property whose value is an object is read a second time: the
  // stated cost of seeing through `toJSON` (see `toWireJson`).
  if (value === null || typeof value !== 'object') return value;
  const raw = rawOf(this, key);
  return isErrorValue(raw) ? wireError(raw) : value;
}

function rawOf(holder: unknown, key: string): unknown {
  try {
    const descriptor = Object.getOwnPropertyDescriptor(holder as object, key);
    if (descriptor === undefined) return undefined;
    return 'value' in descriptor ? descriptor.value : (holder as Record<string, unknown>)[key];
  } catch {
    return undefined;
  }
}

/**
 * `JSON.stringify(value)` with every Error rendered by the rule. Same contract
 * otherwise, to the byte: it returns `undefined` for an unserializable root and
 * throws where `JSON.stringify` throws (a cycle, a BigInt) — so a sink keeps
 * its own handling of those.
 *
 * One stated difference in READS, not bytes: to see an Error behind a `toJSON`,
 * an ACCESSOR property (a getter, a Proxy's `get` trap) whose value is an
 * object is read twice, and a getter that answers differently on its second
 * read decides whether an Error is rendered. Data properties and primitives are
 * read once, as `JSON.stringify` reads them.
 */
export function toWireJson(value: unknown, space?: number): string {
  return JSON.stringify(value, wireReplacer, space);
}

/**
 * `value` with every Error it holds (in arrays and objects, at any depth up to
 * the walk bound) replaced by its {@link WireError} rendering. A value that
 * holds no Error is returned as the SAME reference — one read-only walk, no
 * allocation, which is every event but the rare one. A value that holds one is
 * copied whole (arrays and objects; everything else by reference), so a cycle
 * lands on the copy, never back on the original that still holds the Error.
 * Arrays, plain and class objects, Maps and Sets are entered; Dates, RegExps
 * and binary data are not. Never throws: a value it cannot read (a revoked
 * Proxy) is left as it is.
 */
export function withWireErrors<T>(value: T): T {
  if (!holdsError(value, 0, new WeakSet<object>())) return value;
  return copyWith(value, 0, new WeakMap<object, unknown>()) as T;
}

function holdsError(value: unknown, depth: number, visited: WeakSet<object>): boolean {
  if (value === null || typeof value !== 'object') return false;
  if (isErrorValue(value)) return true;
  if (depth >= MAX_WALK_DEPTH || !enterable(value) || visited.has(value)) return false;
  visited.add(value);
  return childrenOf(value).some((item) => holdsError(item, depth + 1, visited));
}

/** The values a walk descends into: array items, Map keys and values, Set members, own entries. */
function childrenOf(value: object): unknown[] {
  try {
    if (Array.isArray(value)) return value;
    if (value instanceof Map) return [...value.keys(), ...value.values()];
    if (value instanceof Set) return [...value];
    return safeEntries(value).map(([, item]) => item);
  } catch {
    return [];
  }
}

function copyWith(value: unknown, depth: number, copies: WeakMap<object, unknown>): unknown {
  if (value === null || typeof value !== 'object') return value;
  if (isErrorValue(value)) return wireError(value);
  if (depth >= MAX_WALK_DEPTH || !enterable(value)) return value;
  const held = copies.get(value);
  if (held !== undefined) return held;
  if (Array.isArray(value)) {
    const out: unknown[] = [];
    copies.set(value, out);
    for (const item of value) out.push(copyWith(item, depth + 1, copies));
    return out;
  }
  // A Map or Set is entered too: `JSON.stringify` writes neither's contents,
  // but a detached sink that does NOT serialize receives the clone, and a
  // cloned Error still carries `stack`.
  if (value instanceof Map) {
    const out = new Map<unknown, unknown>();
    copies.set(value, out);
    for (const [k, v] of value)
      out.set(copyWith(k, depth + 1, copies), copyWith(v, depth + 1, copies));
    return out;
  }
  if (value instanceof Set) {
    const out = new Set<unknown>();
    copies.set(value, out);
    for (const item of value) out.add(copyWith(item, depth + 1, copies));
    return out;
  }
  const out: Record<string, unknown> = {};
  copies.set(value, out);
  for (const [key, item] of safeEntries(value)) out[key] = copyWith(item, depth + 1, copies);
  return out;
}

function enterable(value: object): boolean {
  try {
    return !(
      value instanceof Date ||
      value instanceof RegExp ||
      value instanceof ArrayBuffer ||
      ArrayBuffer.isView(value)
    );
  } catch {
    return false; // a revoked Proxy: nothing to enter, left as it is
  }
}

function safeEntries(value: object): Array<[string, unknown]> {
  try {
    return Object.entries(value);
  } catch {
    return [];
  }
}
