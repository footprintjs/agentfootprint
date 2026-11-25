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
 *   • the store states a budget (`ArtifactStore.scopeBudget`) that the parts
 *     and the index together exceed — decided before the first put, so no put,
 *     no sweep and no delete happens;
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

import { isDevMode } from 'footprintjs';

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
import { recordingIndexText, splitRecording, type PartText, type SplitRecording } from './split.js';
import { RecordingSplitError } from './splitError.js';

/** Why a filing stopped. */
export type RecordingPartsRefusal =
  | 'not-split'
  | 'store-refused'
  | 'store-mismatch'
  | 'evicted-own-part'
  | 'would-not-fit'
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
  'would-not-fit': "its parts and index together are more than the store's budget for the scope",
  unexpected: 'an unexpected error stopped it',
};

function sentence(reason: RecordingPartsRefusal, removed: number, left: number): string {
  return (
    `The run recording was not filed in parts (${reason}): ${SENTENCES[reason]}. ` +
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
    // The index carries the writer's own digests; a store that keeps none is
    // checked on its byte count, and the reader verifies every part by its own hash.
    const digest = result.meta.digest;
    if (result.meta.bytes !== part.bytes || (digest !== undefined && digest !== part.digest)) {
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
    // Refuse up front, before any put, when the store states a budget the
    // whole filing cannot fit in: retention would otherwise evict the scope's
    // other artifacts to admit early parts, and then the filing would stop.
    if (!(await fitsBudget(store, scope, split))) throw new Stop('would-not-fit');
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

/** A ref of the minted length, to measure the index before the store mints any. */
const MINTED_LENGTH_REF = `art_${'0'.repeat(22)}`;

/**
 * Whether every part and the index fit the budget the store states for the
 * scope. A store that states none fits by definition (and keeps today's
 * behaviour: retention decides at each put). This proves the recording fits an
 * EMPTY scope, the same thing the whole layout's up-front refusal proves; a
 * filing may still evict older artifacts to make room, as a whole one does.
 */
async function fitsBudget(
  store: ArtifactStore,
  scope: ArtifactScope,
  split: SplitRecording,
): Promise<boolean> {
  if (typeof store.scopeBudget !== 'function') {
    warnNoBudget(store);
    return true;
  }
  const budget = await store.scopeBudget(scope);
  if (budget === null || budget === undefined) return true;
  const index = recordingIndexText(split.draft, {
    base: MINTED_LENGTH_REF,
    parts: split.parts.map(() => MINTED_LENGTH_REF),
  });
  const bytes = split.parts.reduce(
    (sum, part) => sum + part.bytes,
    split.base.bytes + utf8Length(index),
  );
  const count = split.parts.length + 2;
  return (
    (budget.maxBytes === undefined || bytes <= budget.maxBytes) &&
    (budget.maxCount === undefined || count <= budget.maxCount)
  );
}

/** Stores already warned about, so each instance is named once. */
const warnedStores = new WeakSet<object>();

/** The sentence a store without `scopeBudget` gets, once per instance, in dev mode. */
export const NO_BUDGET_WARNING =
  '[agentfootprint] recordings in parts: this artifact store does not state its budget ' +
  '(scopeBudget), so a recording too large for the scope is found out only after its parts ' +
  "have evicted the scope's other artifacts. Implement scopeBudget on the store to refuse " +
  'such a recording before its first put.';

function warnNoBudget(store: ArtifactStore): void {
  if (!isDevMode() || warnedStores.has(store)) return;
  warnedStores.add(store);
  // eslint-disable-next-line no-console
  console.warn(NO_BUDGET_WARNING);
}
