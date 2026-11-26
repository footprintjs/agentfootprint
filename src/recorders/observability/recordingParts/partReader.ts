/**
 * recordingParts/partReader — read one part named by an admitted index, and
 * prove it holds exactly what the index says before handing anything on.
 *
 * Role:  Lens. The one place a part's bytes become values: the size cap
 *        before any store call, the source's metadata and digest checks,
 *        bounded unpacking, then the payload's own fields — its format (the
 *        one the index's format names: a v2 index v2 parts, a v1 index v1
 *        parts), its run, its position and its exact key set, and in format 2
 *        its stored sub-flow payloads, exactly the ones the index places there.
 * Reads: the part source it is handed.
 * Emits: N/A.
 */

import { utf8Length } from '../../../lib/utf8.js';
import { toWireJson } from '../../../lib/wireJson.js';
import type { Recording } from '../recordRun.js';
import {
  PackedRecordingError,
  PackedRecordingTooLargeError,
  isPackedRecording,
} from '../recordingPack.js';
import {
  RECORDING_INDEX_FORMAT,
  assign,
  isPlainObject,
  ownValue,
  partFormatOf,
  type IndexInvocation,
  type RecordingIndex,
  type StoredPartEntry,
} from './format.js';
import { unpackPart } from './packing.js';
import { payloadClaims, restorePayloads, resultValueFor, type PayloadKind } from './payloads.js';
import type { PartSource } from './source.js';

/** Why one read from an opened recording returned nothing. */
export interface SavedRecordingPartUnavailable {
  readonly status: 'unavailable';
  readonly reason: 'not-recorded' | 'part-missing' | 'part-changed' | 'too-large';
}

type Unavailable = SavedRecordingPartUnavailable;

function unavailable(reason: Unavailable['reason']): Unavailable {
  return Object.freeze({ status: 'unavailable', reason });
}

/** One invocation's stored payloads (format 2), each present exactly when the index places it in the part. */
export interface StoredPayloads {
  readonly entry?: unknown;
  readonly exit?: unknown;
}

/** One invocation part's contents, keyed, and the plain JSON bytes they took. */
export interface PartContents {
  readonly results: ReadonlyMap<string, unknown>;
  readonly aliases: ReadonlyMap<string, unknown>;
  /** Format 2: stored payloads by execution key (empty for format 1). */
  readonly payloads: ReadonlyMap<string, StoredPayloads>;
  readonly plainBytes: number;
}

/** One payload as a read serves it: its value, or why it has none. */
export type SavedPayloadSlot =
  | { readonly status: 'ready'; readonly value: unknown }
  | { readonly status: 'unavailable'; readonly reason: SavedRecordingPartUnavailable['reason'] };

/** An invocation's moved payloads, as a read serves them (format 2). */
export interface SavedInvocationPayloads {
  readonly entry?: SavedPayloadSlot;
  readonly exit?: SavedPayloadSlot;
}

/** A loaded payload and its plain JSON bytes (after unpacking, for a packed part; 0 when no budget asked). */
interface Loaded {
  readonly payload: Record<string, unknown>;
  readonly plainBytes: number;
}

/** The exact own keys of a payload object, the run's `runId` among them iff the index has one. */
function exactKeys(
  value: Record<string, unknown>,
  keys: readonly string[],
  runId: unknown,
  format: string,
): boolean {
  const expected = runId === undefined ? keys : [...keys, 'runId'];
  const own = Object.keys(value);
  return (
    own.length === expected.length &&
    expected.every((key) => own.includes(key)) &&
    ownValue(value, 'format') === format &&
    ownValue(value, 'runId') === runId
  );
}

/** The object's own keys equal `expected` exactly; returns its entries. */
function keyed(value: unknown, expected: ReadonlySet<string>): Map<string, unknown> | undefined {
  if (!isPlainObject(value)) return undefined;
  const own = Object.keys(value);
  if (own.length !== expected.size || !own.every((key) => expected.has(key))) return undefined;
  return new Map(own.map((key) => [key, ownValue(value, key)]));
}

