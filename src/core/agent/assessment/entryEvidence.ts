import { readOwnList } from '../../../lib/boundedJson.js';
import { readCallOccurrenceKey } from '../../../lib/callOccurrence.js';
import { DEFAULT_MAX_EVENTS } from '../../../events/eventTail.js';
import { toolRanOf } from '../../../semantics/toolRan.js';
import { MAX_ENTERED_TOOL_CALLS } from '../honesty/enteredToolCalls.js';
import { readCallOccurrences } from '../recordedCalls.js';
import { isRecord } from './recordValues.js';
import type { AssessmentPointer } from './types.js';

export const ENTRY_EVIDENCE_KEY = 'enteredToolCalls' as const;

/** Read the turn's committed entry facts. Missing fields denote older recordings. */
export function entryEvidenceOf(value: unknown) {
  if (value === undefined) return undefined;
  const list = isRecord(value) ? readOwnList(value.entries, MAX_ENTERED_TOOL_CALLS) : undefined;
  const keys = new Set<string>();
  let unread = list === undefined || list.unread > 0;
  for (const row of list?.entries ?? []) {
    const key = isRecord(row) && row.entered === true ? readCallOccurrenceKey(row) : undefined;
    if (typeof key !== 'string') unread = true;
    else keys.add(key);
  }
  return { keys, complete: !unread && isRecord(value) && value.complete === true };
}

/** Earlier key-bearing recordings can prove entry with their scoped tool-end. */
export function legacyEntryKeys(events: unknown, history: readonly unknown[]): ReadonlySet<string> {
  const ends = (readOwnList(events, DEFAULT_MAX_EVENTS * 10)?.entries ?? []).flatMap(
    (event, index) => {
      if (
        !isRecord(event) ||
        event.type !== 'agentfootprint.stream.tool_end' ||
        !isRecord(event.payload) ||
        !isRecord(event.meta) ||
        typeof readCallOccurrenceKey(event.payload) !== 'string'
      )
        return [];
      return [{ index, type: event.type, payload: event.payload, meta: event.meta }];
    },
  );
  return new Set(
    readCallOccurrences(ends, history).flatMap(({ occurrenceKey, end }) =>
      typeof occurrenceKey === 'string' && end !== undefined && toolRanOf(end.payload) === 'ran'
        ? [occurrenceKey]
        : [],
    ),
  );
}

/** A dispatch proof gap uses the existing check-unreachable reason. */
export function dispatchProofWitness(pointer: AssessmentPointer): boolean {
  return (
    pointer.kind === 'state' &&
    (pointer.key === ENTRY_EVIDENCE_KEY || pointer.key === 'findingsLedger')
  );
}
