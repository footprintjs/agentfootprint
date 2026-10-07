/**
 * recordingPack — a recording with every repeated value stored ONCE.
 *
 * Role:  Codec. `packRecording` turns a recording (`recordRun` ·
 *        `toRecording()`) into plain JSON data where a value the recording
 *        holds in more than one place is written once and referred to by its
 *        index everywhere else; `unpackRecording` turns it back. Nothing here
 *        runs, records or emits.
 * Reads: its argument.
 * Emits: N/A.
 *
 * ── WHY ─────────────────────────────────────────────────────────────────────
 * An agent's history is IN a recording once per place that saw it: each
 * iteration's slot subflows are seeded with the whole conversation, the
 * boundary log keeps each subflow's input and output, `iteration_end` carries
 * the history, every call re-announces the pieces in its context. So
 * iteration k writes the k results before it again, and plain JSON grows
 * with K²·R (K iterations, R-row results). Measured on an agent run with
 * 1,000-row tool results: 67 MB at 10 iterations, 808 MB at 40, and past
 * JSON's own string limit before 80 — the first result appeared 838 times at
 * K = 40. Each of those copies is the same value; packed, each is written
 * once and the recording grows with K·R.
 *
 * ── THE FORMAT ──────────────────────────────────────────────────────────────
 *   { format: 'agentfootprint.recording.packed.v1',
 *     values:    [ <value 0>, <value 1>, … ],   each written once
 *     recording: { snapshot, events, structure } with refs in place }
 *
 * A REF is the one-key object `{ "$af:ref": n }` — "values[n] goes here". A
 * value may hold refs to other values. A value is pooled when it occurs at
 * least twice and its JSON is at least {@link MIN_POOLED_CHARS} long; a value
 * that occurs once stays where it is, so a run with no repetition packs to
 * its plain JSON plus the envelope.
 *
 * ESCAPING keeps the mapping injective: an object of the recording's own that
 * has a key `"$af:ref"` or `"$af:esc"` is written as `{ "$af:esc": <it> }`, and
 * the reader takes what is inside literally. No recording can be mistaken for
 * a reference — pinned by test/recorders/observability/recordingPack.test.ts.
 *
 * ── THE LAW ─────────────────────────────────────────────────────────────────
 * `JSON.stringify(unpackRecording(JSON.parse(JSON.stringify(packRecording(r)))))`
 * is `toWireJson(r)`, byte for byte: packing follows `JSON.stringify` (each
 * `toJSON`, dropped `undefined`s and functions, `null` for non-finite numbers,
 * a cycle or a `BigInt` throws) and the wire rule for Errors
 * (`lib/wireJson.ts`) — the bytes a plain recording is minted as. Values are
 * read twice (once to count, once to write), so a getter that answers
 * differently on its second read decides what is written; a recording is
 * plain data, and reads the same both times.
 *
 * ── READING ONE ─────────────────────────────────────────────────────────────
 * `unpackRecording(value)` takes either shape: a packed recording is expanded,
 * anything else is returned as it is — so a reader that calls it reads every
 * recording ever minted, plain or packed. A pooled value expands to ONE object
 * shared by every place that referred to it (that is what keeps the expanded
 * recording linear in memory too): treat a recording as read-only, as every
 * viewer does. A `format` from this family that is not v1 is refused by name,
 * never half-read.
 */

import { wireReplacer } from '../../lib/wireJson.js';
import type { Recording } from './recordRun.js';

/** The format marker of a packed recording. */
export const PACKED_RECORDING_FORMAT = 'agentfootprint.recording.packed.v1';

/** Any packed-recording format this reader might meet — v1 is the one it reads. */
const FORMAT_FAMILY = 'agentfootprint.recording.packed.';

/** The one key of a reference: `{ "$af:ref": n }` stands for `values[n]`. */
const REF = '$af:ref';

/** The one key of an escape: `{ "$af:esc": o }` is the recording's own `o`. */
const ESC = '$af:esc';

/**
 * The smallest JSON length a repeated value must have to be pooled. A
 * reference costs about 15 characters, so pooling anything shorter would make
 * a recording longer, not shorter.
 */
export const MIN_POOLED_CHARS = 64;

/** A recording with every repeated value written once — see the module header. */
export interface PackedRecording {
  readonly format: typeof PACKED_RECORDING_FORMAT;
  /** Every pooled value, each written once; referred to by its index. */
  readonly values: readonly unknown[];
  /** The recording, with each pooled value replaced by a reference. */
  readonly recording: unknown;
}

