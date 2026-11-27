import type { StageSnapshot } from 'footprintjs/advanced';
import type { SourceLinkPolicy } from 'foottrace/cause';
import { sourceLinkGrantOfSnapshot } from '../redaction/sourceLinkPolicy.js';
import type { TraceToolpackArtifacts } from './types.js';
import { projectCauseBasis } from './causeProjection.js';

/** Preserve the existing in-memory projection through the shared narrow basis. */
export function snapshotCauseArtifacts(
  artifacts: TraceToolpackArtifacts,
  nodes: ReadonlyMap<string, StageSnapshot>,
) {
  const candidate = Object.getOwnPropertyDescriptor(artifacts, 'sourceLinkPolicy')?.value;
  const host = typeof candidate === 'function' ? (candidate as SourceLinkPolicy) : undefined;
  const native = sourceLinkGrantOfSnapshot(artifacts.snapshot);
  const sourceLinkPolicy: SourceLinkPolicy | undefined =
    native !== undefined && host !== undefined
      ? (locator, context) => native(locator, context) && host(locator, context)
      : native ?? host;
  return projectCauseBasis(artifacts.snapshot, nodes, () => artifacts.controlDeps, {
    ...(typeof sourceLinkPolicy === 'function' && { sourceLinkPolicy }),
  });
}
