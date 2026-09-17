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
import type { ToolResultPin } from './lastToolResult.js';
import type { LedgerFactPin } from './ledgerFactPins.js';
import type { WindowObservations, WindowRefusal, WindowRefusalReason } from './types.js';

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
  /**
   * Index in the window of the CURRENT REQUEST — the message this run is
   * executing (9.55.0). The turn holding it refuses with `'current-request'`.
   *
   * Resolved by `currentRequestIndexOf`, which the stage calls with the run's
   * own `scope.userMessage`. Absent (or `-1`) when the window holds no
   * identifiable request, and then this rule simply does not apply — which is
   * how a window that never had one behaves exactly as it did before the rule
   * existed.
   */
  readonly currentRequestIndex?: number;
  /** The tool call this run is paused on, when it is paused. */
  readonly pausedToolCallId?: string;
  /** True when the pause is a check-in (human consent) rather than askHuman. */
  readonly pausedCheckIn?: boolean;
  /**
   * Candidate LAST-TOOL-RESULT pins (9.57.0), newest first, from
   * `toolResultPinsOf`. An INPUT to `planRemoval`, not to `refusalFor`: the
   * ceiling can only be spent once the keep window is known, so `planRemoval`
   * admits some of these and hands `refusalFor` the answer.
   */
  readonly toolResultPins?: readonly ToolResultPin[];
  /** The ceiling on admitted pins (`keepLastToolResults`). 0 = the pin is off. */
  readonly keepLastToolResults?: number;
  /**
   * The ADMITTED pins, by turn index — what `refusalFor` actually reads.
   * Derived by `planRemoval`; a caller building guards by hand may set it
   * directly to ask `refusalFor` about one turn.
   */
  readonly pinnedTurnIndexes?: ReadonlySet<number>;
  /**
   * Candidate LEDGER-FACT pins (9.102.0), newest first, from
   * `ledgerFactPinsOf` — the turns whose results the MODEL declared facts on
   * its findings ledger. The same contract as `toolResultPins`: an input to
   * `planRemoval`, which spends the ceiling and hands `refusalFor` the
   * answer. Present only on an agent with `.findings()` — the stage never
   * resolves them otherwise, so an unarmed agent's guards are the object
   * they always were.
   */
  readonly ledgerFactPins?: readonly LedgerFactPin[];
  /** The ceiling on admitted fact pins (`keepLedgerFacts`). 0 = the hold is off. */
  readonly keepLedgerFacts?: number;
  /**
   * The ADMITTED fact pins, by turn index — the `'ledger-fact'` twin of
   * `pinnedTurnIndexes`, kept apart because the two pins have different
   * ceilings and a reader adding up what each one cost needs them apart.
   */
  readonly factPinnedTurnIndexes?: ReadonlySet<number>;
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
  // First, because it is the strongest rule in the family: the message the
  // run is executing is the one thing the model cannot work without. A turn
  // holds at most one non-`tool` message, so this never competes with the
  // reasons below for the same turn.
  const request = guards.currentRequestIndex;
  if (request !== undefined && request >= turn.start && request < turn.start + turn.length) {
    return 'current-request';
  }
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
  // LAST, because every reason above is a fact about the WIRE or about a
  // human, and these two are policies. A pinned turn that also holds an
  // unanswered call reports the unanswered call: that is the reason a reader
  // needs, and it is the one that would still be true with the pin switched
  // off.
  if (guards.pinnedTurnIndexes?.has(turn.index) === true) return 'last-tool-result';
  // After the recency pin, because a turn held by both is held by the
  // content-blind rule first — the one that would still be true if the model
  // had declared nothing. The stage's stand-down reads both names as one
  // family (`stages/window.ts · pinIsBlocking`), so nothing hides behind
  // this order.
  if (guards.factPinnedTurnIndexes?.has(turn.index) === true) return 'ledger-fact';
  return undefined;
}

/** The span a removal will take, plus every refusal it had to name to get there. */
export interface RemovalPlan {
  /** First turn index in the span; -1 when nothing may be removed. */
  readonly from: number;
  /** Last turn index in the span (inclusive); -1 when nothing may be removed. */
  readonly to: number;
  readonly refusals: readonly WindowRefusal[];
  /**
   * What the last-tool-result pin did on this plan (9.57.0) — which turns it
   * held and what the ceiling turned away. Absent when it held nothing, so a
   * window with no pinnable result plans exactly as it did before.
   */
  readonly observations?: WindowObservations;
  /**
   * What the ledger-fact pin did on this plan (9.102.0) — the same shape,
   * with `limit` = `keepLedgerFacts`. Absent when it held nothing, which on
   * an agent without `.findings()` is always.
   */
  readonly ledgerFacts?: WindowObservations;
}

