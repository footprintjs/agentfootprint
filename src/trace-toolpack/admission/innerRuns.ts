import { readRetainedTraceRecords } from '../../core/innerRunRecords.js';
import type { InnerRunLookup, InnerRunRecord } from '../../core/innerRunRecords.js';
import { openRecording } from '../openRecording.js';
import { requiresTraceAdmission } from './disposition.js';

/** Prevent an outer journal from describing raw fields of a restricted child. */
export function admitInnerRuns(lookup: InnerRunLookup): InnerRunLookup {
  const admitted = new WeakMap<InnerRunRecord, boolean>();
  const mayDescribe = (record: InnerRunRecord): boolean => {
    const cached = admitted.get(record);
    if (cached !== undefined) return cached;
    let permitted = false;
    try {
      permitted =
        record.recording !== undefined && !requiresTraceAdmission(openRecording(record.recording));
    } catch {
      // A failed or unreadable capture has no admitted description.
    }
    admitted.set(record, permitted);
    return permitted;
  };
  const retained = () => readRetainedTraceRecords(lookup) ?? [];
  return {
    get(toolCallId) {
      const matches = retained().filter((record) => record.toolCallId === toolCallId);
      if (matches.length !== 1 || !mayDescribe(matches[0])) return undefined;
      const record = lookup.get(toolCallId);
      return record === matches[0] ? record : undefined;
    },
    list: () =>
      retained()
        .filter(mayDescribe)
        .map(({ toolCallId, toolName, outcome, steps, runId }) => ({
          toolCallId,
          toolName,
          outcome,
          steps,
          ...(runId !== undefined && { runId }),
        })),
    get dropped() {
      return readRetainedTraceRecords(lookup)?.every(mayDescribe) === true ? lookup.dropped : 0;
    },
    get limit() {
      return lookup.limit;
    },
  };
}
