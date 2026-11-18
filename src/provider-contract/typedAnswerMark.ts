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
 * The live run knows who wrote the message from the path that landed it.
 * `agent.followUp()` retains the mark in the same live conversation. When
 * a pause or conversation checkpoint is loaded, the library validates the
 * mark's shape on history and retained folded originals, then trusts it
 * as stored. The checkpoint is the run's own state, and the library cannot
 * establish who wrote a stored field. Keep the session store as safe as
 * the run.
 *
 * A record written before this field existed has no mark. Its tool results
 * do not count as typed answers. A stored compaction summary's
 * `foldedExempt` remains trusted as stored, including a value a lookalike
 * added under an earlier version.
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
