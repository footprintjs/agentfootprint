import { createRecordGraph, type RecordScope } from 'foottrace/cause';
import type { StageSnapshot } from 'footprintjs/advanced';
import type { TraceToolpackArtifacts } from './types.js';
import type { TraceCauseArtifacts } from './causeTypes.js';

function own(object: object, key: string): unknown {
  const field = Object.getOwnPropertyDescriptor(object, key);
  if (field === undefined) return undefined;
  if (!('value' in field)) throw new TypeError('cause tools: invalid snapshot metadata');
  return field.value;
}

/** A snapshot projection, not another dependence walker. The public reader owns all graph reasoning. */
export function snapshotCauseArtifacts(
  artifacts: TraceToolpackArtifacts,
  nodes: ReadonlyMap<string, StageSnapshot>,
): TraceCauseArtifacts | 'truncated' | undefined {
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
  const reads: Record<string, readonly string[]> = Object.create(null);
  const marks: Record<string, unknown> = Object.create(null);
  const control: Record<string, { deciderId: string }> = Object.create(null);
  let visited = 0;
  for (const [id, stage] of nodes) {
    if (visited++ >= 4096) return 'truncated';
    const capturedReads = own(stage, 'stageReads');
    if (capturedReads !== null && typeof capturedReads === 'object')
      reads[id] = Object.keys(capturedReads);
    const attention = own(stage, 'attention');
    if (attention !== undefined) marks[id] = attention;
    const parent = artifacts.controlDeps?.(id);
    if (parent !== undefined) control[id] = { deciderId: parent.deciderId };
  }
  const scope: RecordScope = {
    address,
    commitLog: log,
    reads,
    ...(Object.keys(marks).length ? { attention: marks as RecordScope['attention'] } : {}),
    ...(artifacts.controlDeps === undefined ? {} : { controlDeps: control }),
    // The artifact bag has no capture/end-marker attestation. Sparse marks do not attest healthy steps.
    complete: false,
  };
  const graph = createRecordGraph([scope], { maxCommits: 4096 });
  // The public scope reader admits untrusted commits and creates its own official IDs.
  return { graph: { ...graph, roots: (context) => graph.openScope(address, context) } };
}
