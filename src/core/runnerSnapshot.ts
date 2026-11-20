import type { RunView } from 'footprintjs';
import { keepSnapshotSourceLinkGrant } from '../redaction/sourceLinkPolicy.js';
import {
  createContextShapeCapture,
  markNativeShapeSource,
  type ContextShapeIndex,
  type ContextShapeOptions,
} from '../recorders/observability/contextShapes.js';
import type { RunnerCoreValues } from './runnerCoreValues.js';
import type { RunnerSelection } from './runnerExecution.js';

export interface RunnerSnapshotOptions {
  /** Include cheap value descriptions by default. Pass false to omit them or register nested paths. */
  readonly contextShapes?: ContextShapeOptions | false;
}

export type ServedRunnerSnapshot = ReturnType<RunView['snapshot']> & {
  readonly contextShapes?: ContextShapeIndex;
};

/** Live reads use the same capture as saved recordings, after the native serving policy. */
export function createRunnerSnapshotReader() {
  let defaults: ReturnType<typeof createContextShapeCapture> | undefined;
  const configured = new WeakMap<
    ContextShapeOptions,
    ReturnType<typeof createContextShapeCapture>
  >();
  return (
    selected: RunnerSelection<RunnerCoreValues> | undefined,
    options?: RunnerSnapshotOptions,
  ): ServedRunnerSnapshot | undefined => {
    const redaction = selected?.value.redaction;
    const coverage = redaction?.coverage?.state;
    if (!selected || (coverage !== 'covered' && coverage !== 'declared-none')) return undefined;
    const redact = coverage === 'covered' || redaction?.recordPolicy !== undefined;
    const snapshot = redact ? selected.view.snapshot({ redact: true }) : selected.view.snapshot();
    markNativeShapeSource(snapshot);
    if (snapshot === undefined) return undefined;
    const grant =
      snapshot.logAddress === undefined
        ? undefined
        : redaction?.sourceLinkPolicy(snapshot.logAddress);
    const shapes = options?.contextShapes;
    if (shapes === false) return keepSnapshotSourceLinkGrant(snapshot, grant);
    if (shapes === undefined)
      return keepSnapshotSourceLinkGrant(
        (defaults ??= createContextShapeCapture())(snapshot),
        grant,
      );
    let capture = configured.get(shapes);
    if (!capture) {
      capture = createContextShapeCapture(shapes);
      configured.set(shapes, capture);
    }
    return keepSnapshotSourceLinkGrant(capture(snapshot), grant);
  };
}
