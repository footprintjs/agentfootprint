/**
 * recordingParts/open — open a saved recording, then read its root, one
 * invocation, or the whole of it, one checked part at a time.
 *
 * Role:  Lens. Serves one reader what one stored recording holds and nothing
 *        more: an invocation is read from the part that holds it, after the
 *        part's metadata and digest prove it is the part the index names.
 * Reads: the scope-bound `head`/`get` it is handed.
 * Emits: N/A.
 *
 * ── Two layouts, one reader ─────────────────────────────────────────────────
 * A whole recording (`recording/run`) is read once, within `maxRootBytes`, and
 * cut in memory by the same split a writer uses (`recordingParts/split.ts ·
 * splitRecordingData`). A recording saved in parts (`recording/run-index`)
 * reads only its index at open; `readRoot` reads the base part and
 * `readInvocation` the one part holding that invocation. Both layouts answer
 * through the same part reader, so both serve the same values.
 *
 * ── Two index formats ───────────────────────────────────────────────────────
 * Format 2 (what the writer writes) keeps a sub-flow invocation's entry and
 * exit payloads with the invocation (`subflowPayloads.ts`): `readRoot` serves the
 * base as stored (marked, without them), `readInvocation` serves them beside
 * the result, `readWhole` puts them back. Format 1 (filed by 18.2 and 18.3)
 * keeps them in the base row and reads as it always did; so does a whole
 * recording, whose in-memory cut is format 1. An index of a format this reader
 * does not know is `unsupported-format`, never a corrupt part.
 *
 * ── Honesty ─────────────────────────────────────────────────────────────────
 * A missing, changed or oversized part is unavailable for exactly the
 * invocations it holds; every other invocation still reads. Nothing falls
 * back to another source. `readWhole` is all-or-nothing.
 */

import { isArtifactRef } from '../../../artifacts/naming.js';
import { computeArtifactDigest } from '../../../artifacts/payload.js';
import {
  RECORDING_ARTIFACT_KIND,
  RECORDING_INDEX_ARTIFACT_KIND,
  RECORDING_MEDIA_TYPE,
} from '../../../artifacts/recordingArtifact.js';
import type { ArtifactMeta, ArtifactRef } from '../../../artifacts/types.js';
import { utf8Length } from '../../../lib/utf8.js';
import type { Recording } from '../recordRun.js';
import {
  PackedRecordingError,
  PackedRecordingTooLargeError,
  unpackRecording,
} from '../recordingPack.js';
import {
  RECORDING_PARTS_LIMITS,
  RECORDING_PART_TARGET_BYTES,
  isName,
  isUnsupportedIndexFormat,
  readRecordingIndex,
  type RecordingIndex,
} from './format.js';
import {
  partReader,
  type SavedInvocationPayloads,
  type SavedRecordingPartUnavailable,
} from './partReader.js';
import {
  fetchPayload,
  memorySource,
  storeSource,
  type PartSource,
  type SavedRecordingArtifacts,
} from './source.js';
import { splitRecordingData } from './split.js';
import { RecordingSplitError } from './splitError.js';

export type { SavedRecordingArtifacts } from './source.js';
export type {
  SavedInvocationPayloads,
  SavedPayloadSlot,
  SavedRecordingPartUnavailable,
} from './partReader.js';

const MiB = 1024 * 1024;

/** How much {@link openSavedRecording} agrees to read. Every cap is checked from metadata first. */
export interface OpenSavedRecordingOptions {
  /** Cancels the open, and every later read that is not given its own signal. */
  readonly signal?: AbortSignal;
  /** The largest index, in bytes. Default 2 MiB. */
  readonly maxIndexBytes?: number;
  /**
   * The largest base part, or whole recording, in bytes (a packed one: its plain
   * size). Default 16 MiB. A whole recording within it opens, and the parts it is
   * cut into in memory are not capped again.
   */
  readonly maxRootBytes?: number;
  /** The largest invocation part, in bytes (a packed one: its plain size). Default 16 MiB. */
  readonly maxPartBytes?: number;
}

/** Options for one read from an opened recording. */
export interface SavedRecordingReadOptions {
  readonly signal?: AbortSignal;
}

