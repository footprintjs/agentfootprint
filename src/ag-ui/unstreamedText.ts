/**
 * unstreamedText — the part of an agent's answer the stream did not carry.
 *
 * WHY. `stream.token` carries the model's words as it writes them. The library
 * may append to the answer after the stream ends: the limits block
 * (`.limitsTravelWithTheAnswer()`), the standing line
 * (`.answerLayer({ standingLine })`), the scripts block. Those appear only in
 * `turn_end.finalContent`, and a frontend that reads only TEXT_MESSAGE_* events
 * would never show them — the person would not read the line the app turned on.
 *
 *   streamed  'There are 12.'
 *   answer    'There are 12.\n\n---\n\nNot sure — …'
 *   → '\n\n---\n\nNot sure — …'
 *
 * Only an EXTENSION is written: when the answer does not begin with exactly the
 * streamed text (a rewrite, or a value a redaction policy served differently on
 * the two events) nothing is guessed and nothing more is written. Nothing
 * streamed at all → the whole answer, as before.
 */

/** The text still to write for `answer`, given what streamed (`undefined` = nothing); `undefined` = nothing to write. */
export function unstreamedText(streamed: string | undefined, answer: string): string | undefined {
  if (answer.length === 0) return undefined;
  if (streamed === undefined) return answer;
  return answer.length > streamed.length && answer.startsWith(streamed)
    ? answer.slice(streamed.length)
    : undefined;
}
