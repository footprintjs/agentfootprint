/** L0 leaf: the reply module's narrow data port and fixed rule vocabulary. */
import type { CheckedMention } from '../reader.js';
import type { TimeRange } from '../range.js';
import type { ResolveClock, TimePolicy } from '../resolve.js';
import type { TimeReadingRow } from '../rows.js';
import type { ZoneName } from '../zone.js';

export interface TimeReplyInput {
  readonly range?: unknown;
  readonly correction?: unknown;
  readonly row: TimeReadingRow;
  readonly clock: ResolveClock;
  readonly policy: TimePolicy;
  /** The actual pending range field's values and display zones, in its order. */
  readonly offered?: readonly { readonly range: TimeRange; readonly zone?: ZoneName }[];
}

export type { TimeReplyRule } from '../replyRecord.js';
import type { TimeReplyRule } from '../replyRecord.js';

export type TimeReplyDecision =
  | {
      readonly kind: 'range';
      readonly range: TimeRange;
      readonly zone?: ZoneName;
      readonly how: 'confirmed' | 'edited';
      readonly rule: TimeReplyRule;
    }
  | { readonly kind: 'reask'; readonly row: TimeReadingRow; readonly rule: TimeReplyRule }
  | { readonly kind: 'hold'; readonly reason: string; readonly rule: TimeReplyRule };

export type DecodedReply =
  | { readonly kind: 'range' | 'text'; readonly value: string }
  | Extract<TimeReplyDecision, { readonly kind: 'hold' }>;

export type ClassifiedText =
  | { readonly kind: 'interval'; readonly range: TimeRange }
  | { readonly kind: 'zone'; readonly token: string }
  | {
      readonly kind: 'words';
      readonly mention: Extract<CheckedMention, { readonly quote: string }>;
    }
  | Extract<TimeReplyDecision, { readonly kind: 'hold' }>;

/** Fixed reasons: no raw answer or parser exception becomes decision evidence. */
export const REPLY_REASONS = Object.freeze({
  'both-filled': 'Choose a range or write a correction, rather than filling both.',
  'neither-filled': 'Choose a range or say what to change, such as a time zone or yesterday.',
  'invalid-range':
    'Give a full ISO interval with an offset on both ends and the start before the end.',
  'invalid-correction':
    'Write one correction, such as a time zone, yesterday, or a full ISO interval.',
  'unreadable-correction':
    'What should change? For example, give a time zone, yesterday, or a full ISO interval.',
  'ambiguous-correction':
    'Give one time correction at a time, such as one time zone or one interval.',
  'unresolved-correction':
    'That correction did not resolve the time. Give a time zone or a full ISO interval.',
} as const);

export function holdReply(rule: keyof typeof REPLY_REASONS): TimeReplyDecision & { kind: 'hold' } {
  return { kind: 'hold', rule, reason: REPLY_REASONS[rule] };
}
