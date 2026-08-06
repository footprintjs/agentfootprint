/**
 * window/folded — join a summary sitting in a conversation back to what it
 * stands for.
 *
 * Pattern: Pure lookup over recorded facts. No I/O, no inference.
 * Role:    core/ layer, and the ONE public door onto retained originals.
 * Emits:   N/A.
 *
 * ── Why a fingerprint and not an index ──────────────────────────────────────
 * The obvious join key is "the summary is at `history[3]`". It is also wrong.
 * A later fold swallows the span that CONTAINS an earlier summary, and every
 * index after it moves; a conversation that folded four times would need its
 * stored indices rewritten on every fold, and any reader holding an old one
 * would silently be pointing at somebody else's message.
 *
 * So the join key is a fingerprint of the summary message's full content —
 * authored frame included. Three things follow, and all three are the point:
 *
 *   • it costs NO extra bytes on the wire (no id token planted in the frame);
 *   • it survives JSON, storage, and being read by a runtime that has never
 *     heard of this function;
 *   • it cannot be FORGED. A model that writes a message opening with the
 *     frame's own words produces different content, therefore a different
 *     fingerprint, therefore no match — `isCompactedSummary` alone says "this
 *     LOOKS like a frame", and this says "this IS the frame of a fold that was
 *     recorded". The two answers are different questions and the gap between
 *     them is exactly where a forgery would live.
 *
 * ── Absent is an answer ─────────────────────────────────────────────────────
 * `undefined` means "no fold was recorded for this message" and never "there
 * were no originals". A conversation stored by 8.1 has summaries and no spans
 * at all; one folded under `retain: 'discard'` has a span whose `messages` is
 * absent. Those are three different facts and the caller can tell them apart:
 * no span, a span with no messages, a span with messages.
 */

import { fnv1a } from '../../slots/helpers.js';
import type { LLMMessage } from '../../../adapters/types.js';
import type { FoldedSpan } from './types.js';

/**
 * The join key for one summary message: a fingerprint of its whole content.
 *
 * @internal Consumers join through {@link foldedSpanFor}; this is exported for
 *   the strategy that stamps the span and for tests that pin the two agree.
 */
export function summaryFingerprint(content: string): string {
  return fnv1a(content);
}

/**
 * The smallest thing that can answer "what did this conversation fold?".
 *
 * Structural rather than `AgentRunCheckpoint` on purpose: it also fits a
 * paused run's `conversation`, a hand-built fixture, and anything a consumer
 * pulled out of their own store — and it keeps this file from importing the
 * checkpoint module, which imports this one's sibling types.
 */
export interface FoldedConversation {
  readonly folded?: readonly FoldedSpan[];
}

/**
 * What one summary message in a conversation stands for.
 *
 * Hand it the conversation you stored and a message out of its `history`; get
 * back the fold that produced that message, with the original messages when
 * the policy retained them.
 *
 * @returns the span, or `undefined` when this conversation recorded no fold
 *   for this message — see "Absent is an answer" above.
 *
 * @example  Show a user what the agent actually saw last week
 * ```ts
 * import { foldedSpanFor, isCompactedSummary } from 'agentfootprint';
 *
 * const conversation = readEnvelope(await sessions.hydrate(sessionId));
 * for (const message of conversation.history) {
 *   if (!isCompactedSummary(message)) continue;
 *   const span = foldedSpanFor(conversation, message);
 *   console.log(`summary of ${span?.messageCount ?? '?'} messages`);
 *   for (const original of span?.messages ?? []) {
 *     console.log(`  ${original.role}: ${original.content}`);
 *   }
 * }
 * ```
 */
export function foldedSpanFor(
  conversation: FoldedConversation,
  message: LLMMessage,
): FoldedSpan | undefined {
  const spans = conversation.folded;
  if (spans === undefined || spans.length === 0) return undefined;
  const fingerprint = summaryFingerprint(message.content);
  return spans.find((span) => span.summaryFingerprint === fingerprint);
}

/**
 * Every message this conversation ever folded, oldest fold first, flattened.
 *
 * The transcript-shaped answer to `foldedSpanFor`'s message-shaped one: what
 * a support view prints when somebody asks what the agent was told before the
 * summaries. Spans that were discarded contribute nothing — they have nothing
 * to contribute, and `foldedSpanFor` is where you find out that they existed.
 */
export function foldedMessages(conversation: FoldedConversation): readonly LLMMessage[] {
  const out: LLMMessage[] = [];
  for (const span of conversation.folded ?? []) out.push(...(span.messages ?? []));
  return out;
}
