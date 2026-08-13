/**
 * artifacts/minting — the shared half of every adapter's `put`.
 *
 * Validate the input, prove the parents, measure the bytes, compute the
 * digest when asked, mint the ref, stamp the meta. Three adapters call this
 * one pipeline so a put refused by `inMemoryArtifacts` is refused in the same
 * words by `sqliteArtifacts` — one law, three storage mechanics.
 *
 * What stays with the adapter: holding the bytes, applying the retention
 * plan, answering the other four verbs.
 */

import { isArtifactRef, mintArtifactRef } from './naming.js';
import { computeArtifactDigest, measureArtifactBytes } from './payload.js';
import { resolveExpiresAt, type ArtifactRetention } from './retention.js';
import {
  InvalidArtifactError,
  UnknownParentRefError,
  type ArtifactMeta,
  type ArtifactRef,
  type PutArtifactInput,
} from './types.js';

/** What an adapter lends the pipeline: "does this ref resolve, in THIS scope?" */
export type ParentResolver = (ref: ArtifactRef) => boolean | Promise<boolean>;

/**
 * Validate a put and build the meta it mints.
 *
 * @param input          the caller's put.
 * @param resolveParent  scope-bound existence check for parent validation.
 * @param retention      the adapter's policy — stamps `expiresAt` (stated, never sprung).
 * @param now            the adapter's clock, injected so tests own time.
 * @throws InvalidArtifactError   for input this library cannot store faithfully.
 * @throws UnknownParentRefError  for a parent that does not resolve in scope.
 */
export async function prepareArtifact(
  input: PutArtifactInput,
  resolveParent: ParentResolver,
  retention: ArtifactRetention | undefined,
  now: number,
): Promise<{ meta: ArtifactMeta; bytes: number }> {
  if (typeof input.kind !== 'string' || input.kind.trim() === '') {
    throw new InvalidArtifactError(
      `kind is ${JSON.stringify(input.kind)}. kind is the consumer vocabulary a redeemer ` +
        `decides from ('dataset/rows', 'chart/spec') — a blank one makes every head() useless. ` +
        `Name what this artifact IS.`,
    );
  }
  if (typeof input.mediaType !== 'string' || input.mediaType.trim() === '') {
    throw new InvalidArtifactError(
      `mediaType is ${JSON.stringify(input.mediaType)}. Name the payload's MIME type ` +
        `('application/json', 'text/csv', …) so a consumer can decode without guessing.`,
    );
  }
  if (
    input.expiresAt !== undefined &&
    (!Number.isFinite(input.expiresAt) || input.expiresAt <= now)
  ) {
    throw new InvalidArtifactError(
      `expiresAt = ${String(input.expiresAt)} is not a future unix-ms timestamp. An artifact ` +
        `born expired would resolve for nobody; state a future time, or omit the field.`,
    );
  }
  if (input.digest !== undefined && input.digest !== 'sha-256') {
    throw new InvalidArtifactError(
      `digest = ${JSON.stringify(input.digest)} is not an algorithm this store computes. ` +
        `'sha-256' is the one shipped; omit the field for no digest.`,
    );
  }

  // Parents are FACTS, proven at birth — a foreign key that cannot dangle.
  if (input.parentRefs !== undefined && input.parentRefs.length > 0) {
    const unresolved: ArtifactRef[] = [];
    for (const parent of input.parentRefs) {
      if (!isArtifactRef(parent) || !(await resolveParent(parent))) unresolved.push(parent);
    }
    if (unresolved.length > 0) throw new UnknownParentRefError(unresolved);
  }

  // Measure (and refuse the unserializable) BEFORE minting, so a refused put
  // never burns a ref.
  const bytes = measureArtifactBytes(input.data);
  const digest = input.digest === 'sha-256' ? await computeArtifactDigest(input.data) : undefined;
  const expiresAt = resolveExpiresAt(input.expiresAt, retention, now);

  const meta: ArtifactMeta = {
    ref: mintArtifactRef(),
    kind: input.kind,
    mediaType: input.mediaType,
    bytes,
    createdAt: now,
    ...(input.label !== undefined && { label: input.label }),
    ...(digest !== undefined && { digest }),
    ...(expiresAt !== undefined && { expiresAt }),
    ...(input.origin !== undefined && { origin: input.origin }),
    ...(input.parentRefs !== undefined &&
      input.parentRefs.length > 0 && { parentRefs: [...input.parentRefs] }),
  };
  return { meta, bytes };
}