/** Options for {@link SavedRecording.readWhole}. */
export interface SavedRecordingWholeOptions extends SavedRecordingReadOptions {
  /**
   * The most plain JSON bytes the whole read may take. Default 64 MiB. The stored
   * total is checked from the index first; then each part may expand only to what
   * the parts before it left, so a packed part is refused before it expands past it.
   */
  readonly maxBytes?: number;
}

/** One recorded invocation, in the order the lazy viewer lists them. */
export interface SavedInvocation {
  /** The execution key: the mount's runtime stage id and its `subflowResults` key. */
  readonly key: string;
  /** Mount keys from the root down to this invocation (the viewer's `invocationPath`). */
  readonly path: readonly string[];
  readonly subflowId: string;
  /** `false` when the tree mounts it but the recording holds no result for it. */
  readonly recorded: boolean;
  /** Compact JSON bytes of its result, when recorded. */
  readonly bytes?: number;
}

/** Sizes known from the index alone, with no part read. */
export interface SavedRecordingSizes {
  /** Every stored byte of this recording. */
  readonly storedBytes: number;
  /**
   * `storedBytes` plus the plain JSON bytes `readWhole` restores from results
   * (an index-format-2 recording's `'same'` sub-flow payloads, stored once, in
   * the result), as the index states them. What a whole read holds: a band
   * decided from it is provisional, since `readWhole` measures what it
   * restores and refuses a figure that does not match. Equal to `storedBytes`
   * for a format-1 or whole recording.
   */
  readonly restoredBytes: number;
  /** How many artifacts hold it. */
  readonly artifacts: number;
  /** The index's bytes (parts layout only). */
  readonly index?: number;
  /** The base part's bytes (parts layout only). */
  readonly base?: number;
  /** Each invocation part (parts layout only; empty for a whole recording). */
  readonly parts: readonly {
    readonly part: number;
    readonly bytes: number;
    readonly results: number;
  }[];
}

/** Why a saved recording could not be opened. */
export interface SavedRecordingUnavailable {
  readonly status: 'unavailable';
  readonly reason:
    | 'not-found'
    | 'not-a-recording'
    | 'too-large'
    | 'invalid-index'
    | 'invalid-recording'
    /** An index of a format this reader does not know (`agentfootprint.recording.index.v<N>`). */
    | 'unsupported-format';
}

/** An opened saved recording. Only its index (or, for a whole recording, the whole) has been read. */
export interface SavedRecording {
  readonly status: 'ready';
  readonly layout: 'whole' | 'parts';
  /** The run the recording was filed for (`origin.runId`). */
  readonly runId?: string;
  /** `snapshot.runId`, the engine's executor id: what a viewer address's `runId` must equal. */
  readonly snapshotRunId?: string;
  /**
   * `false` when the tree and the results disagree, or a result is not in the
   * shape the lazy viewer admits; such a viewer refuses the recording whole.
   * Check it before relying on what `readInvocation` returns.
   */
  readonly complete: boolean;
  readonly invocations: readonly SavedInvocation[];
  /** Path aliases proven equal to an invocation's result: alias → execution key. */
  readonly aliases: ReadonlyMap<string, string>;
  readonly sizes: SavedRecordingSizes;
  /** The recording without its subflow results: `{ snapshot, events, structure }`. */
  readRoot(
    options?: SavedRecordingReadOptions,
  ): Promise<
    { readonly status: 'ready'; readonly recording: Recording } | SavedRecordingPartUnavailable
  >;
  /**
   * One invocation's result, read from the one part that holds it. The result
   * is the stored one, proven by digest and key set. Its SHAPE was checked when
   * the recording was cut: on a recording that is not `complete`, a `ready`
   * result may be one the lazy viewer would refuse, so check `complete` first.
   *
   * `payloads` (index format 2): what the invocation was handed (`entry`) and
   * handed back (`exit`), present exactly when that payload moved out of the
   * base row (whose event then carries `payloadWith: 'invocation'`). A
   * `'same'` payload is the result's own object, shared; its bytes are measured,
   * and differ from the index's `restoredBytes` only on a part that does not
   * match its index (`part-changed`). Absent for a format-1 or whole
   * recording, whose payloads are in the base row.
   */
  readInvocation(
    key: string,
    options?: SavedRecordingReadOptions,
  ): Promise<
    | {
        readonly status: 'ready';
        readonly invocation: SavedInvocation;
        readonly result: unknown;
        readonly payloads?: SavedInvocationPayloads;
      }
    | SavedRecordingPartUnavailable
  >;
  /**
   * Whether every stored part is still there as the index names it: a `head`
   * of each, its kind, bytes, digest and run checked against the index, and no
   * byte read. `ready`, or the first part's `part-missing` / `part-changed`.
   * A whole recording has no separate parts: this makes NO store call for it
   * and is always `ready`, so a host must `head` that artifact itself. A host
   * serving something derived from the recording (a cached answer) asks this
   * first, so it never serves past the store's own retention.
   */
  checkParts(
    options?: SavedRecordingReadOptions,
  ): Promise<{ readonly status: 'ready' } | SavedRecordingPartUnavailable>;
  /**
   * The whole recording, with every result, alias and moved sub-flow payload
   * restored; refused whole if any part is. It deep-equals the recording that
   * was saved but is not byte-equal to it: `subflowResults` comes last in the
   * snapshot, its keys are in part order, a proven alias shares its key's
   * result object, and so does a `'same'` payload. The payloads restored from
   * results are measured and charged against `maxBytes` as they are restored
   * (`too-large` the moment it is spent); the index's own figure for them only
   * decides an early refusal, and a figure that differs from what was measured
   * is `part-changed`.
   */
  readWhole(
    options?: SavedRecordingWholeOptions,
  ): Promise<
    { readonly status: 'ready'; readonly recording: Recording } | SavedRecordingPartUnavailable
  >;
}

