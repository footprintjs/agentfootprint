import type { EventSourcePosition } from '../events/types.js';

/** Read only an own data property; metadata accessors are not evidence. */
function ownData(value: object, key: PropertyKey): unknown {
  const descriptor = Object.getOwnPropertyDescriptor(value, key);
  return descriptor && 'value' in descriptor ? descriptor.value : undefined;
}

function isRecord(value: unknown): value is object {
  return typeof value === 'object' && value !== null;
}

function isId(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0;
}

/**
 * Project the optional engine carrier into our public event wire vocabulary.
 * Older or unaddressable emitters supply no coordinates. Invalid metadata is
 * likewise unplaced, never repaired using the current executor or stage name.
 * Only the named data fields cross this boundary, detached from their source.
 *
 * @internal
 */
export function projectEventSourcePosition(event: object): EventSourcePosition | undefined {
  try {
    const position = ownData(event, 'sourcePosition');
    if (!isRecord(position)) return undefined;
    const engineRunId = ownData(position, 'runId');
    const logRunId = ownData(position, 'logRunId');
    const path = ownData(position, 'drillPath');
    const committedThroughIdx = ownData(position, 'committedThroughIdx');
    if (
      !isId(engineRunId) ||
      !isId(logRunId) ||
      !Array.isArray(path) ||
      typeof committedThroughIdx !== 'number' ||
      !Number.isSafeInteger(committedThroughIdx) ||
      committedThroughIdx < -1
    ) {
      return undefined;
    }
    const length = ownData(path, 'length');
    if (typeof length !== 'number' || !Number.isSafeInteger(length) || length < 0) return undefined;
    const drillPath: string[] = [];
    for (let i = 0; i < length; i++) {
      const mountId = ownData(path, String(i));
      if (!isId(mountId)) return undefined;
      drillPath.push(mountId);
    }
    return Object.freeze({
      engineRunId,
      logRunId,
      drillPath: Object.freeze(drillPath),
      committedThroughIdx,
    });
  } catch {
    // A hostile/revoked metadata proxy cannot turn an observation into a run failure.
    return undefined;
  }
}
