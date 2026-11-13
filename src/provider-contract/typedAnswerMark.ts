/**
 * THE LIBRARY'S MARK ON A PERSON'S TYPED ANSWER — `LLMMessage.answersAsk`, on
 * the `role: 'tool'` message a typed ask's answer (`requestInput`) landed as:
 * the ask it answers.
 *
 * Why a field and not the content's shape: any tool can return text shaped
 * like a landed answer (`{"status":"input_received", …}`), and the values
 * of a real answer count as the PERSON's words (the evidence gate exempts
 * them, a compaction summary carries them in `foldedExempt`, a re-ask
 * quotes them back). The one reader, `tools/typedAnswer.ts` ·
 * `landedTypedAnswer`, counts a message only when it carries this mark AND
 * its content is the answer to the ask the mark names; a result of the same
 * shape without the mark is an ordinary tool result.
 *
 * Written by one door, `core/agent/stages/toolCalls/resume/plain.ts` ·
 * `resumePlain`, and never copied from a tool's output: the library builds
 * every tool message from named fields.
 *
 * Where it stays: `agent.followUp()` continues the agent's own last run, a
 * conversation that never left the library, so the mark stays there and the
 * answer is still the person's words in the next turn. Where it goes: a
 * conversation a caller hands in (`run({ continueFrom })`, `resumeOnError`,
 * a hosted session store) loses it, in its history and in its folded
 * originals (`tools/typedAnswer.ts` · `withoutTypedAnswerMarks`), so its
 * typed answers read there as tool results. A history written before this
 * field existed carries no mark, and its typed answers read as tool results
 * too.
 *
 * Trusted as stored, today: a pause checkpoint carries the mark as stored,
 * and a stored compaction summary's `foldedExempt` is read as stored,
 * including a value a lookalike put there under an earlier version. Both
 * rest on the store being trusted; a mark only the library can have written
 * is a planned change of its own.
 *
 * **Never reaches a provider.** `core/agent/composeRequest.ts` ·
 * `stripFrameworkFields` removes it with the other framework fields.
 *
 * @example
 * ```ts
 * // agent.resume(checkpoint, { requestId: 'r1', values: { due: '2031-05-05' } }) lands:
 * { role: 'tool', toolCallId: 'c1', toolName: 'ask_due',
 *   content: '{"status":"input_received","requestId":"r1",…}',
 *   answersAsk: { requestId: 'r1' } }
 * ```
 */
export interface TypedAnswerMark {
  /** The request `Agent.resume` checked the answer against, for the ask the landing run raised. */
  readonly requestId: string;
}
