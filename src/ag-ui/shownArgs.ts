/**
 * shownArgs — what a page is shown of a tool call whose tool hides argument
 * values, and the names of those values.
 *
 * Pattern: pure readers over a served event's payload. Role: the serializer's
 * one door for tool-call arguments (`TOOL_CALL_ARGS`) and for the hidden
 * names it hands the page (`metadata.agentfootprint.hiddenArgs` on
 * `TOOL_CALL_START` and on a check-in's interrupt).
 *
 * Why: a check-in's page tells the person "Values hidden from this view:
 * `to`" — and must not, in the same response, stream the real `to` as the
 * call's arguments. `stream.tool_start` carries the tool's view of the call
 * (`shownArgs`, the library's one view rule, `core/toolShownArgs.ts`) beside
 * the real `args` when the view hides something; the page gets the view.
 *
 *   tool_start { args: { to: 'acct-9', amount: 5 },
 *                shownArgs: { to: 'REDACTED', amount: 5 }, hiddenArgs: ['to'] }
 *     → TOOL_CALL_ARGS delta '{"to":"REDACTED","amount":5}'
 *     → TOOL_CALL_START metadata.agentfootprint.hiddenArgs ['to']
 *
 * What it does not cover: the real values still reach every other listener
 * of the run's own events and its recorded history, unless the app's
 * redaction policy covers them.
 */

import { argumentNames, copyArgumentDisplay, maskArguments } from '../lib/argumentDisplay.js';
import type { AgUiCustomProjection } from './customEvents.js';

const isRecord = (value: unknown): value is Readonly<Record<string, unknown>> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

interface ToolCallView {
  readonly args: unknown;
  readonly address: { readonly toolCallId?: string; readonly hiddenArgs?: readonly string[] };
}

/** The wire arguments and names are decided together. A custom projector cannot widen a tool view. */
export function argsShownOf(
  payload: Readonly<Record<string, unknown>>,
  id: string,
  project?: AgUiCustomProjection,
): ToolCallView {
  const toolCallId = typeof payload.toolCallId === 'string' ? payload.toolCallId : undefined;
  if (!Object.hasOwn(payload, 'shownArgs') && !Object.hasOwn(payload, 'hiddenArgs')) {
    const args =
      project === undefined
        ? payload.args ?? {}
        : project(payload, {
            toolCallId: id,
            ...(typeof payload.toolName === 'string' && { toolName: payload.toolName }),
          });
    return { args, address: { toolCallId } };
  }

  const names = hiddenNamesOf(payload.hiddenArgs);
  const shown = copyArgumentDisplay(payload.shownArgs);
  if (shown !== undefined) return { args: shown, address: { toolCallId, ...names } };

  const hiddenArgs = [...new Set([...argumentNames(payload.args), ...(names.hiddenArgs ?? [])])];
  return { args: maskArguments(hiddenArgs), address: { toolCallId, ...hiddenNamesOf(hiddenArgs) } };
}

/** `{ hiddenArgs }` for address metadata when `list` names any, else nothing. */
function hiddenNamesOf(list: unknown): { readonly hiddenArgs?: readonly string[] } {
  return Array.isArray(list) && list.length > 0 && list.every((n) => typeof n === 'string')
    ? { hiddenArgs: [...(list as string[])] }
    : {};
}

/** The names a paused check-in's request carried (`pause.request` → `questionPayload.checkIn`). */
export function checkInHiddenNamesOf(pausePayload: Readonly<Record<string, unknown>>): {
  readonly hiddenArgs?: readonly string[];
} {
  const question = pausePayload.questionPayload;
  const checkIn = isRecord(question) ? question.checkIn : undefined;
  return hiddenNamesOf(isRecord(checkIn) ? checkIn.hiddenArgs : undefined);
}
