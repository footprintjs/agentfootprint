/**
 * window/ledgerFactPins — the results the model declared FACTS, and why the
 * window keeps them.
 *
 * Pattern: One pure function over the window (no scope, no I/O, no clock),
 *          plus the two helpers that rank a standing and give a TURN one.
 * Role:    core/ layer. Feeds the refusal engine, which is what actually
 *          keeps these turns in the window (see turns.ts, `'ledger-fact'`).
 *          Twin of lastToolResult.ts, and kept apart from it for the same
 *          reason that file is kept apart from currentRequest.ts: "what has
 *          the agent just seen" and "what does the agent say it stands on"
 *          are different questions, answered by different evidence. That pin
 *          is CONTENT-BLIND — it keeps each tool's LATEST result whatever it
 *          says. This one is content-aware by the MODEL'S claim only: it
 *          keeps the turns whose results the model itself filed as `fact` in
 *          `AgentState.findingsLedger`, and reads nothing else.
 * Emits:   N/A.
 *
 * ## Why this exists
 *
 * Measured, on `bench/findings-context.mjs`. Under `slidingWindow` (keep 6,
 * twenty calls, six planted facts) the ledger PIECE carried all six facts to
 * the answer turn, but the wire carried two of them verbatim — the rest had
 * left oldest-first with the noise around them, while noise turns younger
 * than they were stayed. The window knew nothing about standing: a result
 * the model had declared a fact and a result it had declared noise were the
 * same bytes to the refusal engine, so recency decided, every time.
 *
 * The ledger already says which is which, by the model's own hand. This pin
 * reads that: **a turn the model declared a fact stays, up to a ceiling,
 * until the model re-files it or the person asks something new.** 'Noise
 * first' then follows without a second mechanism — noise, ruled-out, open
 * and undeclared turns are unpinned and leave oldest-first exactly as today,
 * and since step 3b collapsed a judged noise turn to a ticket on the wire, a
 * noise turn that outlives a fact costs bytes the wire no longer pays.
 *
 * ## What is pinned, exactly, and why it cannot grow
 *
 * One candidate per TURN whose standing is `fact`, by the LAST row the
 * ledger holds for each result (the fold takes the last, so a fact the model
 * re-files as noise is released the moment it says so). A Turn is the
 * removal unit — an assistant's call and its results leave together — so
 * the standing of a turn is its most valuable member's ({@link
 * turnStandingOf}): a parallel batch that answered one fact beside two noise
 * results is ONE turn, one slot, and the noise stays with it. Three further
 * bounds compose on top, the same three as the sibling pin:
 *
 *   • **deduped by turn** — one pin per turn however many facts it holds;
 *   • **capped** — `keepLedgerFacts` is the ceiling, applied in
 *     `planRemoval` where the keep window is known, so a fact turn already
 *     inside `keepRecentTurns` costs nothing at all;
 *   • **anchored** — nothing at or before the CURRENT REQUEST is pinnable,
 *     so a new user turn releases the whole previous loop for free.
 *
 * And a fourth the ceiling alone cannot give: a hold that has provably been
 * blocking progress stands down, on the record (`stages/window.ts ·
 * pinIsBlocking`). A fact hold NEVER exists without its ceiling and its
 * stand-down — a window full of declared facts degrades to today's recency
 * behaviour after the stand-down, and the record says why.
 *
 * ## What it deliberately gets wrong
 *
 * The pin trusts the model. A result the model called a fact and never
 * revisits is held to the ceiling whether or not it was one; a result the
 * model never judged is `undeclared`, ranks above noise so a batch with one
 * unjudged member is never filed as noise, and is NOT held. The library does
 * not read the result's text to second-guess either — a guess about content
 * is what this library refuses to make everywhere else, and the model's
 * standing is the one content-aware signal that is a claim on the record
 * rather than an inference. A heuristic that PINS bills its error every
 * iteration, which is why the cap is small, the stand-down exists, and the
 * record names what it kept.
 */

import type { LLMMessage } from '../../../adapters/types.js';
import { isResultMessage } from '../findings/offer.js';
import type { Standing } from '../findings/types.js';
import { toolNameOfMessage } from './toolNames.js';
import type { Turn } from './turns.js';

