import { awaitUnder, throwIfAborted } from '../lib/abort.js';
import { copyJson, ownData } from '../lib/boundedJson.js';
import { stableJson } from '../lib/stableJson.js';
import { DETAIL_LIMITS } from '../artifacts/detailRequest.js';
import { ArtifactDetailError, unavailableDetail } from '../artifacts/detailError.js';
import { isArtifactRef } from '../artifacts/naming.js';
import { isExpiredMeta } from '../artifacts/objectStore.js';
import { measureArtifactBytes } from '../artifacts/payload.js';
import type { ArtifactMeta, ArtifactRecord, ArtifactRef } from '../artifacts/types.js';
import { timeAxisIssues } from '../time/axis.js';
import type { ToolExecutionContext } from './tools.js';

/** A policy that can only narrow already-scoped artifact admission. */
export interface SessionArtifactAdmissionOptions {
  readonly kinds: readonly string[];
  /** Positive safe integer, at most the existing 1 MiB JSON input ceiling. */
  readonly maxBytes: number;
  /** Only an explicit true admits the frozen snapshot; this cannot replace its data. */
  readonly check?: (
    record: ArtifactRecord,
    context: ToolExecutionContext,
  ) => boolean | Promise<boolean>;
}

/** Reads through the execution context's existing scope-bound capability. */
export type SessionArtifactAdmission = (
  ref: ArtifactRef,
  context: ToolExecutionContext,
) => Promise<ArtifactRecord>;

const MAX_METADATA_BYTES = 16 * 1024;
/** Shared session eligibility for admission and placement's navigation hint. */
export function hasArtifactSession(sessionId: unknown): sessionId is string {
  return typeof sessionId === 'string' && sessionId.trim().length > 0;
}
const META_FIELDS = [
  'ref',
  'kind',
  'mediaType',
  'bytes',
  'createdAt',
  'label',
  'digest',
  'expiresAt',
  'origin',
  'parentRefs',
  'timeAxis',
];

function configured(options: SessionArtifactAdmissionOptions) {
  try {
    const fields = ownData(options, ['kinds', 'maxBytes', 'check']);
    const kinds = copyJson(fields.kinds, MAX_METADATA_BYTES, true);
    if (
      !Array.isArray(kinds) ||
      !kinds.length ||
      !kinds.every((kind): kind is string => typeof kind === 'string' && kind.trim() !== '') ||
      new Set(kinds).size !== kinds.length ||
      !Number.isSafeInteger(fields.maxBytes) ||
      Number(fields.maxBytes) <= 0 ||
      Number(fields.maxBytes) > DETAIL_LIMITS.inputBytes ||
      (fields.check !== undefined && typeof fields.check !== 'function')
    )
      throw new Error();
    return {
      kinds: new Set(kinds),
      maxBytes: Number(fields.maxBytes),
      check: fields.check as SessionArtifactAdmissionOptions['check'],
    };
  } catch {
    throw new Error('Invalid session artifact admission configuration.');
  }
}

function validMeta(
  value: unknown,
  ref: ArtifactRef,
  kinds: ReadonlySet<string>,
  maximum: number,
): value is ArtifactMeta {
  const meta = ownData(value, META_FIELDS);
  if (
    meta.ref !== ref ||
    !isArtifactRef(meta.ref) ||
    typeof meta.kind !== 'string' ||
    !kinds.has(meta.kind) ||
    typeof meta.mediaType !== 'string' ||
    meta.mediaType.trim() === '' ||
    !Number.isSafeInteger(meta.bytes) ||
    Number(meta.bytes) < 0 ||
    Number(meta.bytes) > maximum ||
    typeof meta.createdAt !== 'number' ||
    !Number.isFinite(meta.createdAt) ||
    (meta.label !== undefined && typeof meta.label !== 'string') ||
    (meta.digest !== undefined &&
      (typeof meta.digest !== 'string' || !/^sha-256:[a-f0-9]{64}$/.test(meta.digest))) ||
    (meta.expiresAt !== undefined &&
      (typeof meta.expiresAt !== 'number' || !Number.isFinite(meta.expiresAt)))
  )
    return false;
  if (
    meta.parentRefs !== undefined &&
    (!Array.isArray(meta.parentRefs) || !meta.parentRefs.every(isArtifactRef))
  )
    return false;
  if (meta.origin !== undefined) {
    const origin = ownData(meta.origin, ['runId', 'toolCallId']);
    if (Object.values(origin).some((item) => typeof item !== 'string')) return false;
  }
  return meta.timeAxis === undefined || timeAxisIssues(meta.timeAxis).length === 0;
}

