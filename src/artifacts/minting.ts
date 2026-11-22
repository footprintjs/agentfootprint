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
import {
  digestArtifactBuffer,
  snapshotArtifactPayload,
  type ArtifactPayloadSnapshot,
} from './payload.js';
import { resolveExpiresAt, type ArtifactRetention } from './retention.js';
import { classify } from '../time/axis/classify.js';
import { timeAxisIssues, type DatasetTimeAxis } from '../time/axis.js';
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
): Promise<{ meta: ArtifactMeta; payload: ArtifactPayloadSnapshot }> {
  const { kind, mediaType, label, expiresAt, digest, timeAxis, parentRefs, origin } = input;
  if (typeof kind !== 'string' || kind.trim() === '') {
    throw new InvalidArtifactError(
      `kind is ${JSON.stringify(kind)}. kind is the consumer vocabulary a redeemer ` +
        `decides from ('dataset/rows', 'chart/spec') — a blank one makes every head() useless. ` +
        `Name what this artifact IS.`,
    );
  }
  if (typeof mediaType !== 'string' || mediaType.trim() === '') {
    throw new InvalidArtifactError(
      `mediaType is ${JSON.stringify(mediaType)}. Name the payload's MIME type ` +
        `('application/json', 'text/csv', …) so a consumer can decode without guessing.`,
    );
  }
  if (expiresAt !== undefined && (!Number.isFinite(expiresAt) || expiresAt <= now)) {
    throw new InvalidArtifactError(
      `expiresAt = ${String(expiresAt)} is not a future unix-ms timestamp. An artifact ` +
        `born expired would resolve for nobody; state a future time, or omit the field.`,
    );
  }
  if (digest !== undefined && digest !== 'sha-256') {
    throw new InvalidArtifactError(
      `digest = ${JSON.stringify(digest)} is not an algorithm this store computes. ` +
        `'sha-256' is the one shipped; omit the field for no digest.`,
    );
  }

  // A declared time axis is judged, never repaired: a ticket whose
  // description the store had "fixed" would carry a promise nobody made.
  if (timeAxis !== undefined) {
    const issues = timeAxisIssues(timeAxis);
    if (issues.length > 0) throw new InvalidArtifactError(issues.join(' '));
  }

  // Capture everything the ticket and storage will use before a parent lookup or digest yields.
  const axis = timeAxis === undefined ? undefined : copyTimeAxis(timeAxis);
  const parents = parentRefs === undefined ? undefined : [...parentRefs];
  const source = origin === undefined ? undefined : { ...origin };
  const payload = snapshotArtifactPayload(input.data);

  // Parents are FACTS, proven at birth — a foreign key that cannot dangle.
  if (parents !== undefined && parents.length > 0) {
    const unresolved: ArtifactRef[] = [];
    for (const parent of parents) {
      if (!isArtifactRef(parent) || !(await resolveParent(parent))) unresolved.push(parent);
    }
    if (unresolved.length > 0) throw new UnknownParentRefError(unresolved);
  }

  const payloadDigest =
    digest === 'sha-256' ? await digestArtifactBuffer(payload.bytes.buffer) : undefined;
  const expiry = resolveExpiresAt(expiresAt, retention, now);
  const naiveCount = countStoredNaiveTimes(payload, axis);

  const meta: ArtifactMeta = {
    ref: mintArtifactRef(),
    ...(naiveCount !== undefined && naiveCount > 0 && { naiveCount }),
    kind,
    mediaType,
    bytes: payload.bytes.byteLength,
    createdAt: now,
    ...(label !== undefined && { label }),
    ...(payloadDigest !== undefined && { digest: payloadDigest }),
    ...(expiry !== undefined && { expiresAt: expiry }),
    ...(source !== undefined && { origin: source }),
    ...(parents !== undefined && parents.length > 0 && { parentRefs: parents }),
    ...(axis !== undefined && { timeAxis: axis }),
  };
  return { meta, payload };
}

/** Count stored rows only for an unzoned ISO axis. Serialization has already resolved any accessors. */
function countStoredNaiveTimes(
  payload: ArtifactPayloadSnapshot,
  axis: DatasetTimeAxis | undefined,
): number | undefined {
  if (
    axis?.unit !== 'iso' ||
    axis.zone !== undefined ||
    payload.shape !== 'json' ||
    !payload.text.startsWith('[')
  )
    return undefined;
  const rows = JSON.parse(payload.text) as unknown[];
  const walls = new Map();
  let count = 0;
  for (const row of rows) {
    if (classify(row, axis, walls).kind === 'naive') count++;
  }
  return count;
}

/** The ticket keeps its OWN copy — a caller mutating its declaration after
 *  the put must not rewrite a minted description. */
function copyTimeAxis(axis: DatasetTimeAxis): DatasetTimeAxis {
  const { aggregate } = axis;
  return {
    ...axis,
    ...(aggregate !== undefined &&
      typeof aggregate === 'object' && { aggregate: { ...aggregate } }),
  };
}
