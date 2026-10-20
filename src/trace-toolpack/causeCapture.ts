import type { LogAddress } from 'foottrace';

/** Fixed public reasons only; never stringify caller metadata or exceptions. */
export type CaptureReason =
  | 'captured-root-log'
  | 'missing-attestation'
  | 'invalid-attestation'
  | 'run-mismatch'
  | 'scope-not-covered'
  | 'incomplete-extent'
  | 'run-not-completed'
  | 'modes-not-supported'
  | 'channel-not-captured'
  | 'capture-limited'
  | 'control-not-retained'
  | 'projection-incomplete';

export interface SnapshotCapture {
  readonly status: 'admitted' | 'incomplete';
  readonly reason: CaptureReason;
  readonly scope: 'root-log';
  readonly persistence: 'memory-only';
  readonly readSources: 'not-collected';
}

/** Own DATA only. A metadata getter is never a source of captured evidence. */
export function captureOwn(object: unknown, key: string): unknown {
  if (object === null || typeof object !== 'object') return undefined;
  const field = Object.getOwnPropertyDescriptor(object, key);
  if (field === undefined) return undefined;
  if (!('value' in field)) throw new TypeError('cause tools: invalid capture metadata');
  return field.value;
}

export function captureAssessment(reason: CaptureReason): SnapshotCapture {
  return {
    status: reason === 'captured-root-log' ? 'admitted' : 'incomplete',
    reason,
    scope: 'root-log',
    persistence: 'memory-only',
    readSources: 'not-collected',
  };
}

const BASE_LIMITATIONS = new Set([
  'tracked-state-only',
  'final-attempt-views',
  'read-sources-not-collected',
  'child-scopes-not-attested',
  'storage-not-attested',
]);

/** Admit only the native root/current-leg contract. This is not an authenticity or storage check. */
export function assessCapture(snapshot: unknown, commits: number): SnapshotCapture {
  try {
    const note = captureOwn(snapshot, 'capture');
    if (note === undefined) return captureAssessment('missing-attestation');
    if (captureOwn(note, 'version') !== 1 || captureOwn(note, 'persistence') !== 'memory-only')
      return captureAssessment('invalid-attestation');
    const runId = captureOwn(snapshot, 'runId');
    if (
      typeof runId !== 'string' ||
      runId.length === 0 ||
      runId.length > 128 ||
      captureOwn(note, 'runId') !== runId
    )
      return captureAssessment('run-mismatch');
    const address = captureAddress(captureOwn(snapshot, 'logAddress'));
    const covered = captureAddress(captureOwn(note, 'logAddress'));
    if (
      captureOwn(note, 'scope') !== 'root-log' ||
      !address ||
      !covered ||
      address.logRunId !== runId ||
      covered.logRunId !== address.logRunId
    )
      return captureAssessment('scope-not-covered');
    const extent = captureOwn(note, 'commits');
    if (captureOwn(extent, 'from') !== 0 || captureOwn(extent, 'to') !== commits)
      return captureAssessment('incomplete-extent');
    if (captureOwn(captureOwn(note, 'boundary'), 'status') !== 'completed')
      return captureAssessment('run-not-completed');
    const modes = captureOwn(note, 'modes');
    const values = captureOwn(modes, 'commitValues');
    if (
      captureOwn(modes, 'readTracking') !== 'full' ||
      captureOwn(modes, 'writeTracking') !== 'full' ||
      (values !== 'full' && values !== 'delta') ||
      values !== captureOwn(snapshot, 'commitValues') ||
      captureOwn(modes, 'writeProvenance') !== 'reads-prefix' ||
      captureOwn(snapshot, 'writeProvenance') !== 'reads-prefix'
    )
      return captureAssessment('modes-not-supported');
    const channels = captureOwn(note, 'channels');
    if (
      !['reads', 'writes', 'attention', 'control'].every(
        (channel) => captureOwn(channels, channel) === 'captured',
      ) ||
      captureOwn(channels, 'readSources') !== 'not-collected'
    )
      return captureAssessment('channel-not-captured');
    const limits = captureOwn(note, 'limitations');
    if (!Array.isArray(limits) || limits.length !== BASE_LIMITATIONS.size)
      return captureAssessment('capture-limited');
    const seen = new Set<unknown>();
    for (let index = 0; index < limits.length; index++) {
      const limit = captureOwn(limits, String(index));
      if (typeof limit !== 'string' || !BASE_LIMITATIONS.has(limit) || seen.has(limit))
        return captureAssessment('capture-limited');
      seen.add(limit);
    }
    return captureAssessment('captured-root-log');
  } catch {
    return captureAssessment('invalid-attestation');
  }
}

/** Root notes never authorize a child address, or a synthetic snapshot namespace. */
export function captureAddress(value: unknown): LogAddress | undefined {
  const logRunId = captureOwn(value, 'logRunId');
  const path = captureOwn(value, 'drillPath');
  return typeof logRunId === 'string' &&
    logRunId.length > 0 &&
    logRunId.length <= 128 &&
    Array.isArray(path) &&
    path.length === 0
    ? { logRunId, drillPath: [] }
    : undefined;
}