function unavailable(reason: SavedRecordingUnavailable['reason']): SavedRecordingUnavailable {
  return Object.freeze({ status: 'unavailable', reason });
}

function cap(name: string, value: number | undefined, fallback: number): number {
  if (value === undefined) return fallback;
  if (typeof value !== 'number' || Number.isNaN(value) || value <= 0) {
    throw new RangeError(`openSavedRecording: ${name} is a positive number of bytes.`);
  }
  return value;
}

/**
 * Open a saved recording by its receipt's ref: either layout.
 *
 * `artifacts` is already bound to ONE scope (a tool's `ctx.artifacts`, or a
 * host's per-request binding), so a ref from any other scope is `not-found`.
 * Open reads the index only (for a whole recording: the whole, within
 * `maxRootBytes`). Every cap is checked from `head` metadata before any `get`.
 * A store error that is not a fact about the recording (busy, revoked) and an
 * aborted signal reject; they are never reported as a reason.
 *
 * @example
 * ```ts
 * import { openSavedRecording } from 'agentfootprint/observe';
 *
 * const saved = await openSavedRecording(ctx.artifacts, receipt.ref);
 * if (saved.status === 'ready') {
 *   const root = await saved.readRoot();                       // no subflow results
 *   const first = await saved.readInvocation(saved.invocations[0].key);
 * }
 * ```
 */
export async function openSavedRecording(
  artifacts: SavedRecordingArtifacts,
  ref: ArtifactRef,
  options: OpenSavedRecordingOptions = {},
): Promise<SavedRecording | SavedRecordingUnavailable> {
  const caps = {
    index: cap('maxIndexBytes', options.maxIndexBytes, 2 * MiB),
    root: cap('maxRootBytes', options.maxRootBytes, 16 * MiB),
    part: cap('maxPartBytes', options.maxPartBytes, 16 * MiB),
  };
  const { signal } = options;
  signal?.throwIfAborted();
  if (!isArtifactRef(ref)) return unavailable('not-found');
  const meta = await artifacts.head(ref);
  signal?.throwIfAborted();
  if (meta === null) return unavailable('not-found');
  const isIndex = meta.kind === RECORDING_INDEX_ARTIFACT_KIND;
  if (
    meta.mediaType !== RECORDING_MEDIA_TYPE ||
    (!isIndex && meta.kind !== RECORDING_ARTIFACT_KIND)
  ) {
    return unavailable('not-a-recording');
  }
  // The ticket must be the one asked for, and its size a size, before any cap reads it.
  if (meta.ref !== ref || !Number.isSafeInteger(meta.bytes) || meta.bytes < 0) {
    return unavailable(isIndex ? 'invalid-index' : 'invalid-recording');
  }
  if (isIndex) {
    if (meta.bytes > caps.index) return unavailable('too-large');
    const index = await readIndex(artifacts, meta, signal);
    if ('reason' in index) return index;
    const storedBytes = index.parts.reduce(
      (sum, part) => sum + part.bytes,
      meta.bytes + index.base.bytes,
    );
    const sizes: SavedRecordingSizes = {
      storedBytes,
      restoredBytes: storedBytes + (index.subflowPayloads?.restoredBytes ?? 0),
      artifacts: index.parts.length + 2,
      index: meta.bytes,
      base: index.base.bytes,
      parts: index.parts.map((part, at) => ({
        part: at,
        bytes: part.bytes,
        results: part.results,
      })),
    };
    return opened(index, 'parts', storeSource(artifacts, index.runId), sizes, caps, signal);
  }
  return openWhole(artifacts, meta, caps, signal);
}

