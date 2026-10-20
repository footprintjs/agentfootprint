import type { GapCode } from 'foottrace/cause';
import type { TraceCauseOperation } from './causeTypes.js';
import type { CaptureReason, SnapshotCapture } from './causeCapture.js';

const SNAPSHOT_LIMITATION =
  'Snapshot-only records have no engine-written capture/end attestation. This reader cannot prove a root cause from them, even after a normally finished run.';

const CAPTURE_REASONS: Record<CaptureReason, string> = {
  'captured-root-log':
    'Capture covers this in-memory root log only; exact read versions, child scopes and durable delivery remain unproven.',
  'missing-attestation': SNAPSHOT_LIMITATION,
  'invalid-attestation': 'The capture note is invalid or unsupported.',
  'run-mismatch': 'The capture note does not identify the run that call inspected.',
  'scope-not-covered': 'The capture note does not cover this log scope.',
  'incomplete-extent': 'The capture note does not cover the full queried log segment.',
  'run-not-completed': 'The capture note does not attest a completed run.',
  'modes-not-supported':
    'The recording modes do not retain the required full views and per-write provenance.',
  'channel-not-captured': 'At least one required evidence channel was not fully captured.',
  'capture-limited': 'The capture note lists additional or unsupported limitations.',
  'control-not-retained':
    'Same-run captured control-dependency data is missing, partial or ambiguous.',
  'projection-incomplete': 'The execution-tree projection is missing a committed step.',
};

function interpretationFor(text: string, capture?: SnapshotCapture | true): string {
  return capture
    ? `${text} ${
        capture === true
          ? 'The capture/end attestation was not inspected. No completeness claim is made.'
          : CAPTURE_REASONS[capture.reason]
      }`
    : text;
}

/** Fixed wording: no exception messages, state values or provider payloads cross this boundary. */
export function causeGap(
  tool: TraceCauseOperation,
  code: GapCode,
  capture?: SnapshotCapture | true,
): string {
  return JSON.stringify({
    tool,
    mode: 'recorded-evidence',
    confidence: 'incomplete',
    gaps: [{ code, evidence: [] }],
    ...(capture && capture !== true ? { capture } : {}),
    interpretation: interpretationFor(
      'Not sure: the requested evidence is incomplete. No root cause is asserted.',
      capture,
    ),
  });
}

/** A clipped proof must never leave behind a seemingly supported root or apparently complete empty list. */
export function causeResponse(
  tool: TraceCauseOperation,
  finding: unknown,
  interpretation: string,
  maxChars: number,
  capture?: SnapshotCapture | true,
): string {
  const text = JSON.stringify({
    tool,
    mode: 'recorded-evidence',
    finding,
    ...(capture && capture !== true ? { capture } : {}),
    interpretation: interpretationFor(interpretation, capture),
  });
  return text.length <= maxChars ? text : causeGap(tool, 'truncated', capture);
}
