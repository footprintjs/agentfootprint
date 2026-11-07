/** Adapter for one declared time pair. Interpretation belongs to the time facade. */
import type { AwaitingInput, InputValue } from '../../../../tools/inputRequest.js';
import { timeReplyPairs } from '../../../../time/replyForm.js';
import { timeReplyOf } from '../../../../time/reply.js';
import type { TimeReplyEvidence } from '../../../../time/replyRecord.js';
import { parseRange, spellRange } from '../../../../time/range.js';
import { offeredLookback } from '../../../../time/windows.js';
import type { BatchCall, ToolOf } from '../resolve.js';
import type { AskField, AskTime } from './types.js';
import { bindWindowAnswer, windowQuestion, type WindowBinding } from './windowBinding.js';
import { WINDOW_FORM_EXPECTATION } from './constants.js';

export function bindWindowReply(
  field: AskField,
  values: Readonly<Record<string, InputValue>>,
  id: string,
  awaiting: AwaitingInput,
  byId: ReadonlyMap<string, BatchCall>,
  toolOf: ToolOf,
  time: AskTime | undefined,
): WindowBinding & {
  readonly reply?: TimeReplyEvidence;
  readonly value?: InputValue;
  readonly retry?: AskField;
} {
  const answer = values[id],
    window = field.window!;
  if (window.reply === undefined || window.format !== 'time-range') {
    return answer === undefined
      ? { expected: WINDOW_FORM_EXPECTATION }
      : { ...bindWindowAnswer(field, answer, byId, toolOf, time), value: answer };
  }
  const pair = timeReplyPairs(awaiting).find((item) => item.range === id);
  if (pair === undefined || window.reply.version !== 1)
    throw new TypeError('Saved time reply binding does not match its field.');
  const reading = window.reading ?? time?.reading?.row;
  if (time === undefined || reading === undefined || time.reading === undefined)
    return { expected: WINDOW_FORM_EXPECTATION };
  const offered = (field.choices ?? []).flatMap((choice, index) => {
    const range = parseRange(choice);
    return range === undefined ? [] : [{ range, zone: window.zones?.[index] }];
  });
  const decision = timeReplyOf({
    range: answer,
    correction: values[pair.correction],
    row: reading,
    clock: {
      now: time.now,
      zone: time.zone ?? 'UTC',
      ...(time.zoneUnknown === true && { zoneSource: 'unknown' }),
    },
    policy: time.reading.policy,
    offered,
  });
  const reply: TimeReplyEvidence = { decision: decision.kind, rule: decision.rule };
  if (decision.kind === 'hold')
    return { expected: decision.reason, reply, retry: { ...field, question: decision.reason } };
  if (decision.kind === 'reask') {
    const next = windowQuestion(field, decision.row, toolOf, time);
    return 'followUp' in next
      ? {
          followUp: { ...next.followUp, window: { ...next.followUp.window!, corrected: true } },
          reply,
        }
      : { ...next, reply };
  }
  const value = spellRange(decision.range);
  const bound = bindWindowAnswer(field, value, byId, toolOf, time, decision.how);
  const corrected = window.corrected === true || decision.rule === 'interval-corrected';
  const lookback =
    decision.how === 'confirmed' ? offeredLookback(reading, decision.range) : undefined;
  return 'fills' in bound
    ? {
        ...bound,
        answered: {
          ...bound.answered,
          how: decision.how,
          ...(corrected && { corrected: { ...(lookback !== undefined && { lookback }) } }),
        },
        value,
        reply,
      }
    : { ...bound, value, reply };
}
