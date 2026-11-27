/**
 * THE ORACLE — an independent copy of the lazy viewer's invocation walk, kept
 * in the test tree only.
 *
 * Ported from the published viewer package (agentfootprint-lens 0.89.0,
 * `src/core/recordingSourceCodec/nativeIndex.ts`: `scopeMounts`,
 * `indexNativeRecording`, `completeUnit`, `strippedRoot`), written here
 * without sharing a line with `src/recorders/observability/recordingParts/`,
 * so the reader's order and refusals are checked against the viewer's rule
 * rather than against themselves. It refuses where the viewer refuses, with
 * the viewer's reason. The host application's own test checks the published
 * package directly.
 */
import { buildRuntimeStageId, isExecutionKey, parseRuntimeStageId } from 'foottrace';

type Rec = Record<string, unknown>;
export class ViewerRefusal extends Error {}

function record(value: unknown): Rec {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new ViewerRefusal('invalid-recording');
  }
  return value as Rec;
}

function runtime(value: unknown, reason: string): string {
  if (typeof value !== 'string' || value.length === 0 || !isExecutionKey(value)) {
    throw new ViewerRefusal(reason);
  }
  const parsed = parseRuntimeStageId(value);
  if (
    !parsed.stageId ||
    buildRuntimeStageId(parsed.stageId, parsed.executionIndex, parsed.subflowPath) !== value
  ) {
    throw new ViewerRefusal(reason);
  }
  return value;
}

function scopeMounts(tree: Rec | null): { runtimeStageId: string; subflowId: string }[] {
  const pending: unknown[] = tree === null ? [] : [tree];
  const mounts = new Set<string>();
  const output: { runtimeStageId: string; subflowId: string }[] = [];
  while (pending.length) {
    const node = record(pending.pop());
    if (node.subflowId !== undefined) {
      if (typeof node.subflowId !== 'string' || !node.subflowId) {
        throw new ViewerRefusal('invalid-recording');
      }
      const id = runtime(node.runtimeStageId, 'unsupported-recording');
      if (mounts.has(id)) throw new ViewerRefusal('ambiguous-invocation');
      mounts.add(id);
      output.push({ runtimeStageId: id, subflowId: node.subflowId });
    }
    const children = node.children;
    if (children !== undefined && children !== null) {
      if (!Array.isArray(children)) throw new ViewerRefusal('invalid-recording');
      for (let i = children.length - 1; i >= 0; i--) pending.push(children[i]);
    }
    if (node.next !== undefined && node.next !== null) pending.push(node.next);
  }
  return output;
}

function completeUnit(value: unknown, subflowId: string, path: string[], root?: Rec): Rec {
  const result = record(value);
  if (result.subflowId !== subflowId) throw new ViewerRefusal('invalid-recording');
  for (const key of ['subflowName', 'parentStageId']) {
    if (typeof result[key] !== 'string' || !(result[key] as string).length) {
      throw new ViewerRefusal('unsupported-recording');
    }
  }
  const context = record(result.treeContext);
  record(context.globalContext);
  record(context.stageContexts);
  if (!Array.isArray(context.history)) throw new ViewerRefusal('unsupported-recording');
  if (context.logAddress !== undefined) {
    const address = record(context.logAddress);
    const expected = [...((root?.drillPath as string[] | undefined) ?? []), ...path];
    const drill = address.drillPath as string[];
    if (
      drill.length !== expected.length ||
      drill.some((part, i) => part !== expected[i]) ||
      (root !== undefined && address.logRunId !== root.logRunId)
    ) {
      throw new ViewerRefusal('invalid-recording');
    }
  }
  return result;
}

export interface ViewerInvocation {
  readonly invocationPath: string[];
  readonly mountRuntimeStageId: string;
  readonly subflowId: string;
  readonly runId?: string;
}

/** The viewer's projection of a whole recording: its root DTO and each child unit. */
export function viewerProjection(input: unknown): {
  readonly root: { schema: string; recording: Rec; invocations: ViewerInvocation[] };
  readonly units: Map<string, Rec>;
} {
  const recording = record(input);
  const snapshot = record(recording.snapshot);
  if (snapshot.executionTree === undefined) throw new ViewerRefusal('unsupported-recording');
  const tree = snapshot.executionTree === null ? null : record(snapshot.executionTree);
  const runId = snapshot.runId as string | undefined;
  const logAddress = snapshot.logAddress === undefined ? undefined : record(snapshot.logAddress);
  const map = new Map<string, unknown>();
  const source =
    snapshot.subflowResults === undefined ? undefined : record(snapshot.subflowResults);
  if (source) {
    for (const [key, value] of Object.entries(source)) {
      if (isExecutionKey(key)) map.set(runtime(key, 'invalid-recording'), value);
    }
  }
  const invocations: ViewerInvocation[] = [];
  const units = new Map<string, Rec>();
  const mounted = new Set<string>();
  const walk = (scope: Rec | null, ancestors: string[]): void => {
    for (const mount of scopeMounts(scope)) {
      const path = [...ancestors, mount.runtimeStageId];
      if (mounted.has(mount.runtimeStageId)) throw new ViewerRefusal('ambiguous-invocation');
      mounted.add(mount.runtimeStageId);
      const raw = map.get(mount.runtimeStageId);
      if (raw === undefined) throw new ViewerRefusal('unsupported-recording');
      const unit = completeUnit(raw, mount.subflowId, path, logAddress);
      invocations.push({
        invocationPath: path,
        mountRuntimeStageId: mount.runtimeStageId,
        subflowId: mount.subflowId,
        ...(runId === undefined ? {} : { runId }),
      });
      units.set(mount.runtimeStageId, unit);
      walk(record(record(unit.treeContext).stageContexts), path);
    }
  };
  walk(tree, []);
  if ([...map.keys()].some((key) => !mounted.has(key))) {
    throw new ViewerRefusal('invocation-not-recorded');
  }
  const stripped: Rec = {};
  for (const [key, value] of Object.entries(snapshot)) {
    if (key !== 'subflowResults') stripped[key] = value;
  }
  return {
    root: {
      schema: 'agentfootprint-lens.recording-source/v1',
      recording: { ...recording, snapshot: stripped },
      invocations,
    },
    units,
  };
}
