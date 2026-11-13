/**
 * typedAnswer — the ONE rule for "this tool message is a person's typed answer".
 *
 * A typed ask (`requestInput`) is answered through `Agent.resume`, and the
 * answer lands in the history as a `role: 'tool'` message whose content is an
 * `input_received` result. Its values are the PERSON's words, not the tool's:
 * the evidence gate exempts them, a fold carries them in its lineage, and a
 * re-ask quotes them back.
 *
 * WHY a mark and not the shape. Any tool can return text of that shape: a
 * local tool, a remote MCP server, a page answering a frontend tool. Read by
 * shape, a tool could make its own values the person's words. So the door that
 * lands the answer (`core/agent/stages/toolCalls/resume/plain.ts`) writes a
 * field only the library writes, `LLMMessage.answersAsk`, naming the ask; and
 * every reader asks {@link landedTypedAnswer}, which accepts a message only
 * when that mark names the ask its content answers. The door and the readers
 * share one predicate, {@link isAnswerTo}.
 *
 * The mark lives OUTSIDE the content, so a tool cannot write it: the library
 * builds every tool message from named fields, never from a tool's output.
 * `core/agent/composeRequest.ts` · `stripFrameworkFields` keeps it off every
 * request a provider sees, with the library's other fields. A conversation a
 * caller hands to a new run (`run({ continueFrom })`, `resumeOnError`, a
 * hosted session store) goes through {@link withoutTypedAnswerMarks}: it was in
 * the caller's hands, so a mark in it may not be the library's. `followUp()`
 * keeps the marks: its conversation is read from the agent's own last run and
 * never leaves the library (`core/agent/runtime/conversation/liveConversation.ts`).
 *
 * Trusted as stored, today: a pause checkpoint carries the mark as stored, and
 * a stored summary's `foldedExempt` is read as stored (including a value a
 * lookalike put there under an earlier version). Both rest on the store being
 * trusted; a mark only the library can have written is a planned change of
 * its own.
 *
 * @example
 * ```ts
 * const content = JSON.stringify({
 *   status: 'input_received', requestId: 'r1',
 *   values: { due: '2031-05-05' }, origins: { due: 'response' },
 * });
 * landedTypedAnswer({ role: 'tool', content, answersAsk: { requestId: 'r1' } }); // the answer
 * landedTypedAnswer({ role: 'tool', content }); // undefined: the shape alone is a tool's result
 * ```
 */

import type { LLMMessage } from '../provider-contract/types.js';
import { object, own } from './inputRequest/data.js';

/** A landed answer as its content holds it: what {@link isAnswerTo} proves. */
export interface LandedTypedAnswer {
  readonly status: 'input_received';
  readonly requestId: string;
  readonly values: Readonly<Record<string, unknown>>;
  readonly origins?: unknown;
}

/** What a reader hands {@link landedTypedAnswer}: a message, as history or a record holds it. */
export interface TypedAnswerCandidate {
  readonly role: string;
  readonly content: unknown;
  readonly toolChars?: unknown;
  readonly answersAsk?: unknown;
}

/**
 * THE predicate shared by the door that lands an answer and the readers that
 * recognise one: `landed` is the `input_received` result of the ask
 * `requestId` names.
 */
export function isAnswerTo(landed: unknown, requestId: string): landed is LandedTypedAnswer {
  return (
    object(landed) &&
    landed.status === 'input_received' &&
    landed.requestId === requestId &&
    object(landed.values)
  );
}

/** The ask the library's mark names, or `undefined` when the message carries no well-formed mark. */
function markedRequestOf(message: TypedAnswerCandidate): string | undefined {
  if (!own(message, 'answersAsk')) return undefined;
  const mark = message.answersAsk;
  if (!object(mark)) return undefined;
  const { requestId } = mark;
  return typeof requestId === 'string' && requestId.length > 0 ? requestId : undefined;
}

/** `JSON.parse` of the content, or `undefined` for text that is not JSON. */
function parsedContentOf(message: TypedAnswerCandidate & { readonly content: string }): unknown {
  try {
    return JSON.parse(message.content);
  } catch {
    return undefined;
  }
}

/**
 * The person's typed answer this message carries, or `undefined` for every
 * message the library did not land as one. A message counts only when it is a
 * `role: 'tool'` message, it carries the library's mark, and its content is
 * the answer to the very ask the mark names.
 *
 * `read` parses a marked message's content. A reader with its own parser
 * passes it (the evidence index reads only the tool's own bytes, through its
 * bounded reader); the default is `JSON.parse` of the whole content.
 */
export function landedTypedAnswer<M extends TypedAnswerCandidate>(
  message: M,
  read: (marked: M & { readonly content: string }) => unknown = parsedContentOf,
): LandedTypedAnswer | undefined {
  if (message.role !== 'tool' || typeof message.content !== 'string') return undefined;
  const requestId = markedRequestOf(message);
  if (requestId === undefined) return undefined;
  const landed = read(message as M & { readonly content: string });
  return isAnswerTo(landed, requestId) ? landed : undefined;
}

/**
 * The same history without the library's typed-answer mark, for a
 * conversation a caller hands to a new run (`run({ continueFrom })`,
 * `resumeOnError`, a hosted session store). The mark says the library asked
 * the question and landed the answer; a handed-in conversation has been in
 * the caller's hands, where anyone could have written one, so its answers
 * read as ordinary tool results here. `followUp()` does not come through here:
 * its conversation never left the library. Only the mark goes: every other
 * field and every message stays. A history with no mark is returned by
 * reference.
 *
 * @example
 * ```ts
 * withoutTypedAnswerMarks([{ role: 'tool', toolCallId: 'c1', content, answersAsk: { requestId: 'r1' } }]);
 * // [{ role: 'tool', toolCallId: 'c1', content }]
 * ```
 */
export function withoutTypedAnswerMarks(history: readonly LLMMessage[]): readonly LLMMessage[] {
  if (!history.some((m) => own(m, 'answersAsk'))) return history;
  return history.map((m) => {
    if (!own(m, 'answersAsk')) return m;
    const { answersAsk: _mark, ...rest } = m;
    void _mark;
    return rest;
  });
}
