/**
 * window/lastToolResult — the last thing each tool said, and why the window
 * keeps it.
 *
 * Pattern: One pure function over the window (no scope, no I/O, no clock).
 * Role:    core/ layer. Feeds the refusal engine, which is what actually
 *          keeps these turns in the window (see turns.ts,
 *          `'last-tool-result'`). Sibling of currentRequest.ts, and kept
 *          apart from it for the same reason: "what did the person ask for"
 *          and "what has the agent just seen" are different questions.
 * Emits:   N/A.
 *
 * ## Why this exists
 *
 * Measured, in a context-gap audit over real recorded runs. An agent drove a
 * screen through tools. A `whats_here` result — about 5,800 characters —
 * carried the list of valid ids it had to act on. Under
 * `slidingWindow({ keepRecentTurns: 2 })` that result survived roughly two
 * iterations, because segmentation makes each assistant/tool_result PAIR one
 * turn. The 9.55.0 anchor kept the REQUEST undroppable, so the model still
 * knew what it had been asked to do — and no longer had the evidence to do
 * it. It assembled a plausible id out of an entity name it remembered plus
 * the shape of an id it had used earlier, and was refused. In one archived
 * run the final answer to the person named a host that appears in no tool
 * result at all.
 *
 * The framework evicted the evidence and kept the task. This is the other
 * half of 9.55.0: **for each tool the agent is using, keep that tool's most
 * recent result** — until the agent calls that tool again, or the person asks
 * something new.
 *
 * ## What is pinned, exactly, and why it cannot grow
 *
 * One pin per tool NAME, always the LATEST result, superseded the moment that
 * tool answers again. So the candidate space is the TOOL ROSTER, not the
 * transcript: a loop that calls three tools forty times has three candidates,
 * not forty. Three further bounds compose on top:
 *
 *   • **deduped by turn** — a parallel batch answered in one assistant turn is
 *     ONE turn, so it costs one slot however many tools were in it;
 *   • **capped** — `keepLastToolResults` (default 2) is the ceiling, applied
 *     in `planRemoval` where the keep window is known, so a pin that is
 *     already inside `keepRecentTurns` costs nothing at all;
 *   • **anchored** — nothing at or before the CURRENT REQUEST is pinnable, so
 *     a new user turn releases the whole previous loop for free.
 *
 * Incompressible floor: 1 request + N pins + `keepRecentTurns` turns,
 * independent of tool count, iteration count and run length.
 *
 * ## What it deliberately gets wrong
 *
 * The pin is CONTENT-BLIND. It keeps a tool's LAST result, which may be a
 * one-word acknowledgement while the load-bearing screen dump was the call
 * before. Two slots absorb the common case; nothing eliminates it. That is
 * the honest price of a bound that is a fact about the tool roster rather
 * than a guess about content — and a guess about content is what this library
 * refuses to make everywhere else.
 *
 * Nor does the framework truly know "the tool the model is driving". This
 * approximates it with "every tool that has spoken since the request, latest
 * result each, newest first under a cap". A heuristic that PINS bills its
 * error every iteration, which is why the cap is small and the record names
 * what it kept.
 */

import type { LLMMessage } from '../../../adapters/types.js';
import { toolNameOfMessage } from './toolNames.js';
import type { Turn } from './turns.js';

/** One turn the pin holds, and what holding it costs. */
export interface ToolResultPin {
  /** The tool whose latest result is in this turn. */
  readonly toolName: string;
  /** Index of the turn in this iteration's segmentation. */
  readonly turnIndex: number;
  /** Index of the turn's first message in the window. */
  readonly messageIndex: number;
  /**
   * Content characters of the WHOLE turn — the assistant's call and its
   * results leave together, so the turn is what the pin actually holds.
   */
  readonly chars: number;
}

/** Content characters of one turn. Exact; not tokens. */
function turnChars(turn: Turn): number {
  let total = 0;
  for (const msg of turn.messages) total += msg.content.length;
  return total;
}

/**
 * The turns holding each tool's most recent result, NEWEST FIRST.
 *
 * Newest first because that is the order the ceiling is spent in: when more
 * tools have spoken than there are slots, the ones the agent used most
 * recently keep theirs.
 *
 * @param turns   the window's turn segmentation
 * @param history the window itself, for recovering a name from the assistant
 *   call when a result does not carry one
 * @param after   index of the CURRENT REQUEST, or `-1` when the window holds
 *   none. Nothing at or before it is pinnable: results gathered for an
 *   earlier request are ordinary history, and this is what makes a new user
 *   turn release the whole previous loop without a line of code
 */
export function toolResultPinsOf(
  turns: readonly Turn[],
  history: readonly LLMMessage[],
  after = -1,
): readonly ToolResultPin[] {
  const pins: ToolResultPin[] = [];
  const namedTools = new Set<string>();
  const pinnedTurns = new Set<number>();

  for (let t = turns.length - 1; t >= 0; t--) {
    const turn = turns[t]!;
    for (let m = turn.messages.length - 1; m >= 0; m--) {
      const index = turn.start + m;
      if (index <= after) continue;
      const name = toolNameOfMessage(turn.messages[m]!, history);
      // A result that cannot be named is not pinned. Pinning it under a made-
      // up name would keep a turn nothing can ever supersede.
      if (name === undefined || namedTools.has(name)) continue;
      namedTools.add(name);
      // One pin per TURN: a parallel batch is one turn, and pinning it three
      // times would spend three slots to keep one thing.
      if (pinnedTurns.has(t)) continue;
      pinnedTurns.add(t);
      pins.push({
        toolName: name,
        turnIndex: t,
        messageIndex: turn.start,
        chars: turnChars(turn),
      });
    }
  }
  return pins;
}
