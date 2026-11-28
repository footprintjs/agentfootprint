import type { LogAddress } from 'foottrace';

import { isPlainObject, ownValue } from '../../../recorders/observability/recordingParts/format.js';
import { readLogAddress } from '../../../recorders/observability/recordingParts/invocations.js';

export interface CompletedTurnTarget {
  readonly id: string;
  readonly address: LogAddress;
  readonly relativePath: readonly string[];
}

export interface CompletedTurnChild {
  readonly mount: string;
  readonly address: LogAddress;
  readonly result: Readonly<Record<string, unknown>>;
}

function withinLog(address: LogAddress, root: LogAddress): boolean {
  return (
    address.logRunId === root.logRunId &&
    address.drillPath.length >= root.drillPath.length &&
    root.drillPath.every((segment, index) => segment === address.drillPath[index])
  );
}

export function sameCompletedLog(candidate: unknown, expected: LogAddress): boolean {
  const address = readLogAddress(candidate);
  return (
    address !== undefined &&
    address.drillPath.length === expected.drillPath.length &&
    withinLog(address, expected)
  );
}

/** Hold the caller's own data before any authorization or store await. */
export function completedTurnTarget(
  value: unknown,
  runId: string,
  root: LogAddress,
): CompletedTurnTarget | undefined {
  if (!isPlainObject(value) || ownValue(value, 'runId') !== runId) return undefined;
  const id = ownValue(value, 'id');
  const address = readLogAddress(ownValue(value, 'logAddress'));
  if (
    typeof id !== 'string' ||
    id.length === 0 ||
    address === undefined ||
    !withinLog(address, root)
  )
    return undefined;
  return { id, address, relativePath: address.drillPath.slice(root.drillPath.length) };
}

export function retainedChildResult(snapshot: unknown, mount: string): unknown {
  const results = isPlainObject(snapshot) ? ownValue(snapshot, 'subflowResults') : undefined;
  return isPlainObject(results) ? ownValue(results, mount) : undefined;
}

/** The map key selects a result. Its own native address proves the full path. */
export function completedTurnChild(
  result: unknown,
  mount: string,
  address: LogAddress,
): CompletedTurnChild | undefined {
  if (!isPlainObject(result)) return undefined;
  const context = ownValue(result, 'treeContext');
  if (!isPlainObject(context) || !sameCompletedLog(ownValue(context, 'logAddress'), address))
    return undefined;
  return { mount, address, result };
}
