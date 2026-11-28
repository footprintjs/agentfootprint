/**
 * recordingParts/invocations — which invocations a recorded snapshot holds,
 * in the order the lazy viewer lists them.
 *
 * Role:  Fold. One walk over a parsed snapshot's execution tree and its
 *        `subflowResults`; returns addresses and the results they name.
 * Reads: its argument (plain JSON data).
 * Emits: N/A.
 *
 * ── Why the walk lives here AND in the viewer ───────────────────────────────
 * A nested invocation's address is found inside its PARENT's result
 * (`treeContext.stageContexts`), so an index written without the results must
 * carry every address. This walk mirrors the viewer package's
 * `recordingSourceCodec/nativeIndex.ts` (its `scopeMounts` and
 * `indexNativeRecording`): the same stack order (`next` is visited before
 * `children`, children in their own order), the same depth-first descent into
 * each mount's result, the same canonical execution keys and the same unit
 * shape. Where the viewer refuses a whole recording, this walk keeps what it
 * can address and says `complete: false`, so no recorded result is lost and
 * the reader can answer the viewer's own refusal. The two copies are
 * cross-checked by the host application's test against the viewer's
 * projection; moving the viewer onto this walk is a separate change.
 */

import { isExecutionKey } from 'foottrace';
import {
  RECORDING_PARTS_LIMITS,
  isCanonicalExecutionKey,
  isName,
  isPlainObject,
  ownValue,
} from './format.js';
import { RecordingSplitError } from './splitError.js';

/** One invocation the tree mounts. `result` is absent when none was recorded. */
export interface WalkedInvocation {
  readonly key: string;
  readonly path: readonly string[];
  readonly subflowId: string;
  readonly result?: unknown;
}

/** What one snapshot holds, addressed. */
export interface RecordingWalk {
  readonly invocations: readonly WalkedInvocation[];
  /** Execution-key results no mount reaches, in `subflowResults` order. */
  readonly unmounted: readonly { readonly key: string; readonly result: unknown }[];
  /** Every other `subflowResults` key (path aliases), in order. */
  readonly aliases: readonly { readonly name: string; readonly value: unknown }[];
  readonly complete: boolean;
  readonly hasSubflowResults: boolean;
  readonly snapshotRunId?: string;
}

interface LogAddress {
  readonly logRunId: string;
  readonly drillPath: readonly string[];
}

/**
 * Walk a parsed snapshot. `snapshot` is `undefined` or not an object when the
 * recording has none; it then holds no invocations.
 *
 * @throws RecordingSplitError (`over-limit`) past the index bounds, which the
 *   viewer would refuse as too large too.
 */
