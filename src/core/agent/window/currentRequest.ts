/**
 * window/currentRequest — which message in the window is the thing the run
 * was asked to do.
 *
 * Pattern: One pure function over the window (no scope, no I/O, no clock).
 * Role:    core/ layer. Feeds the refusal engine, which is what actually
 *          keeps this message in the window (see turns.ts, `'current-request'`).
 *          Kept in its own module because "what did the person ask for" is a
 *          different question from "where is a turn boundary", and only this
 *          one has to know which user-role messages the LIBRARY wrote.
 * Emits:   N/A.
 *
 * ## Why this exists
 *
 * Caught in a real recorded run (9.55.0). A ten-iteration tool loop under a
 * small window dropped the window's HEAD at iteration 4 — and the head was
 * the user's own request. The model went on working from tool traffic and a
 * drop notice, with no statement of its objective anywhere in context. It
 * finished that task by momentum; a longer one forgets what it was doing.
 *
 * Every other guard in this family protects the WIRE (do not split a
 * `tool_use` from its `tool_result`) or the near past (`keepRecentTurns`).
 * Nothing protected the one message the whole run is about, because it is the
 * OLDEST message in the window and every strategy here removes the oldest
 * thing first. So it is named, and it refuses.
 *
 * ## Which message, exactly
 *
 * The window is a flat message list. Its `Turn` segmentation is a WIRE
 * boundary (a non-`tool` message plus the `tool` messages answering it), not
 * a conversational one — there is no "turn 3 of this conversation" object in
 * this folder to point at. What the run DOES know is the message it was
 * started with, which the seed stage commits as `scope.userMessage`, and the
 * stage passes it in as `said`.
 *
 * So the answer is, in order:
 *
 *   1. the LAST message the person said whose text is exactly `said` — the
 *      message this run is executing, matched by content rather than by
 *      position because a restored conversation puts earlier turns in front
 *      of it;
 *   2. failing that, the LAST message the person said at all. That is the
 *      honest approximation for a window seeded from outside this run, and it
 *      is stated rather than hidden: earlier turns of a multi-turn
 *      conversation stay droppable exactly as they were.
 *
 * "The person said it" is deliberately narrow. Five kinds of `role: 'user'`
 * message are written by this LIBRARY, not by anybody: a drop notice, a
 * compaction frame, the two in-loop corrections (schema check, evidence
 * check), and a message an {@link Injection} delivered (which carries
 * `injectedBy`). None of them may become the anchor — otherwise the
 * window would protect its own bookkeeping and drop the request underneath
 * it, and a tool able to influence an injection could pin its own text in
 * context permanently.
 *
 * That rule is no longer written here. Since 9.84.0 it is `isSaidByPerson` in
 * `lib/saidByPerson.ts`, a leaf the injection engine can import too — a rule
 * author reading `InjectionContext.history` has to be able to apply the same
 * test this file applies, and two copies of it would drift.
 */

import type { LLMMessage } from '../../../adapters/types.js';
import { isSaidByPerson } from '../../../lib/saidByPerson.js';

/**
 * Index in `history` of the current request — the message no window strategy
 * may drop — or `-1` when this window holds none.
 *
 * `-1` is a real answer, not a failure: a hand-built window of assistant
 * turns, or one whose only user-role messages are this library's own frames,
 * genuinely has no request to protect. Every caller treats it as "the rule
 * does not apply here", which is how the pre-9.55.0 behaviour is still
 * reachable byte for byte.
 *
 * @param history the window, in order
 * @param said    the text the run was started with (`scope.userMessage`),
 *                when the caller knows it
 */
export function currentRequestIndexOf(history: readonly LLMMessage[], said?: string): number {
  let latest = -1;
  for (let i = history.length - 1; i >= 0; i--) {
    const msg = history[i]!;
    if (!isSaidByPerson(msg)) continue;
    if (said !== undefined && msg.content === said) return i;
    if (latest === -1) latest = i;
  }
  return latest;
}