async function readIndex(
  artifacts: SavedRecordingArtifacts,
  meta: ArtifactMeta,
  signal: AbortSignal | undefined,
): Promise<RecordingIndex | SavedRecordingUnavailable> {
  const got = await fetchPayload(artifacts, meta, signal);
  if ('refused' in got)
    return unavailable(got.refused === 'missing' ? 'not-found' : 'invalid-index');
  if (!('text' in got) || utf8Length(got.text) !== meta.bytes) return unavailable('invalid-index');
  if (meta.digest !== undefined && (await computeArtifactDigest(got.text)) !== meta.digest) {
    return unavailable('invalid-index');
  }
  signal?.throwIfAborted();
  let parsed: unknown;
  try {
    parsed = JSON.parse(got.text);
  } catch {
    return unavailable('invalid-index');
  }
  if (isUnsupportedIndexFormat(parsed)) return unavailable('unsupported-format');
  const index = readRecordingIndex(parsed);
  if (index === undefined || meta.origin?.runId !== index.runId)
    return unavailable('invalid-index');
  return index;
}

async function openWhole(
  artifacts: SavedRecordingArtifacts,
  meta: ArtifactMeta,
  caps: { readonly root: number; readonly part: number; readonly index: number },
  signal: AbortSignal | undefined,
): Promise<SavedRecording | SavedRecordingUnavailable> {
  if (meta.bytes > caps.root) return unavailable('too-large');
  const got = await fetchPayload(artifacts, meta, signal);
  if ('refused' in got) {
    return unavailable(got.refused === 'missing' ? 'not-found' : 'invalid-recording');
  }
  let data: unknown;
  if ('text' in got) {
    // The same checks as an index: the exact length, and the store's digest by our own hash.
    if (utf8Length(got.text) !== meta.bytes) return unavailable('invalid-recording');
    if (meta.digest !== undefined && (await computeArtifactDigest(got.text)) !== meta.digest) {
      return unavailable('invalid-recording');
    }
    signal?.throwIfAborted();
    try {
      data = JSON.parse(got.text);
    } catch {
      return unavailable('invalid-recording');
    }
  } else data = got.data;
  try {
    data = unpackRecording(data, { maxBytes: caps.root });
  } catch (err) {
    if (err instanceof PackedRecordingTooLargeError) return unavailable('too-large');
    if (err instanceof PackedRecordingError) return unavailable('invalid-recording');
    // Too deep to expand on this runtime's stack: unreadable here, as a plain
    // recording too deep to serialize is (a reason, never an escaping error).
    if (err instanceof RangeError) return unavailable('invalid-recording');
    throw err;
  }
  const runId = isName(meta.origin?.runId) ? meta.origin?.runId : undefined;
  let split;
  try {
    // Format 1: a whole recording's payloads stay in its base row, so every
    // read of it is what it was before format 2.
    split = await splitRecordingData(data, {
      ...(runId !== undefined && { runId }),
      targetBytes: RECORDING_PART_TARGET_BYTES,
      subflowPayloads: 'in-row',
    });
  } catch (err) {
    if (err instanceof RecordingSplitError) {
      return unavailable(err.code === 'over-limit' ? 'too-large' : 'invalid-recording');
    }
    throw err;
  }
  signal?.throwIfAborted();
  const texts = new Map<string, string>([[split.base.digest, split.base.text]]);
  for (const part of split.parts) texts.set(part.digest, part.text);
  const memoryRef = `art_${'0'.repeat(22)}`;
  const index: RecordingIndex = {
    ...split.draft,
    base: { ref: memoryRef, ...split.draft.base },
    parts: split.draft.parts.map((part) => ({ ref: memoryRef, ...part })),
  };
  const sizes: SavedRecordingSizes = {
    storedBytes: meta.bytes,
    restoredBytes: meta.bytes,
    artifacts: 1,
    parts: [],
  };
  // The whole was admitted within maxRootBytes; the parts cut from it in memory are not capped again.
  const admitted = { root: Number.POSITIVE_INFINITY, part: Number.POSITIVE_INFINITY };
  return opened(index, 'whole', memorySource(texts), sizes, admitted, signal);
}

