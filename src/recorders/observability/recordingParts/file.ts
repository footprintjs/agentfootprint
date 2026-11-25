/**
 * recordingParts/file — store one recording in parts: every part first, the
 * index last, so no reader ever sees an index whose parts were never written.
 *
 * Role:  Adapter. Drives an `ArtifactStore` through the cut (`split.ts`):
 *        `put` for each part, in order, then the index; `delete` to undo a
 *        filing that could not finish. Emits nothing itself: it returns what
 *        happened (what was minted, what retention swept, why it stopped), and
 *        the caller puts those facts on the record.
 * Reads: the recording it is handed.
 * Emits: N/A.
 *
 * ── When it stops ───────────────────────────────────────────────────────────
 *   • the cut refuses the recording (`RecordingSplitError`);
 *   • the store refuses a put;
 *   • a put's ticket disagrees with the writer's own byte count or digest —
 *     the store did not keep what it was given;
 *   • a put's sweep names a part THIS recording already wrote — the scope is
 *     too small to hold the whole recording, and an index naming an evicted
 *     part would serve less than it promises.
 * Then everything already written is deleted (best effort) and no index is
 * written. A part a delete could not remove is counted, never hidden: it is
 * left to the store's retention.
 *
 * ── Why delete rather than leave it to eviction ─────────────────────────────
 * An orphan part counts against the scope's byte and count budgets, and under
 * least-recently-used eviction the orphans are not the first to go: other live
 * artifacts of the same conversation would be evicted to make room for parts
 * no reader can address.
 */

import { computeArtifactDigest } from '../../../artifacts/payload.js';
import {
  RECORDING_INDEX_ARTIFACT_KIND,
  RECORDING_MEDIA_TYPE,
  RECORDING_PART_ARTIFACT_KIND,
} from '../../../artifacts/recordingArtifact.js';
import type {
  ArtifactMeta,
  ArtifactScope,
  ArtifactStore,
  PutArtifactInput,
  SweptArtifact,
} from '../../../artifacts/types.js';
import { utf8Length } from '../../../lib/utf8.js';
import { recordingIndexText, splitRecording, type PartText } from './split.js';
import { RecordingSplitError } from './splitError.js';

/** Why a filing stopped. */
export type RecordingPartsRefusal =
  | 'not-split'
  | 'store-refused'
  | 'store-mismatch'
  | 'evicted-own-part'
  | 'unexpected';

/** What filing a recording in parts did. */
export type FiledRecordingParts =
  | {
      readonly status: 'filed';
      /** The index: the one artifact a receipt names. */
      readonly index: ArtifactMeta;
      /** Every part, the base first, in the order written. */
      readonly parts: readonly ArtifactMeta[];
      readonly swept: readonly SweptArtifact[];
    }
  | {
      readonly status: 'refused';
      readonly reason: RecordingPartsRefusal;
      /** A fixed sentence with counts only: no key, ref, label or value. */
      readonly detail: string;
      readonly swept: readonly SweptArtifact[];
      /** Parts written and then deleted. */
      readonly removed: number;
      /** Parts written that a delete could not remove (left to retention). */
      readonly left: number;
    };

/** What a filing needs beyond the recording. */
export interface FileRecordingPartsOptions {
  /** The run the recording is of: stamped on every part's `origin.runId` and in every payload. */
  readonly runId?: string;
  /** The operator's label, verbatim on every part; absent, `run <runId>`. */
  readonly label?: string;
  /** Pack each part on its own. */
  readonly packed?: boolean;
  /** @internal The part size target; the default is the one every filing uses. */
  readonly targetBytes?: number;
}

const SENTENCES: Readonly<Record<RecordingPartsRefusal, string>> = {
  'not-split': 'it could not be cut into parts',
  'store-refused': 'the store refused a part',
  'store-mismatch': 'the store kept different bytes than it was given',
  'evicted-own-part': "the store's retention evicted one of its own parts to make room for another",
  unexpected: 'an unexpected error stopped it',
};

