/**
 * window/notice — the authored message a DROP leaves behind, and why it has
 * to exist at all.
 *
 * Pattern: Authored envelope with no untrusted payload whatsoever.
 * Role:    core/ layer. Shared by both drop strategies.
 * Emits:   N/A.
 *
 * The first reason for this message is the WIRE, not the prose. An agent
 * window looks like `user, assistant+tool, assistant+tool, …`, so dropping
 * the oldest turns leaves an ASSISTANT message at the head — and the
 * providers that care (Anthropic) require the window to open on a user turn.
 * A silent drop of the window's head therefore produces a request the vendor
 * rejects. Something must occupy that position.
 *
 * Given that we have to author a message there anyway, it should say what
 * happened rather than be filler. So it does: how many messages left, at
 * which iteration, by which strategy, and where they still are. Unlike the
 * compaction frame there is no model output involved at ALL — every character
 * below is written by this library, which is why a drop has no prompt-
 * injection surface to speak of.
 *
 * It appears ONLY when the removal reaches the window's head. A removal in
 * the middle leaves the original opening turn in place, so there is no wire
 * problem to solve — and splicing a lone `user` message between two assistant
 * turns is its own risk. The ledger names that removal either way.
 *
 * It does not accumulate: the notice is an ordinary oldest turn next time
 * round, so the next drop absorbs it and files a fresh one.
 */

import type { LLMMessage } from '../../../adapters/types.js';

/** Opening of the authored notice. Stable — tests and readers match on it. */
export const DROP_NOTICE_PREFIX = '[dropped history';

/**
 * Build the message that takes the head position after a drop.
 *
 * `role: 'user'` for the same reason the compaction frame is: it is the head
 * of the window, and the head of the window must be a user turn.
 */
export function buildDropNotice(facts: {
  readonly droppedMessageCount: number;
  readonly iteration: number;
  readonly strategy: string;
}): LLMMessage {
  return {
    role: 'user',
    content:
      `${DROP_NOTICE_PREFIX} — ${facts.droppedMessageCount} earlier message(s) were dropped ` +
      `from this window at iteration ${facts.iteration} by the '${facts.strategy}' window ` +
      `strategy. Nothing was summarized: those turns are simply not being re-sent. They are ` +
      `retained verbatim in this run's commit log.]`,
  };
}

/** True when this message is a notice a previous drop wrote. */
export function isDropNotice(msg: LLMMessage | undefined): boolean {
  return msg !== undefined && msg.role === 'user' && msg.content.startsWith(DROP_NOTICE_PREFIX);
}
