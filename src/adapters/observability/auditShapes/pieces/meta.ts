import type { BoundRule } from '../../auditBounding.js';
import type { EventMeta, EventSourcePosition } from '../../../../events/types.js';
import { listOf, num, shapeOf, str } from '../../auditBounding.js';
import { metaIdentity } from '../../auditKeptByContract.js';

/**
 * Each record's meta: the run and stage ids, paths, indices and engine
 * coordinates the dispatcher stamps — and the who the caller named
 * (`sessionId`, `principal`, `tenant`), kept by contract. A field `EventMeta`
 * does not declare, or a value of another kind, is a marker. (`wallClockMs` is
 * the record's `timestamp`; `runId` its run anchor — `audit.ts` lifts both.)
 */
export const boundMeta: BoundRule = shapeOf<EventMeta>({
  wallClockMs: num,
  runOffsetMs: num,
  sourcePosition: shapeOf<EventSourcePosition>({
    engineRunId: str,
    logRunId: str,
    drillPath: listOf(str),
    committedThroughIdx: num,
  }),
  runtimeStageId: str,
  subflowPath: listOf(str),
  compositionPath: listOf(str),
  turnIndex: num,
  iterIndex: num,
  traceId: str,
  spanId: str,
  correlationId: str,
  runId: str,
  sessionId: metaIdentity,
  principal: metaIdentity,
  tenant: metaIdentity,
});
