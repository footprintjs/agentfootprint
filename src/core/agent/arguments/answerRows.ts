/** Answer-row composers: complete accepted call context in, served rows out. */
import type { InputValue } from '../../../tools/inputRequest.js';
import type { ToolArgs } from '../../../tools/runChain.js';
import { convertSpelling, isMissing } from '../../../tools/declare.js';
import { shownArgsOf } from '../../toolShownArgs.js';
import type { AskField, AskMember, WindowFill } from './ask.js';
import type { BatchCall, ToolOf } from './resolve.js';
import { HIDDEN_VALUE, answeredRowOf, type ArgumentRow } from './rows.js';

/** The answer in a member's own spelling — itself, unless the field is a shared period. */
export function memberValue(
  field: AskField,
  member: AskMember,
  answer: InputValue,
): InputValue | undefined {
  if (field.spelling === undefined || member.spelling === undefined) return answer;
  return convertSpelling(answer, field.spelling, member.spelling);
}

/** Every (call, argument) a field binds to, as a row identity. */
export function memberCalls(field: AskField) {
  return field.members.flatMap((m) =>
    m.toolCallIds.map((toolCallId) => ({
      toolCallId,
      toolName: m.toolName,
      argument: m.argument,
      rule: 'ask' as const,
      ...(m.period === true && { period: true as const }),
    })),
  );
}

/** The `answered` rows of a bound window, viewed with all accepted sibling fills. */
export function windowAnsweredRows(
  field: AskField,
  fills: Readonly<Record<string, WindowFill>>,
  byId: ReadonlyMap<string, BatchCall>,
  toolOf: ToolOf,
  stamp: { readonly turn: number; readonly iteration: number },
  filledById: ReadonlyMap<string, ToolArgs>,
): ArgumentRow[] {
  const nameOf = new Map(field.members.flatMap((m) => m.toolCallIds.map((id) => [id, m.toolName])));
  return Object.entries(fills).flatMap(([toolCallId, { values }]) => {
    const call = byId.get(toolCallId);
    const toolName = nameOf.get(toolCallId);
    if (call === undefined || toolName === undefined) return [];
    const tool = toolOf(toolName);
    const args = filledById.get(toolCallId);
    const shown = tool === undefined || args === undefined ? undefined : shownArgsOf(tool, args);
    return Object.keys(values).map((argument) =>
      answeredRowOf(
        {
          toolCallId,
          toolName,
          argument,
          rule: 'ask',
          period: true as const,
          shownValue: shown === undefined ? HIDDEN_VALUE : shown[argument],
        },
        stamp,
      ),
    );
  });
}

/** Each accepted field's row, using the complete call rather than a one-field probe. */
export function answeredRows(
  field: AskField,
  byId: ReadonlyMap<string, BatchCall>,
  toolOf: ToolOf,
  stamp: { readonly turn: number; readonly iteration: number },
  filledById: ReadonlyMap<string, ToolArgs>,
): ArgumentRow[] {
  const free = field.type === 'string' && field.choices === undefined;
  return field.members.flatMap((m) => {
    const tool = toolOf(m.toolName);
    return m.toolCallIds.flatMap((toolCallId) => {
      const call = byId.get(toolCallId);
      if (call === undefined) return [];
      // The full settled call is the context the tool's view judges. A missing declaration or
      // call context cannot establish that a bound value may be served.
      const args = filledById.get(toolCallId);
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
        answeredRowOf(
          {
            toolCallId,
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
      ];
    });
  });
}
