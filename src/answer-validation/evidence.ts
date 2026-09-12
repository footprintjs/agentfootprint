/** Bounded reads over the existing store. No new store, scope, or ref grammar. */
import { isArtifactRef } from '../artifacts/naming.js';
import {
  canonicalPayloadBytes,
  decodeCanonicalPayload,
  payloadShapeOf,
} from '../artifacts/payload.js';
import {
  ArtifactIntegrityError,
  type ArtifactScope,
  type ArtifactStore,
} from '../artifacts/types.js';
import type {
  AnswerEvidenceRefusal,
  AnswerEvidenceResolution,
  AnswerEvidenceResolver,
} from './types.js';

/** @internal Run-local read session. Closing invalidates even retained readers. */
export function createAnswerEvidenceResolver(
  store: ArtifactStore | undefined,
  scope: ArtifactScope,
  limits: { readonly maxReads: number; readonly maxBytes: number },
  signal: AbortSignal,
): {
  readonly resolver: AnswerEvidenceResolver;
  resolvedRefs(): string[];
  failureReason(): AnswerEvidenceRefusal | undefined;
  close(): void;
} {
  const boundScope = Object.freeze({ ...scope });
  const cache = new Map<string, Promise<AnswerEvidenceResolution>>();
  const resolved = new Set<string>();
  let reads = 0;
  let pendingReads = 0;
  let reservedBytes = 0;
  let closed = false;
  let failure: AnswerEvidenceRefusal | undefined;
  const unavailable = (reason: AnswerEvidenceRefusal): AnswerEvidenceResolution => {
    failure ??= reason;
    return { ok: false, reason };
  };
  const isClosed = () => closed || signal.aborted;

  const load = async (ref: string, kind: string): Promise<AnswerEvidenceResolution> => {
    if (!store) return unavailable('no-store');
    try {
      const described = await store.head(boundScope, ref);
      if (isClosed()) return unavailable('closed');
      if (described === null) return unavailable('missing-or-expired');
      // Memory stores may return their own metadata object: snapshot before the
      // next await, and never hand that live value to an author callback.
      const head = structuredClone(described);
      if (head.ref !== ref || !Number.isSafeInteger(head.bytes) || head.bytes < 0)
        return unavailable('invalid-record');
      if (head.kind !== kind) return unavailable('kind-mismatch');
      if (head.bytes > limits.maxBytes - reservedBytes) return unavailable('max-bytes');
      reservedBytes += head.bytes; // Reserve before await: parallel reads share this budget.
      const record = await store.get(boundScope, ref);
      if (isClosed()) return unavailable('closed');
      if (record === null) return unavailable('missing-or-expired');
      const meta = structuredClone(record.meta);
      if (
        meta.ref !== ref ||
        meta.kind !== kind ||
        meta.bytes !== head.bytes ||
        meta.digest !== head.digest ||
        meta.createdAt !== head.createdAt ||
        meta.expiresAt !== head.expiresAt ||
        meta.mediaType !== head.mediaType
      )
        return unavailable('invalid-record');
      // get is the store's verifying read, including its own expiry clock.
      // A nonconforming adapter may allocate too much inside get; the port has
      // no bounded-read verb. Never deliver an understated parcel as accepted.
      const bytes = canonicalPayloadBytes(record.data);
      if (bytes.byteLength !== meta.bytes) return unavailable('invalid-record');
      if (bytes.byteLength > limits.maxBytes) return unavailable('max-bytes');
      const data = decodeCanonicalPayload(payloadShapeOf(record.data), bytes.slice());
      if (isClosed()) return unavailable('closed');
      resolved.add(ref);
      return { ok: true, record: { meta, data } };
    } catch (error) {
      if (isClosed()) return unavailable('closed');
      return unavailable(
        error instanceof ArtifactIntegrityError ? 'digest-mismatch' : 'store-error',
      );
    }
  };
  const resolver: AnswerEvidenceResolver = Object.freeze({
    async resolve(
      ref: string,
      options: { readonly kind: string },
    ): Promise<AnswerEvidenceResolution> {
      if (isClosed()) return unavailable('closed');
      if (!isArtifactRef(ref) || options === null || typeof options !== 'object')
        return unavailable('invalid-input');
      const descriptor = Object.getOwnPropertyDescriptor(options, 'kind');
      if (
        !descriptor ||
        !('value' in descriptor) ||
        typeof descriptor.value !== 'string' ||
        descriptor.value.trim() === '' ||
        descriptor.value.length > 256
      )
        return unavailable('invalid-input');
      const kind = descriptor.value;
      const key = JSON.stringify([ref, kind]);
      let pending = cache.get(key);
      if (!pending) {
        if (reads >= limits.maxReads) return unavailable('max-reads');
        reads++;
        pendingReads++;
        pending = load(ref, kind).finally(() => {
          pendingReads--;
        });
        cache.set(key, pending);
      }
      const result = await pending;
      if (isClosed()) return unavailable('closed');
      // One callback cannot mutate a cached parcel subsequently used by another
      // check. Metadata and data are detached on every successful delivery.
      return result.ok ? { ok: true, record: structuredClone(result.record) } : { ...result };
    },
  });
  return {
    resolver,
    resolvedRefs: () => [...resolved],
    failureReason: () => failure ?? (pendingReads > 0 ? 'closed' : undefined),
    close() {
      closed = true;
      cache.clear();
    },
  };
}
