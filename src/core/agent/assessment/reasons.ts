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
 * an event, so the running agent and a later reader fold the same bytes. Two
 * verdicts the honesty design names are events only in this version and so
 * cannot be read yet: the `.claims()` dispositions (`claim-contradicted`, and
 * the `checked-pass` rows that would SUPPORT "known"), and the integrity
 * dispositions (`integrity.disposition`). The step that needs each one adds
 * one committed row, and the reason joins this table in the same change — as
 * the answer layer (honesty layer 4) did for two: the evidence gate's clean
 * pass (a `grounded` witness row, read as the names-and-numbers check having
 * run — never as a reason, never as support) and an answer given before its
 * declared steps finished (`steps-unfinished`, below). Both rows are filed only
 * while the answer layer is armed (`assessment/witness.ts`).
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
    reason: 'argument-asked',
    layer: 2,
    class: 'ask',
    reads:
      "argumentAsk: the inputs layer's batch ask with a question still out (`waiting`) — nothing in that batch has run; the findingsLedger's current `asked` rows of this turn name the values",
  },
  {
    reason: 'argument-assumed',
    layer: 2,
    class: 'not-sure',
    reads:
      "findingsLedger: an argument row of this turn with source 'default' (the tool's rule assumed the value); or middlewareDecisions: a before-tool rewrite of a ruled argument (changedKeys) with no declared origin",
  },
  {
    reason: 'argument-unverified',
    layer: 2,
    class: 'not-sure',
    reads:
      "findingsLedger: an argument row of this turn with source 'model' on a ruled or period argument, or with a failed declared-source check",
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
    reason: 'period-not-held',
    layer: 3,
    class: 'not-sure',
    reads:
      "findingsLedger: a period row of this turn with verdict 'not-held' — the store holds none of what the read asked for (and, when the tool declares a ToolPeriod, the inputs layer's argument row for the same call: who chose the period)",
  },
  {
    reason: 'period-partly-held',
    layer: 3,
    class: 'not-sure',
    reads: "findingsLedger: a period row of this turn with verdict 'partly-held'",
  },
  {
    reason: 'period-unknown',
    layer: 3,
    class: 'not-sure',
    reads:
      "findingsLedger: a period row of this turn with verdict 'unknown' — the tool declared held: 'unknown'",
  },
  {
    reason: 'period-undeclared',
    layer: 3,
    class: 'not-sure',
    reads:
      "findingsLedger: a period row of this turn with verdict 'undeclared' — the tool declares a ToolPeriod and the result declared no period",
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
    reason: 'steps-unfinished',
    layer: 4,
    class: 'not-sure',
    reads:
      "findingsLedger: a steps-unfinished witness row of this turn (the answer came before the active skill's declared steps finished — filed while the answer layer is armed)",
  },
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
