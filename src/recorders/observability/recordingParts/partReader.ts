/**
 * recordingParts/partReader — read one part named by an admitted index, and
 * prove it holds exactly what the index says before handing anything on.
 *
 * Role:  Lens. The one place a part's bytes become values: the size cap
 *        before any store call, the source's metadata and digest checks,
 *        bounded unpacking, then the payload's own fields — its format, its
 *        run, its position and its exact key set.
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
  RECORDING_PART_FORMAT,
  assign,
  isPlainObject,
  ownValue,
  type RecordingIndex,
  type StoredPartEntry,
} from './format.js';
import { unpackPart } from './packing.js';
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

/** One invocation part's contents, keyed, and the plain JSON bytes they took. */
export interface PartContents {
  readonly results: ReadonlyMap<string, unknown>;
  readonly aliases: ReadonlyMap<string, unknown>;
  readonly plainBytes: number;
}

/** A loaded payload and its plain JSON bytes (after unpacking, for a packed part). */
interface Loaded {
  readonly payload: Record<string, unknown>;
  readonly plainBytes: number;
}

/** The exact own keys of a payload object, the run's `runId` among them iff the index has one. */
function exactKeys(
  value: Record<string, unknown>,
  keys: readonly string[],
  runId: unknown,
): boolean {
  const expected = runId === undefined ? keys : [...keys, 'runId'];
  const own = Object.keys(value);
  return (
    own.length === expected.length &&
    expected.every((key) => own.includes(key)) &&
    ownValue(value, 'format') === RECORDING_PART_FORMAT &&
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
  const results = index.parts.map(() => new Set<string>());
  const aliases = index.parts.map(() => new Set<string>());
  for (const invocation of index.invocations) {
    if (invocation.part !== null) results[invocation.part]?.add(invocation.key);
  }
  for (const { key, part } of index.unmounted) results[part]?.add(key);
  for (const alias of index.aliases) if ('part' in alias) aliases[alias.part]?.add(alias.name);

  /**
   * Cap, fetch, parse, unpack: a payload object, or why there is none. `limit`
   * bounds the stored bytes before any store call and the PLAIN bytes a packed
   * part may expand to, refused before it expands.
   */
  async function load(
    entry: StoredPartEntry,
    limit: number,
    signal: AbortSignal | undefined,
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
        throw err;
      }
    }
    signal?.throwIfAborted();
    if (!isPlainObject(parsed)) return unavailable('part-changed');
    // A plain part's plain bytes are its text; a packed one is measured after its bounded expansion.
    const plainBytes = index.packed ? utf8Length(toWireJson(parsed)) : utf8Length(fetched.text);
    return { payload: parsed, plainBytes };
  }

  async function base(
    signal: AbortSignal | undefined,
    budget = Number.POSITIVE_INFINITY,
  ): Promise<{ readonly recording: Recording; readonly plainBytes: number } | Unavailable> {
    const loaded = await load(index.base, Math.min(caps.root, budget), signal);
    if (!('payload' in loaded)) return loaded;
    const { payload } = loaded;
    if (!exactKeys(payload, ['format', 'part', 'recording'], index.runId)) {
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
    const loaded = await load(entry, Math.min(caps.part, budget), signal);
    if (!('payload' in loaded)) return loaded;
    const { payload } = loaded;
    if (
      !exactKeys(payload, ['format', 'part', 'results', 'aliases'], index.runId) ||
      ownValue(payload, 'part') !== part
    ) {
      return unavailable('part-changed');
    }
    const held = keyed(ownValue(payload, 'results'), results[part] as Set<string>);
    const named = keyed(ownValue(payload, 'aliases'), aliases[part] as Set<string>);
    if (held === undefined || named === undefined) return unavailable('part-changed');
    return { results: held, aliases: named, plainBytes: loaded.plainBytes };
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
    let remaining = maxBytes;
    const root = await base(signal, remaining);
    if ('reason' in root) return root;
    remaining -= root.plainBytes;
    const found: Record<string, unknown> = {};
    for (let at = 0; at < index.parts.length; at++) {
      const contents = await invocations(at, signal, remaining);
      if ('reason' in contents) return contents;
      remaining -= contents.plainBytes;
      for (const [key, value] of contents.results) assign(found, key, value);
      for (const [name, value] of contents.aliases) assign(found, name, value);
    }
    for (const alias of index.aliases) {
      if ('key' in alias) assign(found, alias.name, ownValue(found, alias.key));
    }
    const recording = root.recording as unknown as Record<string, unknown>;
    const snapshot = ownValue(recording, 'snapshot');
    if (index.hasSubflowResults && isPlainObject(snapshot)) {
      assign(snapshot, 'subflowResults', found);
    }
    return Object.freeze({ status: 'ready', recording: root.recording });
  }

  return { base, invocations, whole };
}
