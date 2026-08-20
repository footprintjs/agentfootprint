/**
 * window/toolNames — which tools spoke in a stretch of the window.
 *
 * Pattern: Pure functions over messages (no scope, no I/O, no clock).
 * Role:    core/ layer. One implementation of "what is this tool result's
 *          tool called", used by the two places that need the answer for
 *          different reasons:
 *
 *            • the drop notice, which tells the MODEL whose results left, so
 *              it calls the tool again instead of reconstructing an id from
 *              memory (9.57.0);
 *            • `WindowRecord.droppedObservations`, which tells the READER the
 *              same thing, uncapped and unsanitized.
 * Emits:   N/A.
 *
 * ## Why the name is not simply `msg.toolName`
 *
 * It usually is: every path in `stages/toolCalls.ts` that appends a result
 * stamps `toolName` beside `toolCallId`. But `LLMMessage.toolName` is
 * OPTIONAL on the adapter type, so a window seeded from outside this run — a
 * restored conversation written by an older release, a hand-built fixture, a
 * host that speaks the wire shape and nothing more — can carry a result whose
 * only identity is the `toolCallId` it answers. The assistant turn that asked
 * for it names the tool, so the name is recoverable; that recovery is here,
 * once, rather than guessed twice.
 *
 * A result whose name cannot be recovered either way contributes NOTHING. It
 * is not called `'unknown'` and it is not counted: a notice that says a tool
 * called `unknown` lost its result teaches the model a tool name that does
 * not exist, which is the exact failure this file exists to prevent.
 */

import type { LLMMessage } from '../../../adapters/types.js';

/**
 * The tool a `role: 'tool'` message came from, or `undefined`.
 *
 * @param msg     the message to name
 * @param context where to look for the assistant turn that asked, when the
 *   message does not name the tool itself. Usually the whole window.
 */
export function toolNameOfMessage(
  msg: LLMMessage,
  context: readonly LLMMessage[],
): string | undefined {
  if (msg.role !== 'tool') return undefined;
  if (msg.toolName !== undefined && msg.toolName.length > 0) return msg.toolName;
  const id = msg.toolCallId;
  if (id === undefined || id.length === 0) return undefined;
  for (const other of context) {
    for (const call of other.toolCalls ?? []) {
      if (call.id === id && call.name.length > 0) return call.name;
    }
  }
  return undefined;
}

/**
 * The tools whose results are in `span`, in FIRST-APPEARANCE order, each named
 * once.
 *
 * First appearance rather than sorted or newest-first because the notice reads
 * as a sentence about what happened, and what happened has an order.
 *
 * @param span    the messages that are leaving
 * @param context where to recover a missing `toolName` from; defaults to the
 *   span itself, which is enough whenever the pair left together (it always
 *   does — a turn is the removal unit, and the pair is one turn)
 */
export function droppedToolNames(
  span: readonly LLMMessage[],
  context: readonly LLMMessage[] = span,
): readonly string[] {
  const names: string[] = [];
  for (const msg of span) {
    const name = toolNameOfMessage(msg, context);
    if (name !== undefined && !names.includes(name)) names.push(name);
  }
  return names;
}
