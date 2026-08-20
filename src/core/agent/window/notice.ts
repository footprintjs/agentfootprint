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
 * It appears ONLY when the removal reaches the front of what may leave. That
 * is the window's head in the ordinary case; since 9.55.0 it is the position
 * just after the CURRENT REQUEST when the request was sitting at the head and
 * refused to go (see currentRequest.ts) — the notice is still the first thing
 * after the last un-droppable message, and it says that the request was kept.
 * A removal further in leaves the original opening turn in place, so there is
 * no wire problem to solve — and splicing a lone `user` message between two
 * assistant turns is its own risk. The ledger names that removal either way.
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
 * `role: 'user'` for the same reason the compaction frame is: it takes the
 * head of the window, and the head of the window must be a user turn. (When
 * the CURRENT REQUEST is holding that position it is already a user turn, and
 * the notice follows it — see below.)
 *
 * `currentRequestKept` (9.55.0) is set when the drop stopped short of the
 * window's head because the message the run is executing was sitting there
 * and refused to leave — so the notice takes the position AFTER it rather
 * than the head itself. It says so, because a model reading "3 earlier
 * messages were dropped" and then finding a request above it should be told
 * which of the two facts to trust. Omitted, the notice is byte-identical to
 * the one this library has always written.
 */
export function buildDropNotice(facts: {
  readonly droppedMessageCount: number;
  readonly iteration: number;
  readonly strategy: string;
  readonly currentRequestKept?: boolean;
}): LLMMessage {
  const kept =
    facts.currentRequestKept === true
      ? `Your current request is kept — it is still in this window, above this line, and no ` +
        `window strategy may drop it. `
      : '';
  return {
    role: 'user',
    content:
      `${DROP_NOTICE_PREFIX} — ${facts.droppedMessageCount} earlier message(s) were dropped ` +
      `from this window at iteration ${facts.iteration} by the '${facts.strategy}' window ` +
      `strategy. ${kept}Nothing was summarized: those turns are simply not being re-sent. ` +
      `They are retained verbatim in this run's commit log.]`,
  };
}

/** True when this message is a notice a previous drop wrote. */
export function isDropNotice(msg: LLMMessage | undefined): boolean {
  return msg !== undefined && msg.role === 'user' && msg.content.startsWith(DROP_NOTICE_PREFIX);
}