function opened(
  index: RecordingIndex,
  layout: SavedRecording['layout'],
  source: PartSource,
  sizes: SavedRecordingSizes,
  caps: { readonly root: number; readonly part: number },
  openSignal: AbortSignal | undefined,
): SavedRecording {
  const invocations = index.invocations.map((invocation) =>
    Object.freeze<SavedInvocation>({
      key: invocation.key,
      path: Object.freeze([...invocation.path]),
      subflowId: invocation.subflowId,
      recorded: invocation.part !== null,
      ...(invocation.bytes !== undefined && { bytes: invocation.bytes }),
    }),
  );
  const byKey = new Map(invocations.map((invocation, at) => [invocation.key, at]));
  const aliases = new Map<string, string>();
  for (const alias of index.aliases) if ('key' in alias) aliases.set(alias.name, alias.key);
  const parts = partReader(index, source, caps);
  const signalOf = (options: SavedRecordingReadOptions | undefined): AbortSignal | undefined =>
    options?.signal ?? openSignal;

  return Object.freeze<SavedRecording>({
    status: 'ready',
    layout,
    ...(index.runId !== undefined && { runId: index.runId }),
    ...(index.snapshotRunId !== undefined && { snapshotRunId: index.snapshotRunId }),
    complete: index.complete,
    invocations: Object.freeze(invocations),
    aliases,
    sizes: Object.freeze({
      ...sizes,
      parts: Object.freeze(sizes.parts.map((p) => Object.freeze(p))),
    }),
    async readRoot(options) {
      const signal = signalOf(options);
      signal?.throwIfAborted();
      const base = await parts.base(signal);
      return 'reason' in base
        ? base
        : Object.freeze({ status: 'ready', recording: base.recording });
    },
    async readInvocation(key, options) {
      const signal = signalOf(options);
      signal?.throwIfAborted();
      const at =
        typeof key === 'string' && key.length <= RECORDING_PARTS_LIMITS.nameChars
          ? byKey.get(key)
          : undefined;
      const entry = at === undefined ? undefined : index.invocations[at];
      if (at === undefined || entry === undefined || entry.part === null) {
        return Object.freeze({ status: 'unavailable', reason: 'not-recorded' });
      }
      const part = await parts.invocations(entry.part, signal);
      if ('reason' in part) return part;
      const payloads = parts.payloadsOf(key, part);
      if (payloads !== undefined && 'reason' in payloads) return payloads;
      return Object.freeze({
        status: 'ready',
        invocation: invocations[at] as SavedInvocation,
        result: part.results.get(key),
        ...(payloads !== undefined && { payloads }),
      });
    },
    async checkParts(options) {
      const signal = signalOf(options);
      signal?.throwIfAborted();
      return parts.check(signal);
    },
    async readWhole(options) {
      const signal = signalOf(options);
      signal?.throwIfAborted();
      const limit = options?.maxBytes ?? 64 * MiB;
      if (typeof limit !== 'number' || Number.isNaN(limit) || limit <= 0) {
        throw new RangeError('readWhole: maxBytes is a positive number of bytes.');
      }
      // Decided from the index first: every stored part, plus the payloads a
      // whole read restores from results (format 2), which no part's text counts.
      const total = index.parts.reduce(
        (sum, part) => sum + part.bytes,
        index.base.bytes + (index.subflowPayloads?.restoredBytes ?? 0),
      );
      if (total > limit) return Object.freeze({ status: 'unavailable', reason: 'too-large' });
      return parts.whole(signal, limit);
    },
  });
}