/** A packed recording this reader cannot expand — named, never half-read. */
export class PackedRecordingError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'PackedRecordingError';
  }
}

/** Is `value` a packed recording of the format this reader expands? */
export function isPackedRecording(value: unknown): value is PackedRecording {
  return (
    isRecord(value) &&
    value.format === PACKED_RECORDING_FORMAT &&
    Array.isArray(value.values) &&
    'recording' in value
  );
}

// FOLD · the one owner of the packed recording's bytes: packRecording writes
// them and unpackRecording is the one reader — no consumer decodes a reference
// itself
// detached: yes — the packed value shares no object with the recording.
/**
 * Pack a recording so every repeated value is stored once.
 *
 * @throws TypeError where `JSON.stringify` throws — a cycle or a `BigInt`.
 *
 * @example
 * ```ts
 * import { packRecording, recordRun } from 'agentfootprint/observe';
 *
 * const recorder = recordRun(agent);
 * await agent.run({ message });
 * fs.writeFileSync('run.json', JSON.stringify(packRecording(recorder.toRecording())));
 * ```
 */
export function packRecording(recording: Recording): PackedRecording {
  return packCounted(recording, undefined);
}

/**
 * @internal {@link packRecording}, counting its work: `work.members` grows by
 * one for every member value the packer reads, on both passes — the operation
 * count test/recorders/observability/recordingPack.test.ts pins (4× the
 * iterations, ~4× the reads). Not on any barrel.
 */
export function packCounted(
  recording: Recording,
  work: { members: number } | undefined,
): PackedRecording {
  const read = reader(work);
  const holder = { '': recording };
  const root = normalize(holder, '', recording);
  const table = countValues(root, read);
  const values: unknown[] = [];
  const written = new Map<number, number>();
  const emit = (value: unknown): unknown => {
    if (value === null || typeof value !== 'object') {
      if (typeof value !== 'string' || value.length < MIN_POOLED_CHARS) return value;
    }
    const id = table.idOf(value);
    if (id === undefined || !table.pooled(id)) return expand(value);
    let index = written.get(id);
    if (index === undefined) {
      index = values.length;
      written.set(id, index);
      values.push(null);
      values[index] = expand(value);
    }
    return { [REF]: index };
  };
  const expand = (value: unknown): unknown => {
    if (value === null || typeof value !== 'object') return value;
    if (Array.isArray(value)) {
      return read.array(value).map((member) => (member === SKIP ? null : emit(member)));
    }
    const out: Record<string, unknown> = {};
    let reserved = false;
    for (const [key, member] of read.object(value)) {
      if (key === REF || key === ESC) reserved = true;
      assign(out, key, emit(member));
    }
    return reserved ? { [ESC]: out } : out;
  };
  return {
    format: PACKED_RECORDING_FORMAT,
    recording: root === SKIP ? null : emit(root),
    values,
  };
}

/**
 * Read a recording that may be packed: a packed recording is expanded, any
 * other value is returned as it is — so one call reads every recording, plain
 * or packed. See the module header for what "expanded" shares.
 *
 * @throws PackedRecordingError for a packed format other than v1, or a packed
 *   value whose references do not resolve.
 *
 * @example
 * ```ts
 * import { unpackRecording } from 'agentfootprint/observe';
 * import { observeRecording } from 'agentfootprint-lens';
 *
 * const recording = unpackRecording(JSON.parse(text));   // plain or packed
 * const { recorder, runner } = observeRecording(recording);
 * ```
 */
