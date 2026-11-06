import type { AwaitingInput, InputField, InputRefusal, InputValue } from '../inputRequest.js';
import {
  checkTimeAnswer,
  refusalReason,
  type TimeAnswerRefusal,
  type TimeAskMessages,
} from '../../time/ask.js';
import type { ZoneName } from '../../time/zone.js';
import { defaultTimeAskMessages } from '../../locales/timeAsk.js';
import { own } from './data.js';

/**
 * What the resume door knows when it checks a time field's answer: the
 * person's zone (the run clock's, under `.time()` — it arms the DST-gap check)
 * and the app's catalog overrides (`.time({ messages })`).
 */
export interface TimeAnswerContext {
  readonly zone?: ZoneName;
  readonly messages?: Partial<TimeAskMessages>;
}

/**
 * The time fields' answers the check refuses, field id → why — in field
 * order. Only a field with a `format` is judged: only a check the app armed
 * can refuse (time design § 6.2, TQ7).
 */
export function refusedTimeAnswers(
  fields: readonly InputField[],
  values: Readonly<Record<string, InputValue>>,
  zone: ZoneName | undefined,
): [string, TimeAnswerRefusal][] {
  const refused: [string, TimeAnswerRefusal][] = [];
  for (const field of fields) {
    if (field.format === undefined || !own(values, field.id)) continue;
    const refusal = checkTimeAnswer(field.format, values[field.id] as string, zone);
    if (refusal !== undefined) refused.push([field.id, refusal]);
  }
  return refused;
}

/**
 * The same ask, asked again: the refused time answers are not taken (the
 * fields are `missing` again, whether or not they are required — the person
 * tried to answer them), the rest of the reply is kept, and the re-ask
 * carries the 9.127.0 shapes — `refused: { answer, reason }` with the
 * catalog's reason, and the runtime's `repeat: { count }` (the refused
 * answer never reached the record, so there is no `previousAnswer`).
 */
export function reaskRefused(
  waiting: AwaitingInput,
  values: Readonly<Record<string, InputValue>>,
  refused: readonly [string, TimeAnswerRefusal][],
  time: TimeAnswerContext | undefined,
): AwaitingInput {
  const ids = new Set(refused.map(([id]) => id));
  const accepted = Object.fromEntries(Object.entries(values).filter(([k]) => !ids.has(k)));
  const drop = <T>(record: Readonly<Record<string, T>>): Record<string, T> =>
    Object.fromEntries(Object.entries(record).filter(([k]) => !ids.has(k)));
  const supplied = { ...drop(waiting.supplied), ...accepted };
  const messages: TimeAskMessages = { ...defaultTimeAskMessages, ...time?.messages };
  return {
    ...waiting,
    supplied,
    origins: {
      ...drop(waiting.origins),
      ...Object.fromEntries(Object.keys(accepted).map((k) => [k, 'response' as const])),
    },
    missing: waiting.fields
      .filter((f) => ids.has(f.id) || (f.required !== false && !own(supplied, f.id)))
      .map((f) => f.id),
    refused: {
      answer: Object.fromEntries(refused.map(([id]) => [id, values[id] as InputValue])),
      reason: refusalReason(
        refused.map(([, refusal]) => refusal),
        messages,
      ),
    },
    repeat: { count: (waiting.repeat?.count ?? 0) + 1 },
  };
}

/**
 * The refusal an ACCEPTED reply leaves standing. A refusal names the answer
 * it turned down (`InputRefusal.answer`); once the person has answered every
 * one of those fields again — and this reply was accepted — the refusal is
 * about an answer that no longer stands, so it is dropped: a UI must not say
 * "your answer was not accepted" beside a field it just took. A refusal that
 * names no answer, or one this reply did not answer again in full, stays.
 */
export function refusalStillStanding(
  refusal: InputRefusal | undefined,
  values: Readonly<Record<string, InputValue>>,
): InputRefusal | undefined {
  if (refusal?.answer === undefined) return refusal;
  const named = Object.keys(refusal.answer);
  return named.length > 0 && named.every((id) => own(values, id)) ? undefined : refusal;
}
