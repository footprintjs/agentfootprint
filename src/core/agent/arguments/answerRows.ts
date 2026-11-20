/** Answer-row composers: complete accepted call context in, served rows out. */
import type { InputValue } from '../../../tools/inputRequest.js';
import type { ToolArgs } from '../../../tools/runChain.js';
import { convertSpelling, isMissing } from '../../../tools/declare.js';
import { shownArgsOf } from '../../toolShownArgs.js';
import { callOccurrenceField } from '../../../lib/callOccurrence.js';
import type { BatchAddress } from './batchAddress.js';
import { fieldAddresses, memberAddresses, windowAddressKey } from './askAddresses.js';
import type { AskField, AskMember, WindowFill } from './ask.js';
import type { BatchCall, ToolOf } from './resolve.js';
import { HIDDEN_VALUE, answeredRowOf, askedRowOf, type ArgumentRow } from './rows.js';

/** The answer in a member's own spelling — itself, unless the field is a shared period. */
export function memberValue(
  field: AskField,
  member: AskMember,
  answer: InputValue,
): InputValue | undefined {
  if (field.spelling === undefined || member.spelling === undefined) return answer;
  return convertSpelling(answer, field.spelling, member.spelling);
}

/** One invalid-answer row for each call the field would have bound. */
export function invalidAnswerRows(
  field: AskField,
  calls: ReadonlyMap<BatchAddress, BatchCall>,
  stamp: { readonly turn: number; readonly iteration: number },
): ArgumentRow[] {
  return field.members.flatMap((member) =>
    memberAddresses(member).flatMap((address) => {
      const call = calls.get(address);
      if (call === undefined) return [];
      return [
        {
          ...askedRowOf(
            {
              toolCallId: call.id,
              toolName: member.toolName,
              argument: member.argument,
              rule: 'ask',
              ...(member.period === true && { period: true as const }),
            },
            stamp,
            'invalid-answer',
          ),
          ...callOccurrenceField(call.callOccurrenceKey),
        },
      ];
    }),
  );
}

/** The `answered` rows of a bound window, viewed with all accepted sibling fills. */
export function windowAnsweredRows(
  field: AskField,
  fills: Readonly<Record<string, WindowFill>>,
  calls: ReadonlyMap<BatchAddress, BatchCall>,
  toolOf: ToolOf,
  stamp: { readonly turn: number; readonly iteration: number },
  filled: ReadonlyMap<BatchAddress, ToolArgs>,
): ArgumentRow[] {
  return [...fieldAddresses(field)].flatMap((address) => {
    const call = calls.get(address);
    const key = windowAddressKey(field, address);
    if (call === undefined || !Object.hasOwn(fills, key)) return [];
    const { values } = fills[key];
    const tool = toolOf(call.name);
    const args = filled.get(address);
    const shown = tool === undefined || args === undefined ? undefined : shownArgsOf(tool, args);
    return Object.keys(values).map((argument) => ({
      ...answeredRowOf(
        {
          toolCallId: call.id,
          toolName: call.name,
          argument,
          rule: 'ask',
          period: true as const,
          shownValue: shown === undefined ? HIDDEN_VALUE : shown[argument],
        },
        stamp,
      ),
      ...callOccurrenceField(call.callOccurrenceKey),
    }));
  });
}

/** Each accepted field's row, using the complete call rather than a one-field probe. */
export function answeredRows(
  field: AskField,
  calls: ReadonlyMap<BatchAddress, BatchCall>,
  toolOf: ToolOf,
  stamp: { readonly turn: number; readonly iteration: number },
  filled: ReadonlyMap<BatchAddress, ToolArgs>,
): ArgumentRow[] {
  const free = field.type === 'string' && field.choices === undefined;
  return field.members.flatMap((m) => {
    const tool = toolOf(m.toolName);
    return memberAddresses(m).flatMap((address) => {
      const call = calls.get(address);
      if (call === undefined) return [];
      // The full settled call is the context the tool's view judges. A missing declaration or
      // call context cannot establish that a bound value may be served.
      const args = filled.get(address);
      const shownValue =
        tool === undefined || args === undefined
          ? HIDDEN_VALUE
          : shownArgsOf(tool, args)[m.argument];
      // The model's original proposal has its own complete context, before the answer replaced it.
      const carried = !isMissing(call.args, m.argument);
      const shownProposed = !carried
        ? undefined
        : tool === undefined
        ? HIDDEN_VALUE
        : shownArgsOf(tool, call.args)[m.argument];
      return [
        {
          ...answeredRowOf(
            {
              toolCallId: call.id,
              toolName: m.toolName,
              argument: m.argument,
              rule: 'ask',
              ...(m.period === true && { period: true as const }),
              shownValue,
              ...(shownProposed !== undefined && { shownProposed }),
              ...(free && { free: true as const }),
            },
            stamp,
          ),
          ...callOccurrenceField(call.callOccurrenceKey),
        },
      ];
    });
  });
}
