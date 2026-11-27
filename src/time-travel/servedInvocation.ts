import { isCommitBundle, parseRuntimeStageId, splitStageId, type CommitBundle } from 'foottrace';
import type { StoredReceipt } from '../core/agent/receipt/receipt.js';
import { ownData, readOwnList } from '../lib/boundedJson.js';
import { STAGE_IDS, SUBFLOW_IDS } from '../lib/conventions.js';
import { servedUnderPolicy } from '../redaction/marker.js';
import {
  isCanonicalExecutionKey,
  isName,
  isPlainObject,
  ownValue,
  RECORDING_PARTS_LIMITS,
} from '../recorders/observability/recordingParts/format.js';
import { readLogAddress } from '../recorders/observability/recordingParts/invocations.js';
import type {
  SavedInvocation,
  SavedRecording,
  SavedRecordingPartUnavailable,
  SavedRecordingReadOptions,
} from '../recorders/observability/recordingParts/open.js';
import type { EpochLocation } from './epochs.js';
import { keyedFold, type FoldSourceLike } from './keyedFold.js';
import type { ServedView } from './servedView.js';
import { viewOf } from './servedView/assembly.js';
import { readReceipt } from './servedView/recordReads.js';

/** An exact model call position in the original native invocation log. */
export interface RecordedModelCall {
  readonly engineRunId: string;
  readonly logRunId: string;
  /** The opened recording's relative mount path, outermost first. */
  readonly invocationPath: readonly string[];
  /** The zero-based position in the original full local log, including any mapper commit. */
  readonly commitIdx: number;
  readonly runtimeStageId: string;
}

type UnavailableReason =
  | SavedRecordingPartUnavailable['reason']
  | 'address-mismatch'
  | 'not-model-call'
  | 'unreadable-commit'
  | 'unreadable-receipt';

export type RecordedModelInput =
  | { readonly status: 'ready'; readonly view: ServedView; readonly receipt?: StoredReceipt }
  | { readonly status: 'unavailable'; readonly reason: UnavailableReason };

const unavailable = (reason: UnavailableReason): RecordedModelInput =>
  Object.freeze({ status: 'unavailable', reason });

function addressOf(value: unknown): RecordedModelCall | undefined {
  const limits = RECORDING_PARTS_LIMITS;
  try {
    const { engineRunId, logRunId, invocationPath, commitIdx, runtimeStageId } = ownData(value);
    const path = readOwnList(invocationPath, limits.pathSegments);
    if (
      !isName(engineRunId) ||
      !isName(logRunId) ||
      !path ||
      path.unread > 0 ||
      !path.entries.length ||
      !path.entries.every(isCanonicalExecutionKey) ||
      path.entries.join('').length > limits.pathChars ||
      typeof commitIdx !== 'number' ||
      !Number.isSafeInteger(commitIdx) ||
      commitIdx < 0 ||
      !isCanonicalExecutionKey(runtimeStageId)
    )
      return undefined;
    return { engineRunId, logRunId, invocationPath: path.entries, commitIdx, runtimeStageId };
  } catch {
    return undefined;
  }
}

function samePath(left: unknown, right: readonly string[]): boolean {
  return (
    Array.isArray(left) &&
    left.length === right.length &&
    right.every((key, index) => key === left[index])
  );
}

async function readTree(
  recording: SavedRecording,
  invocation: SavedInvocation,
  root: { readonly logRunId: string; readonly drillPath: readonly string[] },
  options: SavedRecordingReadOptions,
) {
  const acquired = await recording.readInvocation(invocation.key, options);
  if (acquired.status === 'unavailable') return acquired;
  const result = acquired.result;
  const tree = isPlainObject(result) ? ownValue(result, 'treeContext') : undefined;
  if (!isPlainObject(tree)) return { status: 'unavailable', reason: 'unreadable-commit' } as const;
  const log = ownValue(tree, 'history');
  if (!Array.isArray(log)) return { status: 'unavailable', reason: 'unreadable-commit' } as const;
  const scope = readLogAddress(ownValue(tree, 'logAddress'));
  if (
    acquired.invocation.key !== invocation.key ||
    acquired.invocation.subflowId !== invocation.subflowId ||
    !samePath(acquired.invocation.path, invocation.path) ||
    scope?.logRunId !== root.logRunId ||
    !samePath(scope.drillPath, [...root.drillPath, ...invocation.path])
  )
    return { status: 'unavailable', reason: 'address-mismatch' } as const;
  return {
    status: 'ready',
    tree: tree as FoldSourceLike,
    log: log as readonly unknown[],
  } as const;
}