/** One turn the pin holds, and what holding it costs. */
export interface LedgerFactPin {
  /**
   * Every tool result the turn holds, in wire order — not only the facts.
   * The turn is what the pin actually holds: a noise result answered in the
   * same batch as a fact stays with it, and each result's own standing is on
   * the ledger by this id. A message the batch settlement wrote (9.113.0) is
   * no result and is never listed (`findings/offer.ts` · `isResultMessage`).
   */
  readonly toolCallIds: readonly string[];
  /**
   * The tool of the newest nameable result in the turn — the name the record
   * files under `WindowObservations.pinned`. A turn is usually one tool; a
   * batch is named for its newest member, the same way the sibling pin names
   * a turn for the latest result it holds.
   */
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
 * How much a standing is worth to the window, as a number ONLY so two can be
 * compared: `fact > open > undeclared > ruled-out > noise`. Never recorded.
 *
 * `undefined` is UNDECLARED — the model said nothing about the result — and
 * it ranks above `ruled-out` and `noise` on purpose: an absent standing is
 * never defaulted to a verdict, so a batch with one unjudged member is not
 * a noise batch. It ranks below `open` because `open` is a declaration.
 */
export function rankStanding(standing: Standing | undefined): number {
  switch (standing) {
    case 'fact':
      return 4;
    case 'open':
      return 3;
    case undefined:
      return 2;
    case 'ruled-out':
      return 1;
    case 'noise':
      return 0;
    default: {
      const exhaustive: never = standing;
      return exhaustive;
    }
  }
}

/**
 * The standing of a TURN: its most valuable tool result's, by
 * {@link rankStanding}. A Turn is the removal unit, so this is the one
 * question the refusal engine can ask about it.
 *
 * A turn with no tool result has no standing — `undefined`, the same answer
 * as a turn whose results the model never judged. Both are "the ledger says
 * nothing that holds this turn", which is all a caller may conclude.
 *
 * A message the batch settlement wrote (9.113.0, `LLMMessage.notDispatched`)
 * is served and is no RESULT (`findings/offer.ts` · `isResultMessage`), so it
 * takes no part in the ranking: counted, it would rank as an UNDECLARED
 * result above the noise and ruled-out results the model really judged, and
 * a batch it sits in would lose the standing its results earned — and a
 * standing a model filed on its id anyway (`unknownId: true`) would hold the
 * turn for a sentence about a call that never ran.
 *
 * @param turn           the turn to judge
 * @param standingOfCall the LAST standing the ledger holds for a result, by
 *   its `toolCallId` (`foldLedger(rows).standingOf.get(id)?.standing`), or
 *   `undefined` when it holds none
 */
export function turnStandingOf(
  turn: Turn,
  standingOfCall: (toolCallId: string) => Standing | undefined,
): Standing | undefined {
  let best: Standing | undefined;
  let bestRank = -1;
  for (const msg of turn.messages) {
    if (!isResultMessage(msg) || msg.toolCallId === undefined || msg.toolCallId.length === 0) {
      continue;
    }
    const standing = standingOfCall(msg.toolCallId);
    const rank = rankStanding(standing);
    if (rank > bestRank) {
      bestRank = rank;
      best = standing;
    }
  }
  return best;
}

/**
 * The turns whose standing is `fact`, NEWEST FIRST.
 *
 * Newest first because that is the order the ceiling is spent in: when the
 * model has declared more facts than there are slots, the ones it declared
 * most recently keep theirs.
 *
 * @param turns      the window's turn segmentation
 * @param history    the window itself, for recovering a name from the
 *   assistant call when a result does not carry one
 * @param standingOf a turn's standing, as the stage bound it
 *   (`WindowStrategyInput.standingOf`; built with {@link turnStandingOf}).
 *   Asked once per turn, newest first, and it is the ONLY thing read about
 *   the ledger here — the pin is content-aware by the model's claim alone
 * @param after      index of the CURRENT REQUEST, or `-1` when the window
 *   holds none. Nothing at or before it is pinnable: facts gathered for an
 *   earlier request are ordinary history, and this is what makes a new user
 *   turn release the whole previous loop without a line of code
 */
export function ledgerFactPinsOf(
  turns: readonly Turn[],
  history: readonly LLMMessage[],
  standingOf: (turn: Turn) => Standing | undefined,
  after = -1,
): readonly LedgerFactPin[] {
  const pins: LedgerFactPin[] = [];

  for (let t = turns.length - 1; t >= 0; t--) {
    const turn = turns[t]!;
    if (standingOf(turn) !== 'fact') continue;

    const toolCallIds: string[] = [];
    let toolName: string | undefined;
    for (let m = 0; m < turn.messages.length; m++) {
      if (turn.start + m <= after) continue;
      const msg = turn.messages[m]!;
      // A settled message is no result (`isResultMessage`), so the pin never
      // lists its id — the same predicate `turnStandingOf` ranks by.
      if (!isResultMessage(msg) || msg.toolCallId === undefined || msg.toolCallId.length === 0) {
        continue;
      }
      toolCallIds.push(msg.toolCallId);
      // The NEWEST nameable result names the pin — later messages overwrite.
      const name = toolNameOfMessage(msg, history);
      if (name !== undefined) toolName = name;
    }
    // No result after the anchor: the turn is history, whatever it was
    // declared. No name: not pinned — the record names what it held, and
    // it must not name a tool that does not exist (the toolNames.ts law).
    if (toolCallIds.length === 0 || toolName === undefined) continue;

    pins.push({
      toolCallIds,
      toolName,
      turnIndex: t,
      messageIndex: turn.start,
      chars: turnChars(turn),
    });
  }
  return pins;
}
