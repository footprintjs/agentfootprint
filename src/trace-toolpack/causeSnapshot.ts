import { createRecordGraph, type RecordScope } from 'foottrace/cause';
import type { StageSnapshot } from 'footprintjs/advanced';
import type { TraceToolpackArtifacts } from './types.js';
import type { TraceCauseArtifacts } from './causeTypes.js';
import {
  assessCapture,
  captureAddress,
  captureAssessment,
  captureOwn as own,
  type SnapshotCapture,
} from './causeCapture.js';
import { capturedControl } from './causeControl.js';

interface SnapshotCauseArtifacts extends TraceCauseArtifacts {
  readonly capture: SnapshotCapture;
}

/** A snapshot projection, not another dependence walker. The public reader owns all graph reasoning. */
export function snapshotCauseArtifacts(
  artifacts: TraceToolpackArtifacts,
  nodes: ReadonlyMap<string, StageSnapshot>,
): SnapshotCauseArtifacts | 'truncated' | undefined {
  const snapshot = artifacts.snapshot;
  // A snapshot-local namespace is not a storage address or a service-correlation claim.
  const recordedAddress = own(snapshot, 'logAddress') as RecordScope['address'] | undefined;
  const runId = own(snapshot, 'runId');
  const address =
    recordedAddress ??
    (typeof runId === 'string' ? { logRunId: `snapshot:${runId}`, drillPath: [] } : undefined);
  if (address === undefined) return undefined;
  const log = own(snapshot, 'commitLog') as RecordScope['commitLog'];
  if (!Array.isArray(log)) return undefined;
  if (log.length > 4096) return 'truncated';
  let capture = assessCapture(snapshot, log.length);
  const nativeControl = capture.status === 'admitted' ? capturedControl(snapshot) : undefined;
  if (capture.status === 'admitted' && nativeControl === undefined)
    capture = captureAssessment('control-not-retained');
  const reads: Record<string, readonly string[]> = Object.create(null);
  const marks: Record<string, unknown> = Object.create(null);
  const control: Record<string, { deciderId: string }> = Object.create(null);
  let visited = 0;
  for (const [id, stage] of nodes) {
    if (visited++ >= 4096) return 'truncated';
    const capturedReads = own(stage, 'stageReads');
    if (capturedReads !== null && typeof capturedReads === 'object')
      reads[id] = Object.keys(capturedReads);
    else if (capture.status === 'admitted') reads[id] = [];
    const attention = own(stage, 'attention');
    if (attention !== undefined) marks[id] = attention;
    const parent = nativeControl === undefined ? artifacts.controlDeps?.(id) : nativeControl[id];
    if (parent !== undefined) control[id] = { deciderId: parent.deciderId };
  }
  if (
    capture.status === 'admitted' &&
    log.some((bundle) => !nodes.has(own(bundle, 'runtimeStageId') as string))
  )
    capture = captureAssessment('projection-incomplete');
  const complete = capture.status === 'admitted';
  const scopeAddress = (complete && captureAddress(own(snapshot, 'logAddress'))) || address;
  const scope: RecordScope = {
    address: scopeAddress,
    commitLog: log,
    reads,
    ...(complete || Object.keys(marks).length
      ? { attention: marks as RecordScope['attention'] }
      : {}),
    ...(nativeControl === undefined && artifacts.controlDeps === undefined
      ? {}
      : { controlDeps: control }),
    complete,
  };
  const graph = createRecordGraph([scope], { maxCommits: 4096 });
  // The public scope reader admits untrusted commits and creates its own official IDs.
  return {
    graph: { ...graph, roots: (context) => graph.openScope(scopeAddress, context) },
    capture,
  };
}
