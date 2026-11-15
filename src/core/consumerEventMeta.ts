/** Format consumer-scope metadata; the owning runner supplies its clock and ancestry. */
import type { EventMeta } from '../events/types.js';
import { CONSUMER_SCOPE_RUN_ID } from '../bridge/eventMeta.js';

export function consumerEventMeta(now: number, compositionPath: readonly string[]): EventMeta {
  return {
    wallClockMs: now,
    runOffsetMs: 0,
    runtimeStageId: 'consumer-emit#0',
    subflowPath: [],
    compositionPath,
    runId: CONSUMER_SCOPE_RUN_ID,
  };
}
