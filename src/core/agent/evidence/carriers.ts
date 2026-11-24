import { readCallOccurrenceKey } from '../../../lib/callOccurrence.js';
import type { LLMMessage } from '../../../provider-contract/types.js';

/**
 * How many results one indexed form remembers as its CARRIERS (9.110.0)
 * before the list is cut and marked. Eight, because the question the list
 * answers — "did EVERY result that carried this value get judged non-fact?"
 * (`findings/contingent.ts`) — needs the whole list or none of it: a value
 * nine results carried is a common value, not a tower, and the honest answer
 * for it is "not judged" rather than a verdict read off a prefix.
 */
export const MAX_CARRIERS = 8;

/**
 * Which of THIS turn's tool results carried one indexed form (9.110.0) —
 * the `toolCallId` of each `role: 'tool'` message that served it, in wire
 * order, each id once. The other half of the provenance the walk already
 * had: `values` says WHEN a value was last read, this says FROM WHERE.
 */
export interface ValueCarriers {
  readonly toolCallIds: readonly string[];
  /**
   * Set when more than `MAX_CARRIERS` results carried the form: the list is
   * the first `MAX_CARRIERS` and a reader must not judge "every carrier"
   * from it.
   */
  readonly truncated?: true;
}

interface OccurrenceCarriers {
  turn: number;
  occurrences: string[];
  truncated?: true;
}

export type SourceOccurrences = ReadonlyMap<string, Readonly<OccurrenceCarriers>>;

export interface CarrierSink {
  readonly carriers: Map<string, { toolCallIds: string[]; truncated?: true }>;
  readonly occurrences?: Map<string, OccurrenceCarriers>;
  turn: number;
  toolCallId: string | undefined;
  occurrence?: string;
}

export function markCarrier(sink: CarrierSink, message: LLMMessage): void {
  sink.toolCallId = typeof message.toolCallId === 'string' ? message.toolCallId : undefined;
  if (sink.occurrences === undefined) return;
  const key = readCallOccurrenceKey(message);
  if (
    typeof key === 'string' &&
    message.toolResultOrigin === undefined &&
    message.notDispatched === undefined
  )
    sink.occurrence = key;
  else delete sink.occurrence;
}

/** Keep exact result identities for the latest turn of this form. */
function carryOccurrence(
  map: Map<string, OccurrenceCarriers>,
  sink: CarrierSink,
  form: string,
): void {
  const occurrence = sink.occurrence;
  let held = map.get(form);
  if (held?.turn !== sink.turn) {
    if (occurrence === undefined) {
      map.delete(form);
      return;
    }
    held = { turn: sink.turn, occurrences: [] };
    map.set(form, held);
  }
  if (occurrence === undefined || held.occurrences.includes(occurrence)) return;
  if (held.occurrences.length === MAX_CARRIERS) held.truncated = true;
  else held.occurrences.push(occurrence);
}

/**
 * File the result being walked as a carrier of `form` — once per result,
 * in wire order, cut and marked at `MAX_CARRIERS`. Costs no index entry: a
 * carrier is an attribute of an entry the walk was going to write anyway.
 */
export function carry(sink: CarrierSink, form: string): void {
  if (sink.occurrences !== undefined) carryOccurrence(sink.occurrences, sink, form);
  const id = sink.toolCallId;
  if (id === undefined) return;
  const entry = sink.carriers.get(form);
  if (entry === undefined) {
    sink.carriers.set(form, { toolCallIds: [id] });
    return;
  }
  if (entry.toolCallIds.includes(id)) return;
  if (entry.toolCallIds.length >= MAX_CARRIERS) {
    entry.truncated = true;
    return;
  }
  entry.toolCallIds.push(id);
}
