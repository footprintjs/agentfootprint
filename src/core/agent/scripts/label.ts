/**
 * scripts/label — the ONE rule that turns a code call's record into a label,
 * and the label's words.
 *
 * Pattern: pure function over two separate facts (design § 4.3).
 * Role:    core/ layer leaf. Asked by the dispatch loop when it files a call's
 *          `script` row (`rows.ts` · `scriptRowFor`); every sentence that names
 *          an outcome — the attachment's label line, the recovery clause, the
 *          answer account — reads the row's label through {@link labelWords}.
 * Emits:   N/A.
 *
 * ## Three facts, read in one order
 *
 * The record holds three facts about a code call, written by three mechanisms:
 * EXECUTION evidence (the runner's facts — `codeRunnerTool.ts` ·
 * `CodeRunFacts`, taken right after `tool.execute` returns), call SETTLEMENT
 * (did the call return, throw, or never enter `execute`) and result DELIVERY
 * (the tool's ceiling replaced the payload). A label is read from execution
 * evidence first, then settlement, and NEVER from delivery: a withheld result
 * does not undo a completed execution (it rides the row as `resultWithheld`).
 *
 * | the record says | label |
 * |---|---|
 * | an explicit `exitCode: 0` | `completed` |
 * | an explicit non-zero `exitCode` | `completed-with-failure` |
 * | `serviceError` and no exit code | `outcome-unknown` |
 * | `ok: true`, no exit code | `reported-success` |
 * | `ok: false`, no exit code, no service error (a stopped process included) | `reported-failure` |
 * | facts that report no outcome (`ok` absent, no exit code) | — no execution evidence: the settlement decides |
 * | no facts, the call returned | `returned` |
 * | no facts, the call threw (a timeout, a cancellation, a staging refusal) | `outcome-unknown` |
 * | the call never entered `execute` (or has not settled) | `submitted` |
 *
 * Only an explicit exit code proves the program reached an exit. `ok` is a
 * VERDICT: it never yields `completed`, and no word here prints an exit number
 * the record does not hold.
 *
 * @example
 * ```ts
 * scriptLabelOf({ settlement: 'returned', facts: { exitCode: 0 } });          // { label: 'completed', exitCode: 0 }
 * scriptLabelOf({ settlement: 'returned', facts: { ok: false, serviceError: true } }); // { label: 'outcome-unknown', serviceError: true }
 * scriptLabelOf({ settlement: 'threw' });                                      // { label: 'outcome-unknown' }
 * labelWords('completed-with-failure', 7);                                     // 'completed with failure, exit 7'
 * ```
 */

import type { ScriptLabel } from './types.js';

/** How a call settled, as the dispatch loop knows it. */
export type CallSettlement =
  /** Never entered `execute`: not dispatched, refused before it, or still open. */
  | 'not-entered'
  /** `execute` returned a result. */
  | 'returned'
  /** `execute` was entered and threw (a timeout, a cancellation, any error). */
  | 'threw';

/** The runner facts a label reads — `CodeRunFacts`' outcome half. */
export interface RunnerOutcome {
  readonly ok?: boolean;
  readonly exitCode?: number;
  readonly serviceError?: true;
  readonly terminatedBy?: string;
}

/** A label, with the facts it may print. */
export interface ScriptOutcome {
  readonly label: ScriptLabel;
  /** Exactly the runner's, only when it supplied one. */
  readonly exitCode?: number;
  /** The failure verdict was the service's, with no exit code. */
  readonly serviceError?: true;
}

/**
 * The label of one call — execution evidence first, then settlement. `facts`
 * is ABSENT when the tool filed none (a declared tool that is not
 * `codeRunnerTool`, or a call that never reached its runner).
 */
export function scriptLabelOf(input: {
  readonly settlement: CallSettlement;
  readonly facts?: RunnerOutcome;
}): ScriptOutcome {
  const facts = input.facts;
  if (facts !== undefined) {
    if (typeof facts.exitCode === 'number') {
      return {
        label: facts.exitCode === 0 ? 'completed' : 'completed-with-failure',
        exitCode: facts.exitCode,
      };
    }
    if (facts.serviceError === true) return { label: 'outcome-unknown', serviceError: true };
    if (facts.ok === true) return { label: 'reported-success' };
    if (facts.ok === false) return { label: 'reported-failure' };
    // Facts with no outcome in them — the runner reported neither an exit code
    // nor a verdict — are no execution evidence: the settlement decides below.
  }
  switch (input.settlement) {
    case 'not-entered':
      return { label: 'submitted' };
    case 'returned':
      return { label: 'returned' };
    case 'threw':
      return { label: 'outcome-unknown' };
  }
}

/**
 * The label's own words — the one phrase every library sentence about a call's
 * outcome uses (design § 4.3). `exitCode` is printed only for
 * `completed-with-failure`, and only the number the record holds.
 */
export function labelWords(label: ScriptLabel, exitCode?: number): string {
  switch (label) {
    case 'submitted':
      return 'submitted';
    case 'returned':
      return 'tool call returned; execution not confirmed';
    case 'reported-success':
      return 'runner reported success; no exit code';
    case 'reported-failure':
      return 'runner reported failure; no exit code';
    case 'completed':
      return 'completed, exit 0';
    case 'completed-with-failure':
      return exitCode === undefined
        ? 'completed with failure'
        : `completed with failure, exit ${exitCode}`;
    case 'outcome-unknown':
      return 'outcome unknown';
  }
}

/** Every label, in the design's order — for a reader that validates one. */
export const SCRIPT_LABELS: readonly ScriptLabel[] = Object.freeze([
  'submitted',
  'returned',
  'reported-success',
  'reported-failure',
  'completed',
  'completed-with-failure',
  'outcome-unknown',
]);