/** Reads the parts of one admitted index through one source. */
export function partReader(
  index: RecordingIndex,
  source: PartSource,
  caps: { readonly root: number; readonly part: number },
) {
  const v2 = index.format === RECORDING_INDEX_FORMAT;
  const partFormat = partFormatOf(index.format);
  const results = index.parts.map(() => new Set<string>());
  const aliases = index.parts.map(() => new Set<string>());
  /** Per part: execution key → the kinds stored there. */
  const storedKinds = index.parts.map(() => new Map<string, PayloadKind[]>());
  const byKey = new Map<string, IndexInvocation>();
  for (const invocation of index.invocations) {
    byKey.set(invocation.key, invocation);
    if (invocation.part === null) continue;
    results[invocation.part]?.add(invocation.key);
    const kinds = (['entry', 'exit'] as const).filter(
      (kind) => invocation.payloads?.[kind] === 'stored',
    );
    if (kinds.length > 0) storedKinds[invocation.part]?.set(invocation.key, kinds);
  }
  for (const { key, part } of index.unmounted) results[part]?.add(key);
  for (const alias of index.aliases) if ('part' in alias) aliases[alias.part]?.add(alias.name);
  /** Every invocation with a part, to its `subflowId`: the owners the payload rule is run with. */
  const owners = new Map<string, string>();
  for (const invocation of index.invocations) {
    if (invocation.part !== null) owners.set(invocation.key, invocation.subflowId);
  }

  /** A restored value's plain JSON bytes, measured: the index's figure is only a claim. */
  const plainBytesOf = (value: unknown): number => utf8Length(toWireJson(value));

  /** The stored payloads member of a v2 part: exactly the keys and kinds the index places there. */
  function storedPayloads(
    value: unknown,
    expected: ReadonlyMap<string, readonly PayloadKind[]>,
  ): Map<string, StoredPayloads> | undefined {
    const held = keyed(value, new Set(expected.keys()));
    if (held === undefined) return undefined;
    const out = new Map<string, StoredPayloads>();
    for (const [key, member] of held) {
      const kinds = expected.get(key) as readonly PayloadKind[];
      const values = keyed(member, new Set(kinds));
      if (values === undefined) return undefined;
      out.set(key, Object.fromEntries(values) as StoredPayloads);
    }
    return out;
  }

  /**
   * Cap, fetch, parse, unpack: a payload object, or why there is none. `limit`
   * bounds the stored bytes before any store call and the PLAIN bytes a packed
   * part may expand to, refused before it expands.
   */
  async function load(
    entry: StoredPartEntry,
    limit: number,
    signal: AbortSignal | undefined,
    budgeted: boolean,
  ): Promise<Loaded | Unavailable> {
    // Decided from the index alone: no store call for a part over the cap.
    if (entry.bytes > limit) return unavailable('too-large');
    const fetched = await source.fetch(entry, signal);
    if ('refused' in fetched) {
      return unavailable(fetched.refused === 'missing' ? 'part-missing' : 'part-changed');
    }
    let parsed: unknown;
    try {
      parsed = JSON.parse(fetched.text);
    } catch {
      return unavailable('part-changed');
    }
    if (isPackedRecording(parsed) !== index.packed) return unavailable('part-changed');
    if (index.packed) {
      try {
        parsed = unpackPart(parsed, limit);
      } catch (err) {
        if (err instanceof PackedRecordingTooLargeError) return unavailable('too-large');
        if (err instanceof PackedRecordingError) return unavailable('part-changed');
        // Verified bytes too deep to expand on this runtime's stack: a resource
        // bound of this reader, not a change to the part.
        if (err instanceof RangeError) return unavailable('too-large');
        throw err;
      }
    }
    signal?.throwIfAborted();
    if (!isPlainObject(parsed)) return unavailable('part-changed');
    // A plain part's plain bytes are its text. A packed one is measured after its bounded
    // expansion, and only when a budget asks: a single read pays no second serialisation.
    const plainBytes = !budgeted
      ? 0
      : index.packed
      ? utf8Length(toWireJson(parsed))
      : utf8Length(fetched.text);
    return { payload: parsed, plainBytes };
  }

  async function base(
    signal: AbortSignal | undefined,
    budget = Number.POSITIVE_INFINITY,
  ): Promise<{ readonly recording: Recording; readonly plainBytes: number } | Unavailable> {
    const loaded = await load(
      index.base,
      Math.min(caps.root, budget),
      signal,
      budget !== Number.POSITIVE_INFINITY,
    );
    if (!('payload' in loaded)) return loaded;
    const { payload } = loaded;
    if (!exactKeys(payload, ['format', 'part', 'recording'], index.runId, partFormat)) {
      return unavailable('part-changed');
    }
    const recording = ownValue(payload, 'recording');
    if (ownValue(payload, 'part') !== 'base' || !isPlainObject(recording)) {
      return unavailable('part-changed');
    }
    if (!Array.isArray(ownValue(recording, 'events'))) return unavailable('part-changed');
    const snapshot = ownValue(recording, 'snapshot');
    if (
      isPlainObject(snapshot) &&
      Object.prototype.hasOwnProperty.call(snapshot, 'subflowResults')
    ) {
      return unavailable('part-changed');
    }
    if (index.hasSubflowResults && !isPlainObject(snapshot)) return unavailable('part-changed');
    return { recording: recording as unknown as Recording, plainBytes: loaded.plainBytes };
  }

  async function invocations(
    part: number,
    signal: AbortSignal | undefined,
    budget = Number.POSITIVE_INFINITY,
  ): Promise<PartContents | Unavailable> {
    const entry = index.parts[part];
    if (entry === undefined) return unavailable('not-recorded');
    const loaded = await load(
      entry,
      Math.min(caps.part, budget),
      signal,
      budget !== Number.POSITIVE_INFINITY,
    );
    if (!('payload' in loaded)) return loaded;
    const { payload } = loaded;
    const keys = v2
      ? ['format', 'part', 'results', 'aliases', 'payloads']
      : ['format', 'part', 'results', 'aliases'];
    if (!exactKeys(payload, keys, index.runId, partFormat) || ownValue(payload, 'part') !== part) {
      return unavailable('part-changed');
    }
    const held = keyed(ownValue(payload, 'results'), results[part] as Set<string>);
    const named = keyed(ownValue(payload, 'aliases'), aliases[part] as Set<string>);
    const stored = v2
      ? storedPayloads(
          ownValue(payload, 'payloads'),
          storedKinds[part] as Map<string, PayloadKind[]>,
        )
      : new Map<string, StoredPayloads>();
    if (held === undefined || named === undefined || stored === undefined) {
      return unavailable('part-changed');
    }
    return { results: held, aliases: named, payloads: stored, plainBytes: loaded.plainBytes };
  }

  /**
   * One invocation's moved payloads, served from the part that holds its
   * result: `undefined` when none of its payloads moved (format 1 always). A
   * `'same'` value is the result's own object, shared. Its bytes are measured
   * and must equal the index's `restoredBytes` for the invocation; otherwise
   * the part does not match its index (`part-changed`).
   */
  function payloadsOf(
    key: string,
    contents: PartContents,
  ): SavedInvocationPayloads | Unavailable | undefined {
    const invocation = byKey.get(key);
    const places = invocation?.payloads;
    if (places === undefined) return undefined;
    let measured = 0;
    const slot = (kind: PayloadKind): SavedPayloadSlot | undefined => {
      const at = places[kind];
      if (at === undefined) return undefined;
      const value =
        at === 'same'
          ? resultValueFor(contents.results.get(key), kind)
          : contents.payloads.get(key)?.[kind];
      if (at === 'same' && value !== undefined) measured += plainBytesOf(value);
      return value === undefined
        ? Object.freeze({ status: 'unavailable', reason: 'part-changed' })
        : Object.freeze({ status: 'ready', value });
    };
    const entry = slot('entry');
    const exit = slot('exit');
    if (measured !== (invocation?.restoredBytes ?? 0)) return unavailable('part-changed');
    return Object.freeze({
      ...(entry !== undefined && { entry }),
      ...(exit !== undefined && { exit }),
    });
  }

  /**
   * Every part, in order; the first one that is unavailable makes the whole
   * unavailable. `maxBytes` bounds the PLAIN total: each part may take only
   * what the parts before it left, so a packed part that would expand past
   * the rest of the budget is refused before it expands.
   */
  async function whole(
    signal: AbortSignal | undefined,
    maxBytes: number,
  ): Promise<{ readonly status: 'ready'; readonly recording: Recording } | Unavailable> {
    // The payloads restored from results are bytes of the whole that no part's
    // text counts. The index's figure for them is a CLAIM: it is reserved here,
    // provisionally (so an honest index is refused before any part is read),
    // and released below, where every restored value is measured and charged.
    const claimed = index.subflowPayloads?.restoredBytes ?? 0;
    let remaining = maxBytes - claimed;
    if (remaining < 0) return unavailable('too-large');
    const root = await base(signal, remaining);
    if ('reason' in root) return root;
    remaining -= root.plainBytes;
    const found: Record<string, unknown> = {};
    const stored = new Map<string, StoredPayloads>();
    for (let at = 0; at < index.parts.length; at++) {
      const contents = await invocations(at, signal, remaining);
      if ('reason' in contents) return contents;
      remaining -= contents.plainBytes;
      for (const [key, value] of contents.results) assign(found, key, value);
      for (const [name, value] of contents.aliases) assign(found, name, value);
      for (const [key, value] of contents.payloads) stored.set(key, value);
    }
    const recording = root.recording as unknown as Record<string, unknown>;
    const counts = index.subflowPayloads;
    if (counts !== undefined) {
      remaining += claimed;
      const measured = new Map<string, number>();
      let over = false;
      const restored = restorePayloads(
        recording,
        (key, kind) => {
          const at = byKey.get(key)?.payloads?.[kind];
          const value =
            at === 'same'
              ? resultValueFor(ownValue(found, key), kind)
              : at === 'stored'
              ? stored.get(key)?.[kind]
              : undefined;
          if (value === undefined) return undefined;
          if (at === 'same') {
            // Charged as it is restored; refused the moment the budget is spent.
            const bytes = plainBytesOf(value);
            measured.set(key, (measured.get(key) ?? 0) + bytes);
            remaining -= bytes;
            if (remaining < 0) {
              over = true;
              return undefined;
            }
          }
          return { value };
        },
        counts.same + counts.stored,
      );
      if (over) return unavailable('too-large');
      if (!restored) return unavailable('part-changed');
      // Every figure the index states, against what was measured and restored:
      // each invocation's restored bytes (their sum is the total, admitted), and
      // the payload rule run again over the restored rows, which must move
      // exactly the payloads the index places and keep the rest for the
      // reasons it counts.
      for (const invocation of index.invocations) {
        if ((invocation.restoredBytes ?? 0) !== (measured.get(invocation.key) ?? 0)) {
          return unavailable('part-changed');
        }
      }
      const claims = payloadClaims(ownValue(recording, 'snapshot'), owners);
      const placed = new Set<string>();
      for (const invocation of index.invocations) {
        for (const kind of ['entry', 'exit'] as const) {
          if (invocation.payloads?.[kind] !== undefined) placed.add(`${kind}:${invocation.key}`);
        }
      }
      if (
        claims.kept.ambiguous !== counts.kept.ambiguous ||
        claims.kept.notLast !== counts.kept.notLast ||
        claims.kept.noPart !== counts.kept.noPart ||
        claims.moved.size !== placed.size ||
        [...claims.moved].some((slot) => !placed.has(slot))
      ) {
        return unavailable('part-changed');
      }
    }
    for (const alias of index.aliases) {
      if ('key' in alias) assign(found, alias.name, ownValue(found, alias.key));
    }
    const snapshot = ownValue(recording, 'snapshot');
    if (index.hasSubflowResults && isPlainObject(snapshot)) {
      assign(snapshot, 'subflowResults', found);
    }
    return Object.freeze({ status: 'ready', recording: root.recording });
  }

  /** Every stored part's ticket, in order, checked against the index: no bytes are read. */
  async function check(
    signal: AbortSignal | undefined,
  ): Promise<{ readonly status: 'ready' } | Unavailable> {
    for (const entry of [index.base, ...index.parts]) {
      const checked = await source.check(entry, signal);
      if ('refused' in checked) {
        return unavailable(checked.refused === 'missing' ? 'part-missing' : 'part-changed');
      }
    }
    return Object.freeze({ status: 'ready' });
  }

  return { base, invocations, payloadsOf, whole, check };
}