function sentence(reason: RecordingPartsRefusal, removed: number, left: number): string {
  return (
    `The run recording was not filed in parts: ${SENTENCES[reason]}. ` +
    `${removed} written part(s) removed` +
    (left > 0 ? `, ${left} left to the store's retention.` : '.')
  );
}

class Stop extends Error {
  constructor(readonly reason: RecordingPartsRefusal) {
    super(reason);
  }
}

/**
 * Store `recording` in parts in `scope`: the base part, each invocation part
 * in order, then the index. Never throws: every failure is the `refused`
 * result, with what was written already undone.
 */
export async function fileRecordingParts(
  store: ArtifactStore,
  scope: ArtifactScope,
  recording: unknown,
  options: FileRecordingPartsOptions = {},
): Promise<FiledRecordingParts> {
  const { runId } = options;
  const label = options.label ?? (runId !== undefined ? `run ${runId}` : 'run recording');
  const swept: SweptArtifact[] = [];
  const written: ArtifactMeta[] = [];

  const put = async (kind: string, part: PartText): Promise<ArtifactMeta> => {
    const input: PutArtifactInput = {
      kind,
      mediaType: RECORDING_MEDIA_TYPE,
      data: part.text,
      digest: 'sha-256',
      label,
      ...(runId !== undefined && { origin: { runId } }),
      ...(kind === RECORDING_INDEX_ARTIFACT_KIND && earliestExpiry(written)),
    };
    let result;
    try {
      result = await store.put(scope, input);
    } catch {
      throw new Stop('store-refused');
    }
    swept.push(...result.swept);
    written.push(result.meta);
    if (result.meta.bytes !== part.bytes || result.meta.digest !== part.digest) {
      throw new Stop('store-mismatch');
    }
    const mine = new Set(written.map((meta) => meta.ref));
    if (result.swept.some((gone) => mine.has(gone.ref))) throw new Stop('evicted-own-part');
    return result.meta;
  };

  try {
    let split;
    try {
      split = await splitRecording(recording, {
        ...(runId !== undefined && { runId }),
        packed: options.packed === true,
        ...(options.targetBytes !== undefined && { targetBytes: options.targetBytes }),
      });
    } catch (err) {
      if (err instanceof RecordingSplitError) throw new Stop('not-split');
      throw err;
    }
    const base = await put(RECORDING_PART_ARTIFACT_KIND, split.base);
    const parts: ArtifactMeta[] = [];
    for (const part of split.parts) parts.push(await put(RECORDING_PART_ARTIFACT_KIND, part));
    const text = recordingIndexText(split.draft, {
      base: base.ref,
      parts: parts.map((meta) => meta.ref),
    });
    const indexPart: PartText = {
      text,
      bytes: utf8Length(text),
      digest: await computeArtifactDigest(text),
    };
    const index = await put(RECORDING_INDEX_ARTIFACT_KIND, indexPart);
    return Object.freeze({
      status: 'filed',
      index,
      parts: Object.freeze([base, ...parts]),
      swept: Object.freeze(swept),
    });
  } catch (err) {
    // Any failure, named or not, undoes what was written: no index, no orphan by choice.
    const reason: RecordingPartsRefusal = err instanceof Stop ? err.reason : 'unexpected';
    let removed = 0;
    const gone = new Set(swept.map((row) => row.ref));
    for (const meta of written) {
      // A part retention already swept is not ours to delete, and not left behind either.
      if (gone.has(meta.ref)) continue;
      try {
        await store.delete(scope, meta.ref);
        removed++;
      } catch {
        // Counted below as left to retention; a failed undo never fails the run.
      }
    }
    const left = written.filter((meta) => !gone.has(meta.ref)).length - removed;
    return Object.freeze({
      status: 'refused',
      reason,
      detail: sentence(reason, removed, left),
      swept: Object.freeze(swept),
      removed,
      left,
    });
  }
}

/** The index may not outlive a part by its ttl: the earliest expiry the store stamped on one. */
function earliestExpiry(written: readonly ArtifactMeta[]): { expiresAt?: number } {
  const stamped = written
    .map((meta) => meta.expiresAt)
    .filter((at): at is number => typeof at === 'number');
  return stamped.length === 0 ? {} : { expiresAt: Math.min(...stamped) };
}
