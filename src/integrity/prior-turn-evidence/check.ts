/**
 * prior-turn-evidence — the answer is grounded, and every value in it was
 * served BEFORE this turn. Filed at the CLAIM seam, as an advisory, never an
 * accusation.
 *
 * Pattern: pure function over one reading of a finished judgement (the
 *          `readLookupResult` → `emptyLookupOf` shape, one seam later).
 * Role:    the decidable fragment of "did this answer come from the data, or
 *          from the conversation?".
 *
 * THE MEASURED FAILURE. A consumer's agent answered a data question with ZERO
 * tool calls, and the evidence gate approved it: `LLM calls 1 · Tool calls 0 ·
 * Iterations 1`, then "All 7 values in the answer were found in what the tools
 * returned — the answer stands." They were found: in an inventory result from
 * four turns earlier, fetched for a different question. The user had asked
 * about array performance; the answer confidently recommended enabling a
 * collector that had been running for months. Two turns did it back to back.
 *
 * Every rail passed honestly. The gate measures GROUNDEDNESS and had no notion
 * of WHEN a value was grounded, which is exactly the fact the run needed.
 *
 * AND THE GATE SAID OTHERWISE. Its two sentences — the correction it sends the
 * model and the warning it prints an operator — both said the flagged values
 * "appear in NO tool result FROM THIS TURN" (`../../core/agent/evidence/
 * gate.ts`). The index behind them has never been turn-scoped. So the library
 * was already ASSERTING the boundary it could not measure, in the two places
 * the assertion is read. That contradiction is the defect this change closes,
 * and it closes it in the only honest order: the sentences were narrowed to
 * what the check really reaches, and the turn boundary became something the
 * index can actually MEASURE and report — off by default, beside the gate,
 * never folded into its verdict.
 *
 * WHAT THE LIBRARY ALREADY KNOWS, and this check is nothing more than reading
 * it out:
 *   (a) which values in the answer the evidence index could ground — the
 *       gate computes that already, for every armed agent;
 *   (b) which TURN each of those values was last served in — one number the
 *       index stamps during the walk it was already doing.
 * When every grounded value's newest source is older than the turn in
 * progress, the answer was assembled from the conversation rather than from
 * anything this turn went and looked at. That is worth filing. It is not
 * worth accusing anyone of.
 *
 * THE CORPUS IS NOT NARROWED, and that decision is the design. Narrowing the
 * index to this turn would have made the gate's old sentence true and been the
 * wrong fix: it would flag every honest follow-up — "and what about that
 * disk?" legitimately leans on the previous turn's rows — and a check that
 * cries wolf is a check somebody turns off. The corpus keeps its reach; only
 * the REPORT gained a time axis.
 *
 * WHAT THE CORPUS ACTUALLY REACHES, said plainly because a bound that is
 * implied is a bound that drifts: `scope.history` as it stands at judgement,
 * which under `.window()` / `.compaction()` / `tokenBudget` is the LIVE WINDOW
 * (window.ts rewrites it in place). So the turn ordinals here count the user
 * turns the run can still SEE — "turn 2 of 4" may be the conversation's turn 9
 * of 13 — and the distance reported is a FLOOR. The boundary itself is exact
 * whatever the window does, because the current request is un-droppable by
 * every window strategy. And a value that reached the model through
 * `.memory()` recall or RAG is EXEMPT from grounding altogether, so it is
 * invisible here: this check can under-report and can never over-report.
 *
 * THE CEILING, and it is the whole reason this is an advisory: see
 * {@link PRIOR_TURN_EVIDENCE_CEILING}. Referring back is not a defect. NOTHING
 * IN THIS FILE CAN TELL a legitimate reference from a stale one, and nothing
 * in this file pretends to — the same finding is filed for both.
 *
 * WHAT KEEPS THE HONEST FOLLOW-UP QUIET. One grounded value from this turn's
 * own results is enough to say nothing. That is not a heuristic threshold: the
 * claim being made is "EVERY value came from before this turn", and one that
 * did not falsifies it outright. In practice a follow-up that calls a tool
 * gets this for free, because a lookup keyed on an earlier identifier echoes
 * that identifier back in its own result — so the value is re-served this turn
 * and re-stamped with this turn's number.
 *
 * Detection only. Nothing here blocks, revises, rewrites or delays anything;
 * the answer the caller receives is the answer the model wrote, and the
 * evidence gate's own posture keeps every decision it ever had.
 */