function readMeta(
  value: unknown,
  ref: ArtifactRef,
  kinds: ReadonlySet<string>,
  maximum: number,
): ArtifactMeta {
  const meta = copyJson(value, MAX_METADATA_BYTES, true);
  if (!validMeta(meta, ref, kinds, maximum) || isExpiredMeta(meta, Date.now()))
    return unavailableDetail();
  return meta;
}

function readData(value: unknown, maximum: number): unknown {
  // Text's canonical bytes exclude JSON quotes/escapes. Avoid allocating an
  // encoder buffer for a string whose UTF-16 length already exceeds the limit.
  if (typeof value === 'string') {
    if (value.length > maximum || measureArtifactBytes(value) > maximum) return unavailableDetail();
    return value;
  }
  return copyJson(value, maximum, true);
}

/**
 * Admit one stored record using this call's existing scope-bound capability.
 *
 * Requires an actual session and store, an exact kind allowlist and a payload
 * ceiling of at most 1 MiB. Metadata has a separate 16 KiB ceiling. Every call
 * reads head/get afresh, detaches/freezes ordinary JSON, checks metadata and
 * actual canonical byte counts, then runs the optional narrowing check.
 * These bounds govern admitted snapshots, not the backend's earlier allocations:
 * existing file/SQLite head/get paths may load a whole payload before returning.
 *
 * This composes no identity or scope, caches no authority, opens no parent,
 * and proves no producer, current-run origin, domain meaning or source truth.
 * Optional digest verification belongs to the store's get implementation.
 * Callback/store failures have fixed refusal text; cancellation stops waiting
 * and never delivers a late result, without promising the underlying work stops.
 */
export function sessionArtifactAdmission(
  options: SessionArtifactAdmissionOptions,
): SessionArtifactAdmission {
  const { kinds, maxBytes, check } = configured(options);
  return async (ref, context) => {
    try {
      throwIfAborted(context.signal);
      if (
        !isArtifactRef(ref) ||
        context.hasArtifacts !== true ||
        !hasArtifactSession(context.sessionId)
      )
        return unavailableDetail();
      const head = readMeta(
        await awaitUnder(context.signal, () => context.artifacts.head(ref)),
        ref,
        kinds,
        maxBytes,
      );
      const saved = ownData(await awaitUnder(context.signal, () => context.artifacts.get(ref)), [
        'meta',
        'data',
      ]);
      const meta = readMeta(saved.meta, ref, kinds, maxBytes);
      if (stableJson(head) !== stableJson(meta)) return unavailableDetail();
      const data = readData(saved.data, maxBytes);
      if (measureArtifactBytes(data) !== meta.bytes) return unavailableDetail();
      const record: ArtifactRecord = Object.freeze({ meta, data });
      if (
        check !== undefined &&
        (await awaitUnder(context.signal, () => check(record, context))) !== true
      )
        return unavailableDetail();
      throwIfAborted(context.signal);
      if (isExpiredMeta(meta, Date.now())) return unavailableDetail();
      return record;
    } catch {
      if (context.signal?.aborted) throw new ArtifactDetailError('ERR_ARTIFACT_DETAIL_CANCELLED');
      return unavailableDetail();
    }
  };
}
