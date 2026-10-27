import type { StageSnapshot } from 'footprintjs/advanced';
import type { TraceToolpackArtifacts } from './types.js';
import { projectCauseBasis } from './causeProjection.js';

/** Preserve the existing in-memory projection through the shared narrow basis. */
export function snapshotCauseArtifacts(
  artifacts: TraceToolpackArtifacts,
  nodes: ReadonlyMap<string, StageSnapshot>,
) {
  return projectCauseBasis(artifacts.snapshot, nodes, () => artifacts.controlDeps);
}