export function walkRecordedInvocations(snapshot: unknown): RecordingWalk {
  const limits = RECORDING_PARTS_LIMITS;
  if (!isPlainObject(snapshot)) {
    // Nothing to address — and the lazy viewer refuses a recording with no snapshot.
    return {
      invocations: [],
      unmounted: [],
      aliases: [],
      complete: false,
      hasSubflowResults: false,
    };
  }
  let complete = true;
  let visits = 0;
  const spend = (): void => {
    if (++visits > limits.visits) throw new RecordingSplitError('over-limit', 'tree');
  };

  const rawResults = ownValue(snapshot, 'subflowResults');
  const hasSubflowResults = rawResults !== undefined;
  if (hasSubflowResults && !isPlainObject(rawResults)) {
    throw new RecordingSplitError('not-a-recording');
  }
  const units = new Map<string, unknown>();
  const aliases: { name: string; value: unknown }[] = [];
  if (isPlainObject(rawResults)) {
    for (const key of Object.keys(rawResults)) {
      spend();
      // An empty key is a malformed recording; only a long one is a bound.
      if (key.length === 0) throw new RecordingSplitError('not-a-recording');
      if (!isName(key)) throw new RecordingSplitError('over-limit', 'name');
      const value = ownValue(rawResults, key);
      if (isCanonicalExecutionKey(key)) units.set(key, value);
      else {
        // A key spelled like an execution but not canonical: the viewer refuses the whole.
        if (isExecutionKey(key)) complete = false;
        aliases.push({ name: key, value });
      }
    }
  }

  const rawRunId = ownValue(snapshot, 'runId');
  const snapshotRunId = isName(rawRunId) ? rawRunId : undefined;
  if (rawRunId !== undefined && snapshotRunId === undefined) complete = false;
  const rootAddress = readLogAddress(ownValue(snapshot, 'logAddress'));
  if (ownValue(snapshot, 'logAddress') !== undefined && rootAddress === undefined) complete = false;
  if (ownValue(snapshot, 'executionTree') === undefined) complete = false;

  const invocations: WalkedInvocation[] = [];
  const mounted = new Set<string>();

  const mountsOf = (tree: unknown): { key: string; subflowId: string }[] => {
    const out: { key: string; subflowId: string }[] = [];
    const pending: unknown[] = tree === null || tree === undefined ? [] : [tree];
    const seen = new Set<string>();
    while (pending.length > 0) {
      spend();
      const node = pending.pop();
      if (!isPlainObject(node)) {
        complete = false;
        continue;
      }
      const subflow = ownValue(node, 'subflowId');
      if (subflow !== undefined) {
        const key = ownValue(node, 'runtimeStageId');
        if (!isName(subflow) || !isCanonicalExecutionKey(key) || seen.has(key)) complete = false;
        else {
          seen.add(key);
          out.push({ key, subflowId: subflow });
        }
      }
      const children = ownValue(node, 'children');
      if (children !== undefined && children !== null) {
        if (!Array.isArray(children)) complete = false;
        else {
          if (children.length > limits.visits) throw new RecordingSplitError('over-limit', 'tree');
          for (let i = children.length - 1; i >= 0; i--) pending.push(children[i]);
        }
      }
      const next = ownValue(node, 'next');
      if (next !== undefined && next !== null) pending.push(next);
    }
    return out;
  };

  const walk = (tree: unknown, ancestors: readonly string[]): void => {
    for (const mount of mountsOf(tree)) {
      const path = [...ancestors, mount.key];
      const chars = path.reduce((sum, segment) => sum + segment.length, 0);
      if (path.length > limits.pathSegments || chars > limits.pathChars) {
        throw new RecordingSplitError('over-limit', 'path');
      }
      if (mounted.has(mount.key)) {
        complete = false;
        continue;
      }
      mounted.add(mount.key);
      if (invocations.length >= limits.invocations) {
        throw new RecordingSplitError('over-limit', 'invocations');
      }
      if (!units.has(mount.key)) {
        complete = false;
        invocations.push({ key: mount.key, path, subflowId: mount.subflowId });
        continue;
      }
      const result = units.get(mount.key);
      if (!unitConforms(result, mount.subflowId, path, rootAddress)) complete = false;
      invocations.push({ key: mount.key, path, subflowId: mount.subflowId, result });
      const context = isPlainObject(result) ? ownValue(result, 'treeContext') : undefined;
      const inner = isPlainObject(context) ? ownValue(context, 'stageContexts') : undefined;
      if (isPlainObject(inner)) walk(inner, path);
    }
  };
  walk(ownValue(snapshot, 'executionTree'), []);

  const unmounted: { key: string; result: unknown }[] = [];
  for (const [key, result] of units) {
    if (!mounted.has(key)) unmounted.push({ key, result });
  }
  if (unmounted.length > 0) complete = false;
  if (invocations.length + unmounted.length > limits.invocations) {
    throw new RecordingSplitError('over-limit', 'invocations');
  }
  return {
    invocations,
    unmounted,
    aliases,
    complete,
    hasSubflowResults,
    ...(snapshotRunId !== undefined && { snapshotRunId }),
  };
}

export function readLogAddress(value: unknown): LogAddress | undefined {
  if (!isPlainObject(value)) return undefined;
  const logRunId = ownValue(value, 'logRunId');
  const drillPath = ownValue(value, 'drillPath');
  if (!isName(logRunId) || !Array.isArray(drillPath)) return undefined;
  if (!drillPath.every((segment) => isCanonicalExecutionKey(segment))) return undefined;
  if (!withinPathBounds(drillPath as string[])) return undefined;
  return { logRunId, drillPath: drillPath as string[] };
}

/** The viewer's path bounds: at most 128 segments and 8,192 characters. */
function withinPathBounds(path: readonly string[]): boolean {
  const chars = path.reduce((sum, segment) => sum + segment.length, 0);
  return (
    path.length <= RECORDING_PARTS_LIMITS.pathSegments && chars <= RECORDING_PARTS_LIMITS.pathChars
  );
}

/** The unit shape the viewer admits for one mount (its `completeUnit`). */
function unitConforms(
  result: unknown,
  subflowId: string,
  path: readonly string[],
  rootAddress: LogAddress | undefined,
): boolean {
  if (!isPlainObject(result) || ownValue(result, 'subflowId') !== subflowId) return false;
  if (!isName(ownValue(result, 'subflowName')) || !isName(ownValue(result, 'parentStageId'))) {
    return false;
  }
  const context = ownValue(result, 'treeContext');
  if (!isPlainObject(context)) return false;
  if (!isPlainObject(ownValue(context, 'globalContext'))) return false;
  if (!isPlainObject(ownValue(context, 'stageContexts'))) return false;
  if (!Array.isArray(ownValue(context, 'history'))) return false;
  const rawAddress = ownValue(context, 'logAddress');
  if (rawAddress === undefined) return true;
  const address = readLogAddress(rawAddress);
  if (address === undefined) return false;
  // Both drill paths are bounded where they are read (`readLogAddress`), so an
  // expected path past the viewer's bound can never equal the unit's own.
  const expected = [...(rootAddress?.drillPath ?? []), ...path];
  if (address.drillPath.length !== expected.length) return false;
  if (address.drillPath.some((segment, i) => segment !== expected[i])) return false;
  return rootAddress === undefined || address.logRunId === rootAddress.logRunId;
}
