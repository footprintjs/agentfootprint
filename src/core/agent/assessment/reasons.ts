/**
 * reasons — the closed table of why an answer does not stand.
 *
 * Pattern: one frozen table, the ONE owner of each reason's layer, class and
 *          the committed row it is read from. `assess.ts` fires reasons in
 *          this table's order; a reader renders them from it.
 * Role:    core/ layer leaf, pure data.
 *
 * THE CLASS. `ask` is a reason the person can settle by answering a question
 * the run already put to them — the turn ENDED in a pause waiting on a
 * person's reply (a typed input, a question, a consent gate). Every other
 * reason is `not-sure`: the library cannot ask at the answer (the call that
 * could have used an answer has already run, and the library never replaces
 * the model's reply with a question), so an absence renders "not sure — what
 * was searched", never "ask".
 *
 * WHAT IS NOT HERE, AND WHY. A reason is read from a COMMITTED row, never from
 * an event, so the running agent and a later reader fold the same bytes. Three
 * verdicts the honesty design names are events only in this version and so
 * cannot be read yet: the evidence gate's clean pass (`agent.evidence_checked`),
 * the `.claims()` dispositions (`claim-contradicted`, and the `checked-pass`
 * rows that would SUPPORT "known"), and the integrity dispositions
 * (`integrity.disposition`). The step that needs each one adds one committed
 * row, and the reason joins this table in the same change.
 */

import type { AssessmentReason, HonestyLayer } from './types.js';

export interface ReasonEntry {
  readonly reason: AssessmentReason;
  /** Absent: the reason belongs to every layer. */
  readonly layer?: HonestyLayer;
  readonly class: 'ask' | 'not-sure';
  /** The committed row it is read from — for the README table and a reviewer, never parsed. */
  readonly reads: string;
}

/** Every reason, in the order the fold reports them: the ask first, then by layer. */
export const REASONS: readonly ReasonEntry[] = Object.freeze([
  {
    reason: 'asked',
    class: 'ask',
    reads:
      'pausedToolCallId: the call a pause is still waiting on (requestInput, askHuman / pauseHere, a checkIn, a middleware ask, a credential consent)',
  },
  {
    reason: 'coverage-gap',
    layer: 3,
    class: 'not-sure',
    reads:
      "coverageDeclared: a notChecked or cannotCover item on a call of this turn; or history: the result's own envelope lists one, when its call has no coverage row",
  },
  {
    reason: 'declared-absent',
    layer: 3,
    class: 'not-sure',
    reads:
      "coverageDeclared: an absence on a call of this turn; or history: an empty rowset inside a declared coverage() boundary, or an absence in the result's own envelope when its call has no coverage row (the one emptiness reader)",
  },
  {
    reason: 'empty-undeclared',
    layer: 3,
    class: 'not-sure',
    reads:
      'history: an empty rowset (a top-level array, or the app’s rowsAt key) whose call has no coverage row',
  },
  {
    reason: 'sources-conflict',
    layer: 3,
    class: 'not-sure',
    reads: 'findingsLedger: a conflict row whose witnesses name a call of this turn',
  },
  {
    reason: 'value-unsupported',
    layer: 4,
    class: 'not-sure',
    reads: 'unsupportedValues (revised: false)',
  },
  {
    reason: 'value-survived-revision',
    layer: 4,
    class: 'not-sure',
    reads: 'unsupportedValues (revised: true)',
  },
  { reason: 'stopped-early', layer: 4, class: 'not-sure', reads: 'stoppedEarly' },
  {
    reason: 'answer-check-failed',
    layer: 4,
    class: 'not-sure',
    reads: "answerValidation: status 'failed'",
  },
  {
    reason: 'check-unreachable',
    class: 'not-sure',
    reads: "answerValidation: status 'unverified' (an armed check that could not reach a verdict)",
  },
]);

/** The table entry for one reason. */
export function reasonEntry(reason: AssessmentReason): ReasonEntry {
  const entry = REASONS.find((r) => r.reason === reason);
  // Unreachable while `REASONS` covers the union — pinned by `test/core/agent/assessment`.
  if (entry === undefined) throw new Error(`assessment: no table entry for reason "${reason}"`);
  return entry;
}
