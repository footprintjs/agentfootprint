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
 * THE SOURCE. What each reason rests on is declared here too, once: `calls`
 * when its rows are about specific tool calls (a result, a coverage row, an
 * argument or period row, a conflict between readings); `answer` when its row
 * is a verdict on the answer itself (a value no result carried, a claim in it,
 * the app's checks on its bytes); `run` when it is about how the run went (a
 * pause still waiting, a limit, unfinished steps, a check that could not reach
 * a verdict). The fold never decides it per run, so "the run" is never an
 * empty list of calls in disguise.
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

import type { AssessmentReason, AssessmentReasonSource, HonestyLayer } from './types.js';

export interface ReasonEntry {
  readonly reason: AssessmentReason;
  /** Absent: the reason belongs to every layer. */
  readonly layer?: HonestyLayer;
  readonly class: 'ask' | 'not-sure';
  /**
   * What the reason rests on, DECLARED here once — never inferred per run
   * (`types.ts` · `AssessmentReasonSource`): `calls` (the calls its rows name,
   * read by `sources.ts` · `reasonSourceOf`), `answer` (the answer itself) or
   * `run` (the run as a whole).
   */
  readonly source: AssessmentReasonSource['kind'];
  /** The committed row it is read from — for the README table and a reviewer, never parsed. */
  readonly reads: string;
}

