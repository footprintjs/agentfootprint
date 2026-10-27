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

export type SourceCaptureStatus = 'captured' | 'partial' | 'failed' | 'unknown';

export interface SnapshotCapture {
  readonly status: 'admitted' | 'incomplete';
  readonly reason: CaptureReason;
  readonly scope: 'root-log';
  readonly persistence: 'memory-only';
  readonly readSources: 'not-collected' | SourceCaptureStatus;
}

/** Own DATA only. A metadata getter is never a source of captured evidence. */
export function captureOwn(object: unknown, key: string): unknown {
  if (object === null || typeof object !== 'object') return undefined;
  const field = Object.getOwnPropertyDescriptor(object, key);
  if (field === undefined) return undefined;
  if (!('value' in field)) throw new TypeError('cause tools: invalid capture metadata');
  return field.value;
}

export function captureAssessment(
  reason: CaptureReason,
  readSources: SnapshotCapture['readSources'] = 'not-collected',
): SnapshotCapture {
  return {
    status: reason === 'captured-root-log' ? 'admitted' : 'incomplete',
    reason,
    scope: 'root-log',
    persistence: 'memory-only',
    readSources,
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
  return assessCapturePolicy(snapshot, commits, 'not-collected');
}

/** Saved-only: the public producer reader has separately admitted source ownership. */
export function assessSourceCapture(
  snapshot: unknown,
  commits: number,
  sources: SourceCaptureStatus,
): SnapshotCapture {
  return assessCapturePolicy(snapshot, commits, sources);
}

function assessCapturePolicy(
  snapshot: unknown,
  commits: number,
  sources: SnapshotCapture['readSources'],
): SnapshotCapture {
  const assessment = (reason: CaptureReason) => captureAssessment(reason, sources);
  const exact = sources !== 'not-collected';
  try {
    const note = captureOwn(snapshot, 'capture');
    if (note === undefined) return assessment('missing-attestation');
    if (
      captureOwn(note, 'version') !== (exact ? 2 : 1) ||
      captureOwn(note, 'persistence') !== 'memory-only'
    )
      return assessment('invalid-attestation');
    const runId = captureOwn(snapshot, 'runId');
    if (
      typeof runId !== 'string' ||
      runId.length === 0 ||
      runId.length > 128 ||
      captureOwn(note, 'runId') !== runId
    )
      return assessment('run-mismatch');
    const address = captureAddress(captureOwn(snapshot, 'logAddress'));
    const covered = captureAddress(captureOwn(note, 'logAddress'));
    if (
      captureOwn(note, 'scope') !== 'root-log' ||
      !address ||
      !covered ||
      address.logRunId !== runId ||
      covered.logRunId !== address.logRunId
    )
      return assessment('scope-not-covered');
    const extent = captureOwn(note, 'commits');
    if (captureOwn(extent, 'from') !== 0 || captureOwn(extent, 'to') !== commits)
      return assessment('incomplete-extent');
    if (captureOwn(captureOwn(note, 'boundary'), 'status') !== 'completed')
      return assessment('run-not-completed');
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
      return assessment('modes-not-supported');
    const channels = captureOwn(note, 'channels');
    if (
      !['reads', 'writes', 'attention', 'control'].every(
        (channel) => captureOwn(channels, channel) === 'captured',
      ) ||
      captureOwn(channels, 'readSources') !== sources ||
      (exact && sources !== 'captured')
    )
      return assessment('channel-not-captured');
    const limits = captureOwn(note, 'limitations');
    const expected = exact
      ? new Set([...BASE_LIMITATIONS].filter((limit) => limit !== 'read-sources-not-collected'))
      : BASE_LIMITATIONS;
    if (!Array.isArray(limits) || limits.length !== expected.size)
      return assessment('capture-limited');
    const seen = new Set<unknown>();
    for (let index = 0; index < limits.length; index++) {
      const limit = captureOwn(limits, String(index));
      if (typeof limit !== 'string' || !expected.has(limit) || seen.has(limit))
        return assessment('capture-limited');
      seen.add(limit);
    }
    return assessment('captured-root-log');
  } catch {
    return assessment('invalid-attestation');
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