export function unpackRecording(input: unknown): Recording {
  if (!isPackedRecording(input)) {
    if (
      isRecord(input) &&
      typeof input.format === 'string' &&
      input.format.startsWith(FORMAT_FAMILY)
    ) {
      throw new PackedRecordingError(
        `This reader expands '${PACKED_RECORDING_FORMAT}' and was handed '${input.format}'. ` +
          'Read it with the agentfootprint release that wrote it, or a later one.',
      );
    }
    return input as Recording;
  }
  const values = input.values;
  const resolved: unknown[] = new Array(values.length);
  const state = new Uint8Array(values.length); // 0 unread · 1 reading · 2 read
  const resolve = (index: unknown): unknown => {
    if (
      typeof index !== 'number' ||
      !Number.isInteger(index) ||
      index < 0 ||
      index >= values.length
    ) {
      throw new PackedRecordingError(
        `A reference names value ${String(index)}, which this recording does not hold.`,
      );
    }
    if (state[index] === 2) return resolved[index];
    if (state[index] === 1) {
      throw new PackedRecordingError(
        `Value ${index} refers to itself; a recording cannot hold that.`,
      );
    }
    state[index] = 1;
    resolved[index] = decode(values[index]);
    state[index] = 2;
    return resolved[index];
  };
  const decodeObject = (node: Record<string, unknown>): Record<string, unknown> => {
    const out: Record<string, unknown> = {};
    for (const key of Object.keys(node)) assign(out, key, decode(node[key]));
    return out;
  };
  const decode = (node: unknown): unknown => {
    if (node === null || typeof node !== 'object') return node;
    if (Array.isArray(node)) return node.map(decode);
    const record = node as Record<string, unknown>;
    const keys = Object.keys(record);
    if (keys.length === 1 && keys[0] === REF) return resolve(record[REF]);
    if (keys.length === 1 && keys[0] === ESC && isRecord(record[ESC])) {
      return decodeObject(record[ESC] as Record<string, unknown>);
    }
    return decodeObject(record);
  };
  return decode(input.recording) as Recording;
}

// ── The walk — JSON.stringify's own reading of a value ────────────────────

/** A member `JSON.stringify` leaves out of an object (and writes `null` for in an array). */
const SKIP: unique symbol = Symbol('skip');

/**
 * The value `JSON.stringify` would serialize for `holder[key]` once `raw` was
 * read: `toJSON`, then the wire rule (as `toWireJson`'s replacer), then boxed
 * primitives unwrapped and non-finite numbers made `null`. `SKIP` for what
 * JSON drops.
 */
function normalize(holder: object, key: string, raw: unknown): unknown {
  let value = raw;
  if (value !== null && (typeof value === 'object' || typeof value === 'bigint')) {
    const toJSON = (value as { toJSON?: unknown }).toJSON;
    if (typeof toJSON === 'function') value = (toJSON as (k: string) => unknown).call(value, key);
  }
  value = wireReplacer.call(holder, key, value);
  value = unboxed(value);
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  if (typeof value === 'bigint') throw new TypeError('a BigInt value cannot be serialized to JSON');
  if (value === undefined || typeof value === 'function' || typeof value === 'symbol') return SKIP;
  return value;
}

/**
 * A boxed primitive as `JSON.stringify` reads it — by its INTERNAL SLOT, not
 * its prototype: `new Number(3)` is `3`, `Object(1n)` is a BigInt (refused),
 * and an object that merely inherits from `Number.prototype` is an object.
 * Only an object whose prototype is not `Object.prototype` (or `null`) can be
 * one, so plain data — every recording — takes no probe at all.
 */
function unboxed(value: unknown): unknown {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return value;
  const prototype = Object.getPrototypeOf(value);
  if (prototype === Object.prototype || prototype === null) return value;
  if (hasSlot(Number.prototype.valueOf, value)) return Number(value);
  if (hasSlot(String.prototype.valueOf, value)) return String(value);
  if (hasSlot(Boolean.prototype.valueOf, value)) return Boolean.prototype.valueOf.call(value);
  if (hasSlot(BigInt.prototype.valueOf, value)) return BigInt.prototype.valueOf.call(value);
  return value;
}

/** Does `value` carry the internal slot `valueOf` reads? (It throws otherwise.) */
function hasSlot(valueOf: (this: unknown) => unknown, value: object): boolean {
  try {
    valueOf.call(value);
    return true;
  } catch {
    return false;
  }
}

/** How the packer reads a value's members — `JSON.stringify`'s own reading
 *  (`normalize` per member), counted when a work counter is given. */
interface MemberReader {
  array(array: readonly unknown[]): unknown[];
  object(object: object): [string, unknown][];
}

function reader(work: { members: number } | undefined): MemberReader {
  return {
    array(array) {
      const members: unknown[] = [];
      for (let i = 0; i < array.length; i++) members.push(normalize(array, String(i), array[i]));
      if (work !== undefined) work.members += members.length;
      return members;
    },
    object(object) {
      const members: [string, unknown][] = [];
      const keys = Object.keys(object);
      for (const key of keys) {
        const member = normalize(object, key, (object as Record<string, unknown>)[key]);
        if (member !== SKIP) members.push([key, member]);
      }
      if (work !== undefined) work.members += keys.length;
      return members;
    },
  };
}

