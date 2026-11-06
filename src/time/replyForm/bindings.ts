/** A saved association admits two ordinary scalar fields, never a reply-supplied role. */
interface Field {
  readonly id: string;
  readonly type: string;
  readonly required?: boolean;
  readonly format?: string;
  readonly enum?: readonly unknown[];
  readonly labels?: readonly string[];
}
export interface TimeReplyRequest {
  readonly fields: readonly Field[];
  readonly context?: unknown;
}
export interface TimeReplyPair {
  readonly range: string;
  readonly correction: string;
}
const own = (value: unknown, key: string): unknown => {
  if (typeof value !== 'object' || value === null) return undefined;
  const descriptor = Object.getOwnPropertyDescriptor(value, key);
  return descriptor !== undefined && 'value' in descriptor ? descriptor.value : undefined;
};
function malformed(): never {
  throw new TypeError('Malformed time reply field binding.');
}

/** Read only complete associations stamped in the actual request's reserved context. */
export function timeReplyPairs(request: TimeReplyRequest): readonly TimeReplyPair[] {
  const marker = own(request.context, 'agentfootprint');
  if (own(marker, 'ask') !== 'arguments') return [];
  const entries = own(marker, 'fields');
  if (!Array.isArray(entries) || entries.length > 32) return [];
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
    const rangeField = request.fields.find((field) => field.id === range);
    const textField = request.fields.find((field) => field.id === correction);
    if (
      rangeField?.type !== 'string' ||
      rangeField.format !== 'time-range' ||
      rangeField.required !== false ||
      textField?.type !== 'string' ||
      textField.required !== false ||
      textField.format !== undefined ||
      textField.enum !== undefined ||
      textField.labels !== undefined
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
