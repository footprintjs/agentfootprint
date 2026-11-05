import type { FlowchartCheckpoint } from 'footprintjs';
import type { FixedPauseReason } from '../events/payloads.js';
import { parseSubflowPath } from '../bridge/eventMeta.js';

/** The reason a pause request names when its pause carries none — typed, so a
 *  redacted record keeps it as the library's own words (`FixedPauseReason`). */
export const DEFAULT_PAUSE_REASON: FixedPauseReason = 'stage requested pause';

/**
 * Where a pause happened, as the SEGMENT list every other event carries
 * (`buildEventMeta`) — so a reader finds the owner of `pause.request` and
 * `pause.resume` the way it finds every event's. The checkpoint's own list is
 * footprintjs's resume cursor, one cumulative mount id per level
 * (`['step-p', 'step-p/x']`); its last entry names the whole path.
 */
export function pauseSegments(checkpoint: FlowchartCheckpoint): readonly string[] {
  // Read defensively: `resume()` builds `pause.resume` BEFORE the engine
  // validates the checkpoint, and a hostile one must still fail there, by name.
  const cursor: unknown = checkpoint.subflowPath;
  const last: unknown = Array.isArray(cursor) ? cursor[cursor.length - 1] : undefined;
  return typeof last === 'string' ? parseSubflowPath(last) : [];
}
