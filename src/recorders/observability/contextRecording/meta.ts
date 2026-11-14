import type { EventMeta } from '../../../events/types.js';
import { CONSUMER_SCOPE_RUN_ID } from '../../../bridge/eventMeta.js';

const object = (v: unknown): v is Record<string, unknown> =>
  v !== null && typeof v === 'object' && !Array.isArray(v);
const finite = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
const strings = (v: unknown): v is string[] =>
  Array.isArray(v) && v.every((s) => typeof s === 'string');

/** Source coordinates are data supplied by the engine, never parsed from ids. */
export function contextMeta(value: unknown): value is EventMeta {
  if (
    !object(value) ||
    typeof value.runId !== 'string' ||
    value.runId === CONSUMER_SCOPE_RUN_ID ||
    typeof value.runtimeStageId !== 'string' ||
    !strings(value.compositionPath) ||
    !strings(value.subflowPath) ||
    !finite(value.wallClockMs) ||
    !finite(value.runOffsetMs)
  )
    return false;
  for (const key of ['traceId', 'spanId', 'correlationId', 'sessionId', 'principal', 'tenant']) {
    if (value[key] !== undefined && typeof value[key] !== 'string') return false;
  }
  for (const key of ['turnIndex', 'iterIndex']) {
    const field = value[key];
    if (field !== undefined && (!finite(field) || !Number.isSafeInteger(field) || field < 0))
      return false;
  }
  const source = value.sourcePosition;
  return (
    object(source) &&
    typeof source.engineRunId === 'string' &&
    typeof source.logRunId === 'string' &&
    strings(source.drillPath) &&
    finite(source.committedThroughIdx) &&
    Number.isSafeInteger(source.committedThroughIdx) &&
    source.committedThroughIdx >= -1
  );
}