import type { Assertion, SubjectRef } from '../assertion/types.js';
import type { Disposition } from '../disposition/types.js';
import type { ContextError } from '../finding/types.js';

/**
 * THE CEILING, as one string with one owner.
 *
 * Quoted verbatim into every finding's message, into the check's README and
 * into its docs page, so the bound cannot drift out of one of them and leave a
 * reader thinking the library knows more than it does.
 */
export const PRIOR_TURN_EVIDENCE_CEILING =
  'An answer that legitimately refers back to an earlier result is indistinguishable, by evidence ' +
  'alone, from one that has gone stale: this reports WHERE the values came from and never whether ' +
  'they were still the ones the reader wanted. It counts only the turns still in the live window, ' +
  'so the distance it names is a floor, and values the run supplied rather than fetched (the ' +
  'prompt, a fact, a recalled passage) are exempt from grounding and invisible to it. A place to ' +
  'look, never a verdict that anything is wrong.';

/**
 * What the library could read about one judged answer's grounding.
 *
 * Produced by the evidence gate (`checkAnswer`), which is the only component
 * that knows both which tokens in the answer are DATA and which of them the
 * index could ground. Passed IN rather than re-derived here, for the reason
 * `readLookupResult` takes `declaredAbsence` as a parameter: the extractor has
 * exactly one owner, and a second reading of "what counts as a value" would
 * eventually disagree with the first.
 */
export interface AnswerGroundingReading {
  /** Grounded values whose newest source is a result THIS turn served. */
  readonly fromThisTurn: number;
  /** Grounded values whose newest source is older than the turn in progress. */
  readonly fromPriorTurns: number;
  /**
   * The newest turn any of those older values came from. Absent when
   * `fromPriorTurns` is 0. This is the number a reader wants first: "turn 2,
   * and we are on turn 4".
   *
   * Counted over the user turns still in the run's window, so under a window
   * strategy it is not the conversation's own ordinal and the distance from
   * `currentTurn` is a FLOOR.
   */
  readonly latestPriorTurn?: number;
  /**
   * The turn in progress, on the same window-relative scale. `0` = the
   * history carries no user turn at all, and then there is no boundary to
   * measure against.
   */
  readonly currentTurn: number;
  /** How many `role: 'tool'` results this turn served. `0` is the sharp case. */
  readonly toolResultsThisTurn: number;
  /**
   * The evidence index hit its ceiling and is INCOMPLETE. A partial index can
   * miss the very occurrence that would have stamped a value with this turn,
   * so provenance from one is not something to file on.
   */
  readonly indexTruncated: boolean;
}

/** One judged answer's outcome: the findings, and the disposition it earns. */
export interface PriorTurnEvidenceEncounter {
  readonly findings: readonly ContextError[];
  /**
   * The ledger row this judgement files — computed HERE, beside the rules
   * that decide it, so "the library refused to judge this answer" is provable
   * without a live agent.
   */
  readonly disposition: Disposition;
}

/** The one subject: the answer this turn is about to hand back. */
const ANSWER: SubjectRef = { kind: 'answer', id: 'final' };

/**
 * Judge one finished answer's grounding provenance.
 *
 * @param reading what the evidence gate could see of the answer's values.
 * @param epoch the run iteration, stamped on every witness.
 */
