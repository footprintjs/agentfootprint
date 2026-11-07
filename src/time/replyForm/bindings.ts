/** A saved association admits two ordinary scalar fields, never a reply-supplied role. */
interface Field {
  readonly id: string;
  readonly type: string;
  readonly required?: boolean;
  readonly format?: string;
  readonly enum?: readonly unknown[];
  readonly labels?: readonly string[];
}
/** The part of a paused ask `timeReplyPairs` reads: `awaitingInput`, in process or off a host's wire. */
export interface TimeReplyRequest {
  readonly fields: readonly Field[];
  readonly context?: unknown;
}
/** One declared pair, by field id: the time range, and the optional text beside it for correcting it. */
export interface TimeReplyPair {
  readonly range: string;
  readonly correction: string;
}
const own = (value: unknown, key: string): unknown => {
  if (typeof value !== 'object' || value === null) return undefined;
  const descriptor = Object.getOwnPropertyDescriptor(value, key);
  return descriptor !== undefined && 'value' in descriptor ? descriptor.value : undefined;
};
const declared = (fields: unknown, id: string): unknown =>
  Array.isArray(fields) ? fields.find((field) => own(field, 'id') === id) : undefined;
function malformed(): never {
  throw new TypeError('Malformed time reply field binding.');
}

/**
 * The time range and correction pairs an ask declares, so a host can treat the
 * text sibling as offered, not asked, without reading a reserved context key.
 * Reads only complete associations stamped in the actual request's reserved
 * context, and takes the request as the run returned it or as JSON off a wire.
 *
 * @returns One pair per declaration, or `[]` when the request declares none.
 * @throws TypeError when a stamped binding does not match its fields. A request
 * the library wrote and JSON carried never throws. `[]` would say the ask has
 * no pair, which would be false, so catch this where a bad response must not
 * take a page down, and offer no one-click confirm there.
 *
 * @example
 * ```ts
 * const siblings = new Set(timeReplyPairs(request).map((pair) => pair.correction));
 * const asked = request.fields.filter((field) => !siblings.has(field.id));
 * ```
 */
export function timeReplyPairs(request: TimeReplyRequest): readonly TimeReplyPair[] {
  const marker = own(own(request, 'context'), 'agentfootprint');
  if (own(marker, 'ask') !== 'arguments') return [];
  const entries = own(marker, 'fields');
  if (!Array.isArray(entries) || entries.length > 32) return [];
  const fields = own(request, 'fields');
  const pairs: TimeReplyPair[] = [];
  const used = new Set<string>();
  for (let index = 0; index < entries.length; index++) {
    const entry = own(entries, String(index));
    const binding = own(entry, 'timeReply');
    if (binding === undefined) continue;
    const range = own(entry, 'id');
    const correction = own(binding, 'correction');
    if (
      own(binding, 'version') !== 1 ||
      typeof range !== 'string' ||
      typeof correction !== 'string' ||
      correction !== `${range}-correction` ||
      used.has(range) ||
      used.has(correction)
    )
      malformed();
    const rangeField = declared(fields, range);
    const textField = declared(fields, correction);
    if (
      own(rangeField, 'type') !== 'string' ||
      own(rangeField, 'format') !== 'time-range' ||
      own(rangeField, 'required') !== false ||
      own(textField, 'type') !== 'string' ||
      own(textField, 'required') !== false ||
      own(textField, 'format') !== undefined ||
      own(textField, 'enum') !== undefined ||
      own(textField, 'labels') !== undefined
    )
      malformed();
    used.add(range);
    used.add(correction);
    pairs.push({ range, correction });
  }
  return pairs;
}

/** A new declared time pair can return neither channel to its native hold decision. */
export function hasDeclaredTimeReply(request: TimeReplyRequest): boolean {
  return timeReplyPairs(request).length > 0;
}