function readLocated(
  address: RecordedModelCall,
  call: { readonly tree: FoldSourceLike; readonly log: readonly CommitBundle[] },
  run: { readonly tree: FoldSourceLike; readonly log: readonly unknown[] },
  groupedMount: string | undefined,
  served: boolean,
): RecordedModelInput {
  if (!run.log.every(isCommitBundle)) return unavailable('unreadable-commit');
  try {
    const fold = keyedFold(call.tree);
    const epoch = fold.valueAt('iteration', address.commitIdx);
    if (typeof epoch !== 'number' || !Number.isSafeInteger(epoch) || epoch < 1)
      return unavailable('unreadable-commit');
    const location: EpochLocation = {
      epoch,
      callRuntimeStageId: address.runtimeStageId,
      log: call.log,
      callIdx: address.commitIdx,
      runLog: run.log,
      source: call.tree,
      runSource: run.tree,
      ...(groupedMount !== undefined && { subflowScope: groupedMount }),
      basis: fold.basis,
      runBasis: keyedFold(run.tree).basis,
      hasRunLog: run.log.length > 0,
    };
    const read = readReceipt(location);
    if (read.cause === 'receipt-shape-rejected') return unavailable('unreadable-receipt');
    if (
      read.receipt !== undefined &&
      (read.receipt.basis.epoch !== epoch || read.receipt.basis.runId !== address.engineRunId)
    )
      return unavailable('unreadable-receipt');
    return Object.freeze({
      status: 'ready',
      view: viewOf(location, served),
      ...(read.receipt !== undefined && { receipt: read.receipt }),
    });
  } catch {
    return unavailable('unreadable-commit');
  }
}

/**
 * Read model input and its original receipt for one exact native child commit.
 * The caller supplies an already authorized recording opened by
 * `openSavedRecording`. A projected display axis must resolve the original
 * commit position before requesting it. No other branch can satisfy the read.
 */
export async function readInvocationModelInput(
  recording: SavedRecording,
  position: RecordedModelCall,
  options: SavedRecordingReadOptions = {},
): Promise<RecordedModelInput> {
  const address = addressOf(position);
  if (!recording.complete || !address || address.engineRunId !== recording.snapshotRunId)
    return unavailable('address-mismatch');
  const mount = recording.invocations.find((invocation) =>
    samePath(invocation.path, address.invocationPath),
  );
  if (!mount?.recorded)
    return unavailable(mount === undefined ? 'address-mismatch' : 'not-recorded');

  const root = await recording.readRoot(options);
  if (root.status === 'unavailable') return unavailable(root.reason);
  const snapshot = root.recording.snapshot;
  if (!isPlainObject(snapshot) || ownValue(snapshot, 'runId') !== address.engineRunId)
    return unavailable('address-mismatch');
  const logAddress = readLogAddress(ownValue(snapshot, 'logAddress'));
  if (logAddress?.logRunId !== address.logRunId) return unavailable('address-mismatch');

  const call = await readTree(recording, mount, logAddress, options);
  if (call.status === 'unavailable') return unavailable(call.reason);
  const commit = call.log[address.commitIdx];
  if (commit === undefined) return unavailable('not-model-call');
  const log = call.log.slice(0, address.commitIdx + 1);
  if (!log.every(isCommitBundle) || !isCommitBundle(commit))
    return unavailable('unreadable-commit');
  if (
    commit.runtimeStageId !== address.runtimeStageId ||
    typeof commit.stageId !== 'string' ||
    splitStageId(commit.stageId).localStageId !== STAGE_IDS.CALL_LLM ||
    log.findIndex((row) => row.runtimeStageId === address.runtimeStageId) !== address.commitIdx
  )
    return unavailable('not-model-call');

  const callSource = { tree: call.tree, log };
  const served = servedUnderPolicy(snapshot);
  if (parseRuntimeStageId(mount.key).stageId !== SUBFLOW_IDS.LLM_CALL)
    return readLocated(address, callSource, call, undefined, served);

  const parentPath = mount.path.slice(0, -1);
  if (!parentPath.length) {
    const rootLog = ownValue(snapshot, 'commitLog');
    if (!Array.isArray(rootLog)) return unavailable('unreadable-commit');
    return readLocated(address, callSource, { tree: snapshot, log: rootLog }, mount.key, served);
  }
  const parent = recording.invocations.find((invocation) => samePath(invocation.path, parentPath));
  if (!parent?.recorded) return unavailable('not-recorded');
  const run = await readTree(recording, parent, logAddress, options);
  if (run.status === 'unavailable') return unavailable(run.reason);
  return readLocated(address, callSource, run, mount.key, served);
}
