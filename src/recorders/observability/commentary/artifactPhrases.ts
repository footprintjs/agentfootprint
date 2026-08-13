/**
 * artifactPhrases — the plain-English vocabulary the artifact / tool-result
 * commentary lines are built from, plus the two size humanizers.
 *
 * Why its own module (and not more branches inside `commentaryTemplates.ts`):
 * these are TRANSLATIONS of library unions (`ArtifactOp`,
 * `ArtifactRefusalReason`, `ArtifactSweepReason`) into words a non-engineer
 * reads. Keeping them here means a new union member is one edit in one place —
 * and the exhaustive `Record<Union, string>` types below make the compiler,
 * not a reviewer, the thing that catches the omission. (`PermissionCapability`
 * taught the repo what two drifting copies of one union cost.)
 *
 * LAW, inherited from the artifact events themselves: META ONLY. These
 * sentences may say how BIG a payload was and what KIND it was; they never
 * carry the payload, a digest, or a raw refusal `detail` string. A ref is an
 * identifier, not prose — it belongs in DETAILS, so no phrase here prints one.
 *
 * Not exported from any barrel: this is prose plumbing for the commentary
 * engine, not public API.
 */

import type { ArtifactOp, ArtifactRefusalReason } from '../../../artifacts/capability.js';
import type { ArtifactSweepReason } from '../../../artifacts/types.js';

/**
 * Humanize a byte count for prose. Deliberately a LOCAL copy of the same
 * three-branch rule `lib/bug-report/build.ts#formatBytes` uses: the commentary
 * engine is a leaf that a viewer bundles on its own, and importing a
 * bug-report module (zip building, manifests) to borrow four lines would drag
 * that whole graph in behind a sentence. The shapes are pinned by tests on
 * both sides.
 */
export function humanizeBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes < 0) return 'an unknown size';
  if (bytes < 1024) return `${Math.round(bytes)} bytes`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

/**
 * Humanize a character count for prose — `tools.result_refused` measures the
 * stringified result in CHARACTERS, not bytes, and saying "bytes" there would
 * be a small lie in the one sentence whose whole job is the true size.
 */
export function humanizeChars(chars: number): string {
  if (!Number.isFinite(chars) || chars < 0) return 'an unknown number of characters';
  const rounded = Math.round(chars);
  return `${rounded.toLocaleString('en-US')} character${rounded === 1 ? '' : 's'}`;
}

/** What was being attempted at the door that refused. Exhaustive by type. */
export const ARTIFACT_OP_PHRASES: Readonly<Record<ArtifactOp, string>> = {
  put: 'checking an artifact in',
  head: 'describing an artifact',
  get: 'reading an artifact',
  delete: 'deleting an artifact',
  list: 'listing the artifacts',
  // Not a store verb — the framework's own door, before a tool runs.
  dispatch: 'delivering an artifact a tool asked for',
};

/** Why the door said no, in a sentence a reader can act on. Exhaustive. */
export const ARTIFACT_REFUSAL_PHRASES: Readonly<Record<ArtifactRefusalReason, string>> = {
  'no-store': 'this agent has no artifact store attached',
  // The API's deliberate ambiguity, kept in the prose: missing, expired and
  // another session's artifact are ONE answer, and pretending to tell them
  // apart here would invent knowledge the event does not carry.
  'missing-or-expired': 'the ticket named nothing this run can still read',
  'unknown-parent': 'it named an earlier artifact the store does not know',
  'digest-mismatch': 'the stored data did not match the checksum the ticket promised',
  'invalid-input': 'the request was not well formed',
  'kind-mismatch': 'the ticket pointed at a different kind of artifact than the tool asked for',
};

/** Why an artifact left the store without its owner asking. Exhaustive. */
export const ARTIFACT_SWEEP_PHRASES: Readonly<Record<ArtifactSweepReason, string>> = {
  ttl: 'because the lifetime stated when it was checked in ran out',
  'max-bytes': 'to keep the store inside its size budget',
  'max-count': 'to keep the store inside its count budget',
};

/**
 * Look a phrase up without ever rendering a blank. An event that arrives with
 * a vocabulary this build does not know (an older or newer emitter) still gets
 * an honest sentence: we say we do not know, rather than printing the raw
 * union member into prose or leaving a hole where the reason should be.
 */
export function phraseFor(
  table: Readonly<Record<string, string>>,
  value: string | undefined,
  fallback: string,
): string {
  if (value === undefined) return fallback;
  return table[value] ?? fallback;
}
