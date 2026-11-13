/**
 * liveConversation — where a continued conversation comes from.
 *
 * A typed answer's mark (`LLMMessage.answersAsk`) says the library asked that
 * question and landed the person's answer itself. Whether the mark still
 * holds in the next turn depends on where that turn's history came from, and
 * this file is the one place that decides it:
 *
 * - `agent.followUp()` continues THIS agent's last run. The conversation is
 *   read from the run's own snapshot (`checkpointFor`) and handed straight to
 *   the next turn; no caller ever holds it. The person's answer there is
 *   still the person's words, so the marks stay.
 * - `run({ continueFrom })`, `resumeOnError()` and every hosted session store
 *   (which continue through `continueFrom`) hand in a conversation that was
 *   in the caller's hands, so it could carry a mark the library never wrote.
 *   Its marks are removed, in the history and in the folded originals.
 *
 * The follow-up door marks the object it builds with {@link asLiveConversation};
 * the run asks {@link isLiveConversation} about the object it was handed. The
 * set holds only objects this module was given, so a caller cannot make its
 * own conversation "live": `agent.checkpoint()` builds a new object on every
 * call, and that object is never in the set.
 *
 * @example
 * ```ts
 * const conversation = asLiveConversation(this.checkpointFor(previous)); // followUp
 * isLiveConversation(conversation);       // true: marks stay
 * isLiveConversation(agent.checkpoint()); // false: marks are removed
 * ```
 */

import type { LLMMessage } from '../../../../provider-contract/types.js';
import type { AgentRunCheckpoint } from '../../../runCheckpoint.js';
import { withoutTypedAnswerMarks } from '../../../../tools/typedAnswer.js';

const live = new WeakSet<object>();

/** Mark a conversation the library read from its own run and hands on unseen. */
export function asLiveConversation<T extends object>(conversation: T): T {
  live.add(conversation);
  return conversation;
}

/** Whether `value` is a conversation {@link asLiveConversation} marked. */
export function isLiveConversation(value: unknown): boolean {
  return typeof value === 'object' && value !== null && live.has(value);
}

/**
 * The history and folded spans a continued turn restores. From a live
 * conversation, as stored; from outside, without a typed answer's mark
 * anywhere (`tools/typedAnswer.ts` · `withoutTypedAnswerMarks`).
 */
export function restoredConversation(
  cp: AgentRunCheckpoint,
  fromLive: boolean,
): Pick<AgentRunCheckpoint, 'history' | 'folded'> {
  const history = cp.history as readonly LLMMessage[];
  if (fromLive) return { history, folded: cp.folded };
  return {
    history: withoutTypedAnswerMarks(history),
    folded: cp.folded?.map((span) =>
      span.messages === undefined
        ? span
        : { ...span, messages: withoutTypedAnswerMarks(span.messages) },
    ),
  };
}
