/**
 * window/turns — where a turn boundary is, and which turns may leave.
 *
 * Pattern: Pure functions over the window (no scope, no I/O, no clock).
 * Role:    core/ layer. THE refusal engine. Every window strategy — the three
 *          that ship, and any a consumer writes — decides what leaves the
 *          window by calling these functions and nothing else, because the
 *          whole safety argument of the family lives here:
 *
 *            a removal that splits an assistant's `tool_use` from its
 *            `tool_result` produces a request the vendor rejects, and a
 *            removal that swallows an unanswered question destroys the
 *            referent of the answer that has not arrived yet.
 *
 *          Strategies never import this module. `WindowStrategyInput` hands
 *          them `planRemoval` already bound to this iteration's turns and
 *          guards, so a strategy CANNOT skip the refusal rules — that is a
 *          property of the seam, not of the documentation.
 * Emits:   N/A.
 *
 * Testable on its own — see `test/core/window-turns.test.ts`.
 */

import type { LLMMessage } from '../../../adapters/types.js';
import type { WindowRefusal, WindowRefusalReason } from './types.js';

/**
 * One turn: a `user` / `assistant` / `system` message plus every `tool`
 * message that answers it. Tool results belong to the assistant turn that
 * requested them — that pairing is the thing a removal must never break.
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

/**
 * Context a removal decision needs beyond the turn itself.
 *
 * Internal: the stage builds it from scope and binds it into the
 * `planRemoval` a strategy is handed, so no strategy has to know it exists.
 */
export interface RemovalGuards {
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
 * Why this turn may NOT leave the window, or `undefined` when it may.
 *
 * Order matters only for which reason gets reported first; every check is
 * independent. `paused-tool` / `pending-check-in` are separated from
 * `unresolved-tool-call` on purpose: they are the same shape but a different
 * fact about the world, and "we are waiting on a human" is what the person
 * reading the trace needs to see.
 */
export function refusalFor(turn: Turn, guards: RemovalGuards): WindowRefusalReason | undefined {
  for (const msg of turn.messages) {
    if (msg.role === 'system') return 'system-envelope';
  }
  const paused = guards.pausedToolCallId;
  if (paused !== undefined && paused.length > 0) {
    for (const msg of turn.messages) {
      const holdsPaused =
        msg.toolCallId === paused || (msg.toolCalls ?? []).some((tc) => tc.id === paused);
      if (holdsPaused) return guards.pausedCheckIn === true ? 'pending-check-in' : 'paused-tool';
    }
  }
  for (const msg of turn.messages) {
    for (const call of msg.toolCalls ?? []) {
      if (!guards.answeredCallIds.has(call.id)) return 'unresolved-tool-call';
    }
  }
  return undefined;
}

/** The span a removal will take, plus every refusal it had to name to get there. */
export interface RemovalPlan {
  /** First turn index in the span; -1 when nothing may be removed. */
  readonly from: number;
  /** Last turn index in the span (inclusive); -1 when nothing may be removed. */
  readonly to: number;
  readonly refusals: readonly WindowRefusal[];
}

/**
 * Choose the removal span: the LONGEST CONTIGUOUS run of removable candidate
 * turns, starting at the oldest removable one.
 *
 * Contiguity is not fussiness — it is what keeps the conversation in order.
 * A fold replaces its span with ONE summary message; if the span skipped over
 * an unremovable turn, that turn would end up after a summary of things that
 * happened before it. So an unremovable turn at the front is stepped over (the
 * span "takes the next oldest instead") and an unremovable turn in the middle
 * ends the span. Everything not removed keeps its position.
 *
 * The drop strategies take the same span for a second reason: it is what makes
 * a refusal reason mean the same thing under every strategy. A turn that ends
 * the span this iteration is retried the next one — by which time the tool
 * result it was waiting on has usually arrived.
 *
 * @param turns             the window's turn segmentation
 * @param keepRecent        how many trailing turns are off-limits
 * @param guards            what must not leave (unanswered calls, the pause)
 * @param isExistingSummary optional: true for a turn that is a summary a prior
 *   fold wrote. When the whole span is one such turn, the plan refuses with
 *   `only-existing-summary` — re-summarizing a summary spends an LLM call to
 *   lose detail. The drop strategies omit it: a drop spends nothing, so there
 *   is nothing to protect against.
 */
export function planRemoval(
  turns: readonly Turn[],
  keepRecent: number,
  guards: RemovalGuards,
  isExistingSummary?: (turn: Turn) => boolean,
): RemovalPlan {
  const refusals: WindowRefusal[] = [];
  const candidateCount = Math.max(0, turns.length - keepRecent);

  for (let i = candidateCount; i < turns.length; i++) {
    const turn = turns[i]!;
    refusals.push({ reason: 'inside-keep-window', turnIndex: i, messageIndex: turn.start });
  }
  if (candidateCount === 0) return { from: -1, to: -1, refusals };

  const before: WindowRefusal[] = [];
  let from = -1;
  let to = -1;
  for (let i = 0; i < candidateCount; i++) {
    const turn = turns[i]!;
    const reason = refusalFor(turn, guards);
    if (reason === undefined) {
      if (from === -1) from = i;
      to = i;
      continue;
    }
    before.push({ reason, turnIndex: i, messageIndex: turn.start });
    if (from !== -1) break; // an unremovable turn ENDS the span
  }

  // A span that is nothing but one existing summary is not worth a call:
  // re-summarizing a summary spends tokens to lose detail and names nothing
  // new. It becomes foldable again as soon as a real turn joins it.
  const summaryOnly =
    isExistingSummary !== undefined &&
    from !== -1 &&
    from === to &&
    isExistingSummary(turns[from]!);
  if (summaryOnly) {
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
