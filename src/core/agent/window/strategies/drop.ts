/**
 * window/strategies/drop — the mechanic both drop strategies share.
 *
 * Pattern: One pure function over a `WindowStrategyInput`.
 * Role:    core/ layer. `slidingWindow` and `tokenBudget` differ ONLY in when
 *          they engage and what they file; what actually leaves the window is
 *          decided here, once, so a refusal reason means the same thing under
 *          both — and under compaction, which asks the same `planRemoval`.
 * Emits:   N/A.
 *
 * A drop makes no LLM call and writes no summary. What it must still do is
 * keep the request valid and keep the record honest:
 *
 *   • the span comes from the shared refusal engine, so the CURRENT REQUEST,
 *     an unanswered tool call, the paused tool, a pending check-in and the
 *     recent turns never leave, and each refusal is named;
 *   • when the span reaches the front of what may leave, an authored notice
 *     takes that position — the window must open on a user turn (see
 *     notice.ts), and a message we are forced to author should tell the
 *     truth. That position is the window's HEAD in the ordinary case, and the
 *     slot just after the kept request when the request was the head;
 *   • when it does not, nothing is inserted: the original opening turn is
 *     still there, so there is no wire problem to solve.
 */

import type { LLMMessage } from '../../../../adapters/types.js';
import { buildDropNotice } from '../notice.js';
import { indexRange } from '../removal.js';
import type { WindowEviction, WindowStrategyInput } from '../strategy.js';
import { segmentTurns, windowChars } from '../turns.js';
import type { WindowRefusal } from '../types.js';

/** What a drop attempt did, in the terms a record needs. */
export interface DropOutcome {
  /** Every turn that refused to leave, named. */
  readonly refusals: readonly WindowRefusal[];
  /** The new window; absent when nothing was dropped. */
  readonly window?: readonly LLMMessage[];
  readonly rebase?: {
    readonly headCount: number;
    readonly keptTailCount: number;
    readonly insertedAtMs?: number;
  };
  readonly removedStageIds: readonly string[];
  readonly removedMessageCount: number;
  readonly evictions: readonly WindowEviction[];
  readonly windowCharsBefore: number;
  readonly windowCharsAfter: number;
  /** Turns in the window before / after. Counted from the segmentation. */
  readonly turnsBefore: number;
  readonly turnsAfter: number;
}

/**
 * Drop the oldest contiguous removable span, if there is one.
 *
 * @param input            the strategy's input, with the bound refusal engine
 * @param keepRecentTurns  how many trailing turns are off-limits
 * @param strategyName     named in the authored notice, so a reader of the
 *                         window itself can tell which policy removed things
 */
export function dropOldestSpan(
  input: WindowStrategyInput,
  keepRecentTurns: number,
  strategyName: string,
): DropOutcome {
  const { history, turns, iteration } = input;
  const charsBefore = windowChars(history);
  const nothing = (refusals: readonly WindowRefusal[]): DropOutcome => ({
    refusals,
    removedStageIds: [],
    removedMessageCount: 0,
    evictions: [],
    windowCharsBefore: charsBefore,
    windowCharsAfter: charsBefore,
    turnsBefore: turns.length,
    turnsAfter: turns.length,
  });

  // No `isExistingSummary` predicate: that refusal exists to stop a strategy
  // spending an LLM call to re-summarize a summary. A drop spends nothing, so
  // there is nothing to protect against — a stale summary is as droppable as
  // any other old turn.
  const plan = input.planRemoval(keepRecentTurns);
  if (plan.from === -1) return nothing(plan.refusals);

  const spanStart = turns[plan.from]!.start;
  const spanEnd = turns[plan.to]!.start + turns[plan.to]!.length;
  const head = history.slice(0, spanStart);
  const span = history.slice(spanStart, spanEnd);
  const tail = history.slice(spanEnd);

  let window: readonly LLMMessage[];
  let insertedAtMs: number | undefined;
  const droppedAtMs = input.now();

  // The drop stopped one turn short of the head because the CURRENT REQUEST
  // was sitting there and refused (9.55.0). The wire is fine — the request is
  // a user turn, so the window still opens on one — but the notice is still
  // owed: this removal reaches the front of everything that MAY leave, and a
  // model that reads the request must also be told what went missing under
  // it. Read off the refusal the engine already filed rather than re-derived,
  // so the notice can only move for the reason that actually moved the span.
  const keptRequestAtHead =
    plan.from === 1 &&
    plan.refusals.some((r) => r.reason === 'current-request' && r.turnIndex === 0);

  if (spanStart === 0 || keptRequestAtHead) {
    // The front of the droppable window is leaving: something must occupy
    // that position, and when it is the window's own head it must be a user
    // turn. Author the notice — and refuse the whole drop if that notice
    // would not be smaller than what it replaces, because dropping two tiny
    // turns to insert a longer notice is pure loss.
    const notice = buildDropNotice({
      droppedMessageCount: span.length,
      iteration,
      strategy: strategyName,
      ...(keptRequestAtHead && { currentRequestKept: true }),
    });
    if (notice.content.length >= windowChars(span)) {
      // `'replacement-not-smaller'` since 8.14.0. A drop writes no summary —
      // it never calls a summarizer at all — and the reason's old spelling
      // (`'summary-not-smaller'`) named one that does not exist on this path.
      return nothing([
        { reason: 'replacement-not-smaller', turnIndex: plan.from, messageIndex: spanStart },
        ...plan.refusals,
      ]);
    }
    // `head` is empty on the ordinary path, so this is byte-for-byte the
    // `[notice, ...tail]` this function has always produced; when the request
    // was kept it is `[request, notice, ...tail]`.
    window = [...head, notice, ...tail];
    insertedAtMs = droppedAtMs;
  } else {
    window = [...head, ...tail];
  }

  const facts = input.removalFacts(indexRange(spanStart, spanEnd), droppedAtMs);
  return {
    refusals: plan.refusals,
    window,
    rebase: {
      headCount: head.length,
      keptTailCount: tail.length,
      ...(insertedAtMs !== undefined && { insertedAtMs }),
    },
    removedStageIds: facts.removedStageIds,
    removedMessageCount: span.length,
    evictions: facts.evictions,
    windowCharsBefore: charsBefore,
    windowCharsAfter: windowChars(window),
    turnsBefore: turns.length,
    turnsAfter: segmentTurns(window).length,
  };
}
