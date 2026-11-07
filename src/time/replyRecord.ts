/** Bounded reply evidence; no answer, quote, parser output or new raw carrier. */
export const TIME_REPLY_RULES = Object.freeze([
  'range-confirmed',
  'range-edited',
  'interval-corrected',
  'zone-corrected',
  'time-words-corrected',
  'both-filled',
  'neither-filled',
  'invalid-range',
  'invalid-correction',
  'unreadable-correction',
  'ambiguous-correction',
  'unresolved-correction',
] as const);
export type TimeReplyRule = (typeof TIME_REPLY_RULES)[number];
export interface TimeReplyEvidence {
  readonly decision: 'range' | 'reask' | 'hold';
  readonly rule: TimeReplyRule;
}
export function isTimeReplyEvidence(value: unknown): value is TimeReplyEvidence {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;
  const data = Object.getOwnPropertyDescriptors(value);
  return (
    Object.keys(data).length === 2 &&
    'value' in (data.decision ?? {}) &&
    'value' in (data.rule ?? {}) &&
    ['range', 'reask', 'hold'].includes(data.decision.value) &&
    TIME_REPLY_RULES.includes(data.rule.value)
  );
}
