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
 *  - SYNCHRONOUS: a serializing sink writes {@link toWireJson}(event) instead
 *    of `JSON.stringify(event)` — a replacer, so every non-Error value
 *    serializes exactly as before.
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

/** An Error from any realm (`instanceof` fails across realms; the brand does not). */
export function isErrorValue(value: unknown): value is Error {
  return (
    value instanceof Error ||
    (typeof value === 'object' &&
      value !== null &&
      Object.prototype.toString.call(value) === '[object Error]')
  );
}

/** Render one Error by the rule. Never throws; a throwing getter reads as absent. */
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
  return typeof value === 'string' ? value : value === undefined ? undefined : String(value);
}

/** The `JSON.stringify` replacer that applies the rule. */
function wireReplacer(_key: string, value: unknown): unknown {
  return isErrorValue(value) ? wireError(value) : value;
}

/**
 * `JSON.stringify(value)` with every Error rendered by the rule. Same contract
 * otherwise, to the byte: it returns `undefined` for an unserializable root and
 * throws where `JSON.stringify` throws (a cycle, a BigInt) — so a sink keeps
 * its own handling of those.
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
 * Maps, Sets, Dates, RegExps and binary data are not entered
 * (`JSON.stringify` writes none of their contents).
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
  const items = Array.isArray(value) ? value : safeEntries(value).map(([, item]) => item);
  return items.some((item) => holdsError(item, depth + 1, visited));
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
  const out: Record<string, unknown> = {};
  copies.set(value, out);
  for (const [key, item] of safeEntries(value)) out[key] = copyWith(item, depth + 1, copies);
  return out;
}

function enterable(value: object): boolean {
  return !(
    value instanceof Map ||
    value instanceof Set ||
    value instanceof Date ||
    value instanceof RegExp ||
    value instanceof ArrayBuffer ||
    ArrayBuffer.isView(value)
  );
}

function safeEntries(value: object): Array<[string, unknown]> {
  try {
    return Object.entries(value);
  } catch {
    return [];
  }
}