/** What either pin hands the ceiling: a turn, its name and its cost. */
interface PinCandidate {
  readonly toolName: string;
  readonly turnIndex: number;
  readonly chars: number;
}

/**
 * Spend ONE pin's ceiling, and only on turns that would otherwise leave.
 *
 * A pin inside `keepRecentTurns` is already safe — `planRemoval` never even
 * asks about those turns — so it is filtered out here and costs nothing (the
 * free-pin law). The rest are admitted newest first, up to the ceiling; the
 * remainder is counted as `yielded` so the record can say the pin wanted more
 * than it was given. Nothing admitted → nothing returned, so a plan with no
 * contested pin carries no observations block at all.
 *
 * One function for both pins on purpose: the ledger-fact pin (9.102.0) is
 * the last-tool-result pin's content-aware sibling, and the ceiling is the
 * ONE grammar they share — a second spender would be a second place for the
 * free-pin law to drift.
 */
function spendCeiling(
  pins: readonly PinCandidate[],
  limit: number,
  candidateCount: number,
): { readonly turnIndexes?: ReadonlySet<number>; readonly observations?: WindowObservations } {
  if (limit <= 0 || pins.length === 0) return {};
  const contested = pins.filter((p) => p.turnIndex < candidateCount);
  const admitted = contested.slice(0, limit);
  if (admitted.length === 0) return {};
  return {
    turnIndexes: new Set(admitted.map((p) => p.turnIndex)),
    observations: {
      pinned: admitted.map((p) => ({
        toolName: p.toolName,
        turnIndex: p.turnIndex,
        chars: p.chars,
      })),
      yielded: contested.length - admitted.length,
      limit,
    },
  };
}

/**
 * Admit both pins' candidates against their own ceilings and hand back the
 * guards `refusalFor` reads. Each pin's block is present exactly when that
 * pin held something, so the guards and the plan of an agent with no
 * contested pin are the exact shape they were before either pin existed.
 */
function admitPins(
  guards: RemovalGuards,
  candidateCount: number,
): {
  readonly guards: RemovalGuards;
  readonly observations?: WindowObservations;
  readonly ledgerFacts?: WindowObservations;
} {
  const latest = spendCeiling(
    guards.toolResultPins ?? [],
    guards.keepLastToolResults ?? 0,
    candidateCount,
  );
  const facts = spendCeiling(
    guards.ledgerFactPins ?? [],
    guards.keepLedgerFacts ?? 0,
    candidateCount,
  );
  return {
    guards: {
      ...guards,
      ...(latest.turnIndexes !== undefined && { pinnedTurnIndexes: latest.turnIndexes }),
      ...(facts.turnIndexes !== undefined && { factPinnedTurnIndexes: facts.turnIndexes }),
    },
    ...(latest.observations !== undefined && { observations: latest.observations }),
    ...(facts.observations !== undefined && { ledgerFacts: facts.observations }),
  };
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

  // Spend the pin ceiling before asking anything, so `refusalFor` is answering
  // one settled question per turn.
  const admission = admitPins(guards, candidateCount);
  const effective = admission.guards;
  const observed = admission.observations;
  const heldFacts = admission.ledgerFacts;

  const before: WindowRefusal[] = [];
  let from = -1;
  let to = -1;
  for (let i = 0; i < candidateCount; i++) {
    const turn = turns[i]!;
    const reason = refusalFor(turn, effective);
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
      ...(observed !== undefined && { observations: observed }),
      ...(heldFacts !== undefined && { ledgerFacts: heldFacts }),
    };
  }

  return {
    from,
    to,
    refusals: [...before, ...refusals],
    ...(observed !== undefined && { observations: observed }),
    ...(heldFacts !== undefined && { ledgerFacts: heldFacts }),
  };
}

/** Total characters of message content in a window. Exact; not tokens. */
export function windowChars(history: readonly LLMMessage[]): number {
  let total = 0;
  for (const msg of history) total += msg.content.length;
  return total;
}
