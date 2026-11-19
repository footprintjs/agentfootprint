/**
 * Group evidence that has a proven call address. Unplaced rows remain
 * evidence in their own right and add no occurrence to the group or count.
 */
export function groupOccurrenceEvidence<Row>(
  rows: readonly Row[],
  addressOf: (row: Row, index: number) => number | undefined,
): {
  readonly byOccurrence: ReadonlyMap<number, readonly Row[]>;
  readonly unplaced: readonly Row[];
} {
  const byOccurrence = new Map<number, Row[]>();
  const unplaced: Row[] = [];
  for (const [index, row] of rows.entries()) {
    const address = addressOf(row, index);
    if (address === undefined) {
      unplaced.push(row);
      continue;
    }
    const group = byOccurrence.get(address);
    if (group === undefined) byOccurrence.set(address, [row]);
    else group.push(row);
  }
  return { byOccurrence, unplaced };
}
import { readCallOccurrenceKey } from '../../../lib/callOccurrence.js';
import { isPlaceholder } from '../../../redaction/marker.js';
import { recordedEventOccurrenceKey, type CallOccurrence, type RecordedEvent } from './events.js';
import { isRecord } from './record.js';

const DECLARATION_EVENT = {
  'tools.absent': 'absence',
  'tools.coverage_declared': 'ledger',
} as const;

function declarationKey(row: Readonly<Record<string, unknown>>, kind: unknown, served: boolean) {
  const { toolCallId, toolName, iteration } = row;
  if (
    (kind !== 'absence' && kind !== 'ledger') ||
    typeof toolCallId !== 'string' ||
    toolCallId.length === 0 ||
    typeof toolName !== 'string' ||
    typeof iteration !== 'number' ||
    !Number.isSafeInteger(iteration) ||
    (served && (isPlaceholder(toolCallId) || isPlaceholder(toolName)))
  )
    return undefined;
  return JSON.stringify([toolCallId, toolName, iteration, kind]);
}

function append<Key, Row>(groups: Map<Key, Row[]>, key: Key, row: Row): void {
  const group = groups.get(key);
  if (group === undefined) groups.set(key, [row]);
  else group.push(row);
}

/**
 * A declaration's own key addresses an occurrence even when the declaration
 * event is missing. For an old row, only the corresponding legacy event
 * confers an address, and only when the whole group is recorded in order.
 * Counts and content always come from the declaration row.
 */
export function declarationOccurrences<Event extends RecordedEvent>(
  rows: readonly unknown[],
  events: readonly Event[],
  occurrences: readonly CallOccurrence<Event>[],
  served: boolean,
): ReadonlyMap<number, CallOccurrence<Event>> {
  const result = new Map<number, CallOccurrence<Event>>();
  const keyed = new Map<string, CallOccurrence<Event> | null>();
  const eventOwner = new Map<number, CallOccurrence<Event>>();
  for (const occurrence of occurrences) {
    const key = occurrence.occurrenceKey;
    if (typeof key === 'string') keyed.set(key, keyed.has(key) ? null : occurrence);
    if (key !== undefined) continue;
    for (const type of Object.keys(DECLARATION_EVENT)) {
      for (const event of occurrence.eventsOf(type)) eventOwner.set(event.index, occurrence);
    }
  }
  const rowsByKey = new Map<string, number[]>();
  for (const [index, row] of rows.entries()) {
    if (!isRecord(row) || (row.kind !== 'absence' && row.kind !== 'ledger')) continue;
    const occurrenceKey = readCallOccurrenceKey(row);
    if (occurrenceKey !== undefined) {
      const occurrence = occurrenceKey === null ? undefined : keyed.get(occurrenceKey);
      if (occurrence != null) result.set(index, occurrence);
      continue;
    }
    const key = declarationKey(row, row.kind, served);
    if (key !== undefined) append(rowsByKey, key, index);
  }
  if (rowsByKey.size === 0) return result;
  const eventsByKey = new Map<string, Event[]>();
  for (const event of events) {
    const type = event.type.replace(/^agentfootprint\./, '');
    if (type !== 'tools.absent' && type !== 'tools.coverage_declared') continue;
    if (recordedEventOccurrenceKey(event) !== undefined) continue;
    const key = declarationKey(event.payload, DECLARATION_EVENT[type], served);
    if (key !== undefined) append(eventsByKey, key, event);
  }
  for (const [key, indices] of rowsByKey) {
    const witnesses = eventsByKey.get(key);
    if (witnesses?.length !== indices.length) continue;
    for (const [position, event] of witnesses.entries()) {
      const rowIndex = indices[position];
      const call = eventOwner.get(event.index);
      if (rowIndex !== undefined && call !== undefined) result.set(rowIndex, call);
    }
  }
  return result;
}
