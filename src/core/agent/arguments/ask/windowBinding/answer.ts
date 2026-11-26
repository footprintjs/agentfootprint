/** Walker: bind an admitted window answer without changing conversion or question policy. */
import type { InputValue } from '../../../../../tools/inputRequest.js';
import { parseRange, sameRange } from '../../../../../time/range.js';
import { windowEndpointOf } from '../../../../../time/windowEndpoint.js';
import { offeredLookback, type TurnWindow } from '../../../../../time/windows.js';
import { chooseReading, resolveMention, withZoneAnswered } from '../../../../../time/resolve.js';
import type { TimeAnswerRow } from '../../../../../time/rows.js';
import { isZoneName } from '../../../../../time/zone.js';
import type { BatchAddress } from '../../batchAddress.js';
import { fieldAddresses, memberAddresses, windowAddressKey } from '../../askAddresses.js';
import type { BatchCall, ToolOf } from '../../resolve.js';
import { WINDOW_FORM_EXPECTATION, WINDOW_ZONE_EXPECTATION } from '../constants.js';
import type { AskField, AskTime, WindowAskField, WindowFill } from '../types.js';
import { editedZone } from './editedZone.js';
import { windowFills } from './fills.js';
import { windowQuestion } from './question.js';
import type { WindowBinding, WindowFilled } from './types.js';

/**
 * Bind one answer to a window field: a `zone` answer re-reads the mention in
 * that zone and asks the follow-up question with the readings as choices —
 * each still a PROPOSAL to confirm (the owner's decision "Always confirm");
 * a `time-range` answer (a choice, or free entry the door already judged) is
 * converted into every member call's forms — exactly, else wider (the fill's
 * own rule) — after each tool's declared facts. A choice the ask offered is
 * `confirmed` (the person's click on the pre-filled reading); any other window
 * is `edited` — both are the person's answer.
 */
export function bindWindowAnswer(
  field: AskField,
  answer: InputValue,
  byAddress: ReadonlyMap<BatchAddress, BatchCall>,
  toolOf: ToolOf,
  time: AskTime | undefined,
  answerKind?: TimeAnswerRow['how'],
): WindowBinding {
  const window = field.window as WindowAskField;
  if (window.role !== undefined && window.role !== 'confirm-meaning')
    throw new TypeError('argumentAsk: unknown window role');
  if (time === undefined) return { expected: WINDOW_FORM_EXPECTATION };
  if (window.format === 'zone') {
    const reading = time.reading;
    if (reading === undefined || typeof answer !== 'string' || time.zone === undefined) {
      return { expected: WINDOW_ZONE_EXPECTATION };
    }
    const row = window.reading ?? reading.row;
    // The re-read stays a PROPOSAL: the zone was the person's, the window is still words. Under
    // an unknown clock zone (G15) the answer is the person's own zone: the words are read in it.
    const resolution = resolveMention(
      withZoneAnswered(row.parses ?? [], answer, reading.policy),
      { now: time.now, zone: time.zoneUnknown === true && isZoneName(answer) ? answer : time.zone },
      row.reader,
      true,
      reading.policy,
    );
    const choice = chooseReading(resolution, reading.policy, row.reader.kind, undefined, true);
    if (choice.by === 'open')
      return windowQuestion(
        field,
        { ...row, candidates: resolution.candidates, choice },
        toolOf,
        time,
      );

    return { expected: WINDOW_ZONE_EXPECTATION };
  }
  const range = typeof answer === 'string' ? parseRange(answer) : undefined;
  if (range === undefined) return { expected: WINDOW_FORM_EXPECTATION };
  const at = answerKind === 'edited' ? -1 : field.choices?.indexOf(answer) ?? -1;
  const zone =
    at >= 0 ? window.zones?.[at] ?? time.zone : editedZone(range, window.zones, time.zone);
  if (zone === undefined) return { expected: WINDOW_FORM_EXPECTATION };
  const reading = window.reading ?? time.reading?.row;
  const candidate = reading?.candidates?.find(
    (item) => item.zone === zone && sameRange(item.range, range),
  );
  const endpoint = at >= 0 ? candidate?.endpoint : windowEndpointOf(range.to);
  const lookback = answerKind === 'edited' ? undefined : offeredLookback(reading, range);
  const how = at >= 0 ? 'confirmed' : 'edited';
  const answered = { range, zone, how, ...(endpoint !== undefined && { endpoint }) } as const;
  const turnWindow: TurnWindow = {
    source: 'answered',
    mention: window.mention,
    range,
    zone,
    ...(endpoint !== undefined && { endpoint }),
    ...(lookback !== undefined && { lookback }),
  };
  if (window.role === 'confirm-meaning') {
    const fills: Record<string, WindowFill> = Object.create(null);
    const filled: Record<string, WindowFilled> = Object.create(null);
    const refused: Record<string, string> = Object.create(null);
    const confirmed = new Set(window.confirmOnlyAddresses ?? window.confirmOnlyIds);
    const addressed = field.members.some((member) => member.callAddresses !== undefined);
    for (const address of fieldAddresses(field)) {
      if (confirmed.has(address)) continue;
      const members = field.members.flatMap((member) => {
        const index = memberAddresses(member).indexOf(address);
        if (index < 0) return [];
        return [
          {
            ...member,
            toolCallIds: [member.toolCallIds[index]],
            ...(addressed && { callAddresses: [address] }),
          },
        ];
      });
      const one = windowFills({ ...field, members }, turnWindow, byAddress, toolOf, time);
      if ('expected' in one) refused[windowAddressKey(field, address)] = one.expected;
      else {
        Object.assign(fills, one.fills);
        Object.assign(filled, one.filled);
      }
    }
    return {
      fills,
      filled,
      refused,
      answered,
    };
  }
  const bound = windowFills(field, turnWindow, byAddress, toolOf, time);
  if (!('fills' in bound)) return bound;
  return {
    fills: bound.fills,
    filled: bound.filled,
    answered,
  };
}