/** Every reason, in the order the fold reports them: the ask first, then by layer. */
export const REASONS: readonly ReasonEntry[] = Object.freeze([
  {
    reason: 'asked',
    class: 'ask',
    source: 'run',
    reads:
      'pausedToolCallId: the call a pause is still waiting on (requestInput, askHuman / pauseHere, a checkIn, a middleware ask, a credential consent)',
  },
  {
    reason: 'argument-asked',
    layer: 2,
    class: 'ask',
    source: 'run',
    reads:
      "argumentAsk: the inputs layer's batch ask with a question still out (`waiting`) — nothing in that batch has run; the findingsLedger's current `asked` rows of this turn name the values",
  },
  {
    reason: 'argument-assumed',
    layer: 2,
    class: 'not-sure',
    source: 'calls',
    reads:
      "findingsLedger: an argument row of this turn with source 'default' (the tool's rule assumed the value); or middlewareDecisions: a before-tool rewrite of a ruled argument (changedKeys) with no declared origin",
  },
  {
    reason: 'argument-unverified',
    layer: 2,
    class: 'not-sure',
    source: 'calls',
    reads:
      "findingsLedger: an argument row of this turn with source 'model' on a ruled or period argument, or with a failed declared-source check (on any argument)",
  },
  {
    reason: 'argument-read',
    layer: 2,
    class: 'not-sure',
    source: 'calls',
    reads:
      "findingsLedger: an argument row of this turn with source 'said' and reading — the person's words were found, the value is the model's reading of them (under an ask rule it asked instead)",
  },
  {
    reason: 'value-contingent',
    layer: 2,
    class: 'not-sure',
    source: 'calls',
    reads:
      "findingsLedger: an argument row of this turn with source 'result' and setAside (the model named a result it had set aside); or a contingent row of this turn",
  },
  {
    reason: 'coverage-gap',
    layer: 3,
    class: 'not-sure',
    source: 'calls',
    reads:
      "coverageDeclared: a notChecked or cannotCover item on a call of this turn; or history: the result's own envelope lists one, when its call has no coverage row",
  },
  {
    reason: 'declared-absent',
    layer: 3,
    class: 'not-sure',
    source: 'calls',
    reads:
      "coverageDeclared: an absence on a call of this turn; or history: an empty rowset inside a declared coverage() boundary, or an absence in the result's own envelope when its call has no coverage row (the one emptiness reader)",
  },
  {
    reason: 'empty-undeclared',
    layer: 3,
    class: 'not-sure',
    source: 'calls',
    reads:
      'history: an empty rowset (a top-level array, the app’s rowsAt key, or the dataset ticket left where those rows were, counting 0) whose call has no coverage row',
  },
  {
    reason: 'period-not-held',
    layer: 3,
    class: 'not-sure',
    source: 'calls',
    reads:
      "findingsLedger: a period row of this turn with verdict 'not-held' — the store holds none of what the read asked for (and, when the tool declares a ToolPeriod, the inputs layer's argument row for the same call: who chose the period)",
  },
  {
    reason: 'period-partly-held',
    layer: 3,
    class: 'not-sure',
    source: 'calls',
    reads: "findingsLedger: a period row of this turn with verdict 'partly-held'",
  },
  {
    reason: 'period-unknown',
    layer: 3,
    class: 'not-sure',
    source: 'calls',
    reads:
      "findingsLedger: a period row of this turn with verdict 'unknown' — the tool declared held: 'unknown'",
  },
  {
    reason: 'period-undeclared',
    layer: 3,
    class: 'not-sure',
    source: 'calls',
    reads:
      "findingsLedger: a period row of this turn with verdict 'undeclared' — the tool declares a ToolPeriod and the result declared no period",
  },
  {
    reason: 'period-differs-from-asked',
    layer: 3,
    class: 'not-sure',
    source: 'calls',
    reads:
      "findingsLedger: a period row of this turn with differs (the time layer, step T8) — what the call read is not the range it asked for (missing: asked, not read; extra: read, not asked — TQ8: extra alone is 'not sure' too), or, for a window the model chose, not the person's window",
  },
  {
    reason: 'period-beyond-retention',
    layer: 3,
    class: 'not-sure',
    source: 'calls',
    reads:
      'findingsLedger: a period row of this turn with beyondRetention (the time layer, step T8) — the window was wholly older than the tool declares its source keeps: refused before dispatch, or read that way',
  },
  {
    reason: 'sources-conflict',
    layer: 3,
    class: 'not-sure',
    source: 'calls',
    reads:
      'findingsLedger: a conflict row of this turn — its witnesses name a call of this turn, or it is stamped with this turn and the record does not place every witness in an earlier turn (assess.ts · conflictOfThisTurn)',
  },
  {
    reason: 'value-unsupported',
    layer: 4,
    class: 'not-sure',
    source: 'answer',
    reads: 'unsupportedValues (revised: false)',
  },
  {
    reason: 'value-survived-revision',
    layer: 4,
    class: 'not-sure',
    source: 'answer',
    reads: 'unsupportedValues (revised: true)',
  },
  {
    reason: 'derived-from-reading',
    layer: 4,
    class: 'not-sure',
    source: 'answer',
    reads:
      "findingsLedger: a time-derived row of this turn — the answer states a time value no tool result carried that the library itself spelled from a reading of the person's words (an implied year, an offset, the end-of-grain minute, the served time line)",
  },
  {
    reason: 'script-unmatched',
    layer: 4,
    class: 'not-sure',
    source: 'answer',
    reads:
      "findingsLedger: a script-shown witness row of this turn with label 'unmatched' — a fenced block the answer showed equals no program this turn's calls submitted to a declared code-running tool (filed under code: 'match' while the answer layer is armed)",
  },
  { reason: 'stopped-early', layer: 4, class: 'not-sure', source: 'run', reads: 'stoppedEarly' },
  {
    reason: 'steps-unfinished',
    layer: 4,
    class: 'not-sure',
    source: 'run',
    reads:
      "findingsLedger: a steps-unfinished witness row of this turn (the answer came before the active skill's declared steps finished — filed while the answer layer is armed)",
  },
  {
    reason: 'negative-prose-unverified',
    layer: 4,
    class: 'not-sure',
    source: 'answer',
    reads:
      'findingsLedger: a negative-claim or negative-claim-note row of this turn; model prose never establishes a negative claim',
  },
  {
    reason: 'claim-exceeds-search',
    layer: 4,
    class: 'not-sure',
    source: 'answer',
    reads: 'answerValidation.checks: a typed negative exceeded the admitted search',
  },
  {
    reason: 'declaration-overclaimed',
    layer: 3,
    class: 'not-sure',
    source: 'calls',
    reads:
      "answerValidation.checks: an agent:negative-claims: row with reason 'declaration-overclaimed' — a tool's refusal said more than it read; the row's tools name the tool (negativeClaims/delivery.ts · reportWithNegatives keeps both)",
  },
  {
    reason: 'answer-check-failed',
    layer: 4,
    class: 'not-sure',
    source: 'answer',
    reads: "answerValidation: status 'failed'",
  },
  {
    reason: 'check-unreachable',
    class: 'not-sure',
    source: 'run',
    reads:
      "answerValidation: status 'unverified' (an armed check that could not reach a verdict), or a failed report that also counts unreachable checks or names a reason (a validator that did not finish)",
  },
]);

/** The table entry for one reason. */
export function reasonEntry(reason: AssessmentReason): ReasonEntry {
  const entry = REASONS.find((r) => r.reason === reason);
  // Unreachable while `REASONS` covers the union — pinned by `test/core/agent/assessment`.
  if (entry === undefined) throw new Error(`assessment: no table entry for reason "${reason}"`);
  return entry;
}
