/**
 * compaction/turns — where a turn boundary is, and which turns may fold.
 *
 * Pattern: Pure functions over the window (no scope, no I/O, no clock).
 * Role:    core/ layer. The whole safety argument of compaction lives here:
 *          a fold that splits an assistant's `tool_use` from its
 *          `tool_result` produces a request the vendor rejects, and a fold
 *          that swallows an unanswered question destroys the referent of the
 *          answer that has not arrived yet.
 * Emits:   N/A.
 *
 * Testable on its own — see `test/core/agent/compaction-turns.test.ts`.
 */

import type { LLMMessage } from '../../../adapters/types.js';
import type { FoldRefusal, FoldRefusalReason } from './types.js';

/**
 * One turn: a `user` / `assistant` / `system` message plus every `tool`
 * message that answers it. Tool results belong to the assistant turn that
 * requested them — that pairing is the thing a fold must never break.
 */
export interface Turn {
  /** Index of this turn in the segmentation. */
  readonly index: number;
  /** Index of the turn's FIRST message in the window. */
  readonly start: number;
  /** Number of messages in the turn. */
  readonly length: number;
  readonly messages: readonly LLMMessage[];
}

/**
 * Segment a window into turns.
 *
 * A new turn starts at any non-`tool` message; `tool` messages join the turn
 * in progress. A leading `tool` message (only reachable from a hand-built
 * history) starts its own turn rather than being silently dropped.
 */
export function segmentTurns(history: readonly LLMMessage[]): readonly Turn[] {
  const turns: Turn[] = [];
  let current: LLMMessage[] = [];
  let start = 0;

  const flush = (): void => {
    if (current.length === 0) return;
    turns.push({ index: turns.length, start, length: current.length, messages: current });
    current = [];
  };

  for (let i = 0; i < history.length; i++) {
    const msg = history[i]!;
    if (msg.role !== 'tool' || current.length === 0) {
      flush();
      start = i;
    }
    current.push(msg);
  }
  flush();
  return turns;
}

/** Context a foldability decision needs beyond the turn itself. */
export interface FoldabilityContext {
  /** Every `toolCallId` answered anywhere in the window. */
  readonly answeredCallIds: ReadonlySet<string>;
  /** The tool call this run is paused on, when it is paused. */
  readonly pausedToolCallId?: string;
  /** True when the pause is a check-in (human consent) rather than askHuman. */
  readonly pausedCheckIn?: boolean;
}

/** Every tool_call id that has a matching `role: 'tool'` message. */
export function answeredCallIds(history: readonly LLMMessage[]): ReadonlySet<string> {
  const answered = new Set<string>();
  for (const msg of history) {
    if (msg.role === 'tool' && msg.toolCallId) answered.add(msg.toolCallId);
  }
  return answered;
}

/**
 * Why this turn may NOT fold, or `undefined` when it may.
 *
 * Order matters only for which reason gets reported first; every check is
 * independent. `paused-tool` / `pending-check-in` are separated from
 * `unresolved-tool-call` on purpose: they are the same shape but a different
 * fact about the world, and "we are waiting on a human" is what the person
 * reading the trace needs to see.
 */
export function refusalFor(turn: Turn, ctx: FoldabilityContext): FoldRefusalReason | undefined {
  for (const msg of turn.messages) {
    if (msg.role === 'system') return 'system-envelope';
  }
  const paused = ctx.pausedToolCallId;
  if (paused !== undefined && paused.length > 0) {
    for (const msg of turn.messages) {
      const holdsPaused =
        msg.toolCallId === paused || (msg.toolCalls ?? []).some((tc) => tc.id === paused);
      if (holdsPaused) return ctx.pausedCheckIn === true ? 'pending-check-in' : 'paused-tool';
    }
  }
  for (const msg of turn.messages) {
    for (const call of msg.toolCalls ?? []) {
      if (!ctx.answeredCallIds.has(call.id)) return 'unresolved-tool-call';
    }
  }
  return undefined;
}

/** The span a fold will take, plus every refusal it had to name to get there. */
export interface FoldPlan {
  /** First turn index in the fold span; -1 when nothing folds. */
  readonly from: number;
  /** Last turn index in the fold span (inclusive); -1 when nothing folds. */
  readonly to: number;
  readonly refusals: readonly FoldRefusal[];
}

/**
 * Choose the fold span: the LONGEST CONTIGUOUS run of foldable candidate
 * turns, starting at the oldest foldable one.
 *
 * Contiguity is not fussiness — it is what keeps the conversation in order.
 * A fold replaces its span with ONE summary message; if the span skipped over
 * an unfoldable turn, that turn would end up after a summary of things that
 * happened before it. So an unfoldable turn at the front is stepped over (the
 * fold "takes the next oldest instead") and an unfoldable turn in the middle
 * ends the span. Everything not folded keeps its position.
 *
 * @param turns         the window's turn segmentation
 * @param keepRecent    how many trailing turns are off-limits
 * @param ctx           foldability inputs
 * @param isSummaryTurn true for a turn that is a summary a prior fold wrote
 */
export function planFold(
  turns: readonly Turn[],
  keepRecent: number,
  ctx: FoldabilityContext,
  isSummaryTurn: (turn: Turn) => boolean,
): FoldPlan {
  const refusals: FoldRefusal[] = [];
  const candidateCount = Math.max(0, turns.length - keepRecent);

  for (let i = candidateCount; i < turns.length; i++) {
    const turn = turns[i]!;
    refusals.push({ reason: 'inside-keep-window', turnIndex: i, messageIndex: turn.start });
  }
  if (candidateCount === 0) return { from: -1, to: -1, refusals };

  const before: FoldRefusal[] = [];
  let from = -1;
  let to = -1;
  for (let i = 0; i < candidateCount; i++) {
    const turn = turns[i]!;
    const reason = refusalFor(turn, ctx);
    if (reason === undefined) {
      if (from === -1) from = i;
      to = i;
      continue;
    }
    before.push({ reason, turnIndex: i, messageIndex: turn.start });
    if (from !== -1) break; // an unfoldable turn ENDS the span
  }

  // A span that is nothing but one existing summary is not worth a call:
  // re-summarizing a summary spends tokens to lose detail and names nothing
  // new. It becomes foldable again as soon as a real turn joins it.
  if (from !== -1 && from === to && isSummaryTurn(turns[from]!)) {
    return {
      from: -1,
      to: -1,
      refusals: [
        ...before,
        { reason: 'only-existing-summary', turnIndex: from, messageIndex: turns[from]!.start },
        ...refusals,
      ],
    };
  }

  return { from, to, refusals: [...before, ...refusals] };
}

/** Total characters of message content in a window. Exact; not tokens. */
export function windowChars(history: readonly LLMMessage[]): number {
  let total = 0;
  for (const msg of history) total += msg.content.length;
  return total;
}
