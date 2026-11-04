/** One-job type contract owner; canonical exports remain with its facade. */

import type { ResolvedScriptTravel } from '../scripts/types.js';
// ─── The answer layer (honesty layer 4) ─────────────────────────────────

/** Which PrepareFinal body the final branch mounts — the arms both chart builders read. */
export interface FinalStageArms {
  readonly hasAnswerValidation?: boolean;
  readonly releaseOutputTokens?: true;
  readonly coverageLimitsAsData?: boolean;
  readonly attachCoverageLimits?: boolean;
  /** The inputs layer is armed; `rewrites` — a before-tool chain can rewrite a filled value. */
  readonly inputsLayer?: { readonly rewrites?: true };
  /**
   * The answer layer is armed; `standingLine` — its one line travels with a
   * prose answer, in the answers its mode says it for (`'always'` for
   * `standingLine: true`).
   */
  readonly answerLayer?: {
    readonly standingLine?: import('../assessment/compose.js').StandingLineWhen;
  };
  /** The time layer is armed — the limits block's `Period:` lines render in the clock's zone. */
  readonly timeLayer?: true;
  /** The evidence gate's `'rails'` posture — a refused answer is recorded flagged and ends the branch. */
  readonly evidenceRails?: true;
  /**
   * A tool's `displayName`, read through the agent's own tools — present only
   * on an agent where a tool can declare one. The prose limits block then names
   * an item's declaring calls in the app's words (`coverage/answer.ts` ·
   * `composeAnswerWithCoverage`). Absent → the stage each combination of arms
   * has always mounted, same reference, same bytes.
   */
  readonly displayNameOfFor?: (scope: object) => DisplayNameOf;
  /**
   * `.scriptTravelsWithTheAnswer()` — the recorded programs of this turn's
   * code-running calls travel with the answer: as `turn_end.scripts` always,
   * and as text after the `---` separator on a prose answer (`typed` — the
   * answer has an output schema — gets the data only). Absent → the stage
   * each combination of arms has always mounted, same reference, same bytes.
   */
  readonly scriptTravel?: ResolvedScriptTravel & { readonly typed?: true };
}

/** A tool's registered name → the app's words for a call of it, when its tool declares them. */
export type DisplayNameOf = (toolName: string) => string | undefined;