interface ValueTable {
  /** The id of a value the count saw — a long string by content, an object by
   *  identity or, failing that, by its content key. */
  idOf(value: unknown): number | undefined;
  /** Does this value earn a place in `values`? */
  pooled(id: number): boolean;
}

/**
 * Pass one: give every distinct value an id — equal content, equal id — and
 * count how often each occurs where it would be written. An object's id comes
 * from a key built from its members' ids (a hash tree, with the content in
 * place of the hash), so two copies made by `structuredClone` share an id;
 * an object met again by identity is counted, not walked again.
 */
function countValues(root: unknown, read: MemberReader): ValueTable {
  const idsByKey = new Map<string, number>();
  const idsByString = new Map<string, number>();
  const idsByObject = new WeakMap<object, number>();
  const sizes: number[] = [];
  const counts: number[] = [];
  const open = new Set<object>();

  const newId = (size: number): number => {
    sizes.push(size);
    counts.push(0);
    return sizes.length - 1;
  };
  const stringId = (value: string): number => {
    let id = idsByString.get(value);
    if (id === undefined) {
      id = newId(jsonLength(value));
      idsByString.set(value, id);
    }
    return id;
  };
  /** The key fragment and JSON size of one member. Counts what it reaches. */
  const fragment = (value: unknown, count: boolean): [string, number] => {
    if (value === SKIP || value === null) return ['n', 4];
    switch (typeof value) {
      case 'boolean':
        return value ? ['t', 4] : ['f', 5];
      case 'number': {
        const text = String(value);
        return [`d${text};`, text.length];
      }
      case 'string': {
        if (value.length < MIN_POOLED_CHARS) {
          return [`s${value.length}:${value}`, jsonLength(value)];
        }
        const id = stringId(value);
        if (count) counts[id]! += 1;
        return [`#${id};`, sizes[id]!];
      }
      default: {
        const id = objectId(value as object, count);
        return [`#${id};`, sizes[id]!];
      }
    }
  };
  const objectId = (value: object, count: boolean): number => {
    const known = idsByObject.get(value);
    if (known !== undefined) {
      if (count) counts[known]! += 1;
      return known;
    }
    if (open.has(value)) throw new TypeError('Converting circular structure to JSON');
    open.add(value);
    let key: string;
    let size: number;
    if (Array.isArray(value)) {
      const parts = read.array(value).map((member) => fragment(member, count));
      key = `A${parts.map(([text]) => text).join('')}E`;
      size = 2 + Math.max(0, parts.length - 1) + parts.reduce((sum, [, n]) => sum + n, 0);
    } else {
      const members = read.object(value);
      let text = 'O';
      size = 2 + Math.max(0, members.length - 1);
      for (const [name, member] of members) {
        const [memberText, memberSize] = fragment(member, count);
        text += `k${name.length}:${name}${memberText}`;
        size += jsonLength(name) + 1 + memberSize;
      }
      key = `${text}E`;
    }
    open.delete(value);
    let id = idsByKey.get(key);
    if (id === undefined) {
      id = newId(size);
      idsByKey.set(key, id);
    }
    idsByObject.set(value, id);
    if (count) counts[id]! += 1;
    return id;
  };

  if (root !== SKIP) fragment(root, true);

  return {
    idOf(value) {
      if (typeof value === 'string') return idsByString.get(value);
      if (value === null || typeof value !== 'object') return undefined;
      // A value met only on the writing pass — what a `toJSON` built afresh —
      // is keyed by content, uncounted; it is pooled only if pass one counted
      // the same content.
      return idsByObject.get(value) ?? objectId(value, false);
    },
    pooled(id) {
      return counts[id]! >= 2 && sizes[id]! >= MIN_POOLED_CHARS;
    },
  };
}

/** How long `text` is once written as a JSON string — its quotes and escapes
 *  included. Sizes a value for pooling; it never writes the record. */
function jsonLength(text: string): number {
  return JSON.stringify(text).length;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

/** Set an own property — `__proto__` included, as `JSON.parse` does, never the prototype. */
function assign(target: Record<string, unknown>, key: string, value: unknown): void {
  if (key === '__proto__') {
    Object.defineProperty(target, key, {
      value,
      enumerable: true,
      writable: true,
      configurable: true,
    });
  } else {
    target[key] = value;
  }
}
