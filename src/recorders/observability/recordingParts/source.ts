/**
 * recordingParts/source — where a part's text comes from, checked against its
 * index entry before it is handed on.
 *
 * Role:  Adapter. Two sources behind one shape: a STORE (a scope-bound
 *        `head`/`get`) and MEMORY (the parts a whole recording was cut into on
 *        the reader's side). Both answer a part's JSON text or a fixed reason.
 * Reads: the store, through the two verbs it is handed.
 * Emits: N/A.
 *
 * ── Metadata before bytes ───────────────────────────────────────────────────
 * The store source asks `head` first and refuses a part whose kind, media
 * type, byte count, digest or run disagrees with the index before any `get`.
 * After `get` it checks the ticket again, the byte count of the text, and its
 * OWN SHA-256 of the text against the index: a store adapter that does not
 * verify its digests cannot pass a changed part. A store failure that is not
 * a fact about the part (busy, revoked, aborted) is thrown, never renamed.
 */

import type { ToolArtifacts } from '../../../artifacts/capability.js';
import { computeArtifactDigest } from '../../../artifacts/payload.js';
import {
  RECORDING_MEDIA_TYPE,
  RECORDING_PART_ARTIFACT_KIND,
} from '../../../artifacts/recordingArtifact.js';
import { ArtifactIntegrityError, type ArtifactMeta } from '../../../artifacts/types.js';
import { utf8Length } from '../../../lib/utf8.js';
import type { StoredPartEntry } from './format.js';

/** The two verbs a reader needs, already bound to one scope. */
export type SavedRecordingArtifacts = Pick<ToolArtifacts, 'head' | 'get'>;

/** What a fetch may answer instead of the text. */
export type FetchRefusal = 'missing' | 'changed';

/** One part's text, or why there is none. */
export type FetchedPart = { readonly text: string } | { readonly refused: FetchRefusal };

/** Where parts come from. */
export interface PartSource {
  fetch(entry: StoredPartEntry, signal: AbortSignal | undefined): Promise<FetchedPart>;
}

/** The payload of one artifact `get`, decoded to text when it is text. */
export type FetchedPayload =
  | { readonly text: string }
  | { readonly data: unknown }
  | { readonly refused: FetchRefusal };

const decoder = new TextDecoder('utf-8', { fatal: true });

/**
 * `get` the artifact `head` described, and refuse it as `changed` when the
 * ticket `get` returns is not the one `head` returned.
 */
export async function fetchPayload(
  artifacts: SavedRecordingArtifacts,
  meta: ArtifactMeta,
  signal: AbortSignal | undefined,
): Promise<FetchedPayload> {
  let record;
  try {
    record = await artifacts.get(meta.ref);
  } catch (err) {
    if (err instanceof ArtifactIntegrityError) return { refused: 'changed' };
    throw err;
  }
  signal?.throwIfAborted();
  if (record === null) return { refused: 'missing' };
  const got = record.meta;
  if (
    got.ref !== meta.ref ||
    got.kind !== meta.kind ||
    got.mediaType !== meta.mediaType ||
    got.bytes !== meta.bytes ||
    got.digest !== meta.digest
  ) {
    return { refused: 'changed' };
  }
  const { data } = record;
  if (typeof data === 'string') return { text: data };
  if (data instanceof Uint8Array) {
    try {
      return { text: decoder.decode(data) };
    } catch {
      return { refused: 'changed' };
    }
  }
  return { data };
}

/** Parts held by a store, each bound to its index entry and the index's run. */
export function storeSource(
  artifacts: SavedRecordingArtifacts,
  runId: string | undefined,
): PartSource {
  return {
    async fetch(entry, signal) {
      signal?.throwIfAborted();
      const meta = await artifacts.head(entry.ref);
      signal?.throwIfAborted();
      if (meta === null) return { refused: 'missing' };
      if (
        meta.ref !== entry.ref ||
        meta.kind !== RECORDING_PART_ARTIFACT_KIND ||
        meta.mediaType !== RECORDING_MEDIA_TYPE ||
        meta.bytes !== entry.bytes ||
        (meta.digest !== undefined && meta.digest !== entry.digest) ||
        meta.origin?.runId !== runId
      ) {
        return { refused: 'changed' };
      }
      const got = await fetchPayload(artifacts, meta, signal);
      if ('refused' in got) return got;
      if (!('text' in got)) return { refused: 'changed' };
      if (utf8Length(got.text) !== entry.bytes) return { refused: 'changed' };
      if ((await computeArtifactDigest(got.text)) !== entry.digest) return { refused: 'changed' };
      signal?.throwIfAborted();
      return { text: got.text };
    },
  };
}

/** Parts cut in memory from a whole recording this reader already read and checked. */
export function memorySource(texts: ReadonlyMap<string, string>): PartSource {
  return {
    // eslint-disable-next-line @typescript-eslint/require-await
    async fetch(entry, signal) {
      signal?.throwIfAborted();
      const text = texts.get(entry.digest);
      return text === undefined ? { refused: 'missing' } : { text };
    },
  };
}