export function priorTurnEvidenceOf(
  reading: AnswerGroundingReading,
  epoch: number,
): PriorTurnEvidenceEncounter {
  // A half-read corpus cannot be trusted about WHEN a value was served: the
  // occurrence that would have stamped it with this turn may be one of the
  // ones the ceiling cut off. The gate already downgrades itself to
  // record-only here; this refuses to file at all. Out of scope BY RULE.
  if (reading.indexTruncated) return { findings: [], disposition: 'not-applicable' };
  // No boundary in the conversation — nothing to be "before". Not a pass: the
  // check could not run. `unreachable` is the family's word for exactly that,
  // and it is the falsification instrument here: a `prior-turn-evidence` row
  // dominated by `unreachable` means answers are being judged against
  // histories that carry no user turn, and this check is watching a seam that
  // does not exist in that app.
  if (reading.currentTurn === 0) return { findings: [], disposition: 'unreachable' };
  // The answer named no value the index could ground — every token in it was
  // prose, or the user's own, or already flagged as unsupported by the gate.
  // There is no provenance to report, so there is nothing to compare.
  if (reading.fromThisTurn === 0 && reading.fromPriorTurns === 0) {
    return { findings: [], disposition: 'unreachable' };
  }
  // ONE value from this turn's own results is enough. The claim is "every
  // value came from before this turn", and one that did not falsifies it.
  if (reading.fromThisTurn > 0) return { findings: [], disposition: 'checked-pass' };

  const total = reading.fromPriorTurns;
  const from = reading.latestPriorTurn;
  const age = from === undefined ? undefined : reading.currentTurn - from;
  // THE STRONG TELL, and it is deliberately the SAME finding rather than a
  // second kind. A turn that served no tool results at all sourced every
  // value from history by construction — no index required — so it is a
  // cheaper PROOF of the identical fact, not a different defect. Splitting it
  // out would fragment one class by how easily it was noticed, which is the
  // opposite of what a finding corpus is for, and would make the disposition
  // ledger report two rows for one seam. It rides as its own witness and as a
  // clause in the message, so a reader can still see which case they are in.
  const fetchedNothing = reading.toolResultsThisTurn === 0;
  const witnesses: Assertion[] = [
    {
      subject: ANSWER,
      predicate: 'grounding',
      value: `${total} grounded value(s), none of them served by this turn`,
      epoch,
      stratum: 'asserted',
      provenance:
        "the evidence gate's index of `role: 'tool'` results, each form stamped with the " +
        'latest turn that served it',
    },
    {
      subject: { kind: 'turn', id: String(from) },
      predicate: 'grounding',
      value: 'served the newest result the answer drew on',
      epoch,
      stratum: 'asserted',
      provenance:
        `turn ${String(from)} of the turns still in this run's window, at least ${String(age)} ` +
        `turn(s) before the one being answered`,
    },
    {
      subject: ANSWER,
      predicate: 'tool-results-this-turn',
      value: reading.toolResultsThisTurn,
      epoch,
      stratum: 'asserted',
      provenance: fetchedNothing
        ? 'this turn served no tool results at all, so every value in the answer came from ' +
          'history by construction'
        : 'this turn served tool results, and none of them carried a value the answer states',
    },
  ];

  return {
    disposition: 'checked-fail',
    findings: [
      {
        kind: 'prior-turn-evidence',
        seam: 'claim',
        subjects: [ANSWER],
        // ONE relation, so one run files at most one of these however many
        // passes judge the answer — a revision that is still sourced from
        // history is the same observation, not a second one.
        predicate: 'grounding',
        witnesses,
        epoch,
        // Doubt, not contradiction. Counted apart from real defects
        // everywhere the family reports, because this check can never know it
        // found one.
        advisory: true,
        message:
          `the final answer states ${total} value(s) the run can ground, and every one of them ` +
          `was last served in turn ${String(from)} or earlier — at least ${String(age)} turn(s) ` +
          `before the turn being answered — while turn ${String(reading.currentTurn)}, the one ` +
          `being answered, contributed none of them. ` +
          (fetchedNothing
            ? 'This turn called no tool and served no result, so the answer was assembled ' +
              'entirely from the conversation. '
            : `This turn served ${String(reading.toolResultsThisTurn)} tool result(s) and the ` +
              'answer states no value from any of them. ') +
          `${PRIOR_TURN_EVIDENCE_CEILING} Nothing here blocked the answer, revised it or ` +
          `changed a byte of it.`,
      },
    ],
  };
}
