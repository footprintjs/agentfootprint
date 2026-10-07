/**
 * breakFinal — terminal stage of the agent's "Final" branch subflow.
 *
 * Fires after the (optional) memory-write subflows have persisted the
 * (user, assistant) pair. `$break()` stops execution before the outer
 * loopTo can re-enter the ReAct loop, ending the iteration cleanly.
 * Returns `scope.finalContent` so the parent's `outputMapper` can
 * surface it as the agent's response.
 *
 * Mounted in the final-branch subflow (built in `buildAgentChart`) as
 * the LAST stage. The parent agent chart mounts the final-branch
 * subflow under the Route decider's `'final'` branch with
 * `propagateBreak: true`, so this $break terminates the outer ReAct
 * loop too.
 */

import type { TypedScope } from 'footprintjs';
import type { AgentState } from '../types.js';

/**
 * Pure stage function — no dependencies, no closure over Agent state.
 * Exported as a const, not a factory, since there's nothing to inject.
 */
export const breakFinalStage = (scope: TypedScope<AgentState>): string => {
  scope.$break();
  return scope.finalContent;
};

/** The configured branch must carry its capture proof across the boundary.
 * A branch output mapper receives this result, not the child scope. */
export const breakFinalWithValidationStage = (
  scope: TypedScope<AgentState>,
): { finalContent: string; answerValidationCommitted: boolean } => {
  scope.$break();
  return {
    finalContent: scope.finalContent,
    answerValidationCommitted: scope.answerValidationCommitted === true,
  };
};

/** A validated answer, as it leaves the Final branch (`breakFinalWithValidationStage`). */
export interface ValidatedDelivery {
  readonly finalContent: string;
  readonly answerValidationCommitted: boolean;
}

/** Whether a Final-branch result is a validated answer — the one object shape this file returns. */
export function isValidatedDelivery(value: unknown): value is ValidatedDelivery {
  if (typeof value !== 'object' || value === null) return false;
  const v = value as Partial<ValidatedDelivery>;
  return (
    Object.keys(value).length === 2 &&
    typeof v.finalContent === 'string' &&
    typeof v.answerValidationCommitted === 'boolean'
  );
}

/**
 * What the Final branch writes back onto the agent's state. A validated answer
 * leaves as {@link ValidatedDelivery} and is written; a validated run that was
 * REFUSED ends the branch with no result and writes nothing, so the agent's
 * `finalContent` stays as it was. An unvalidated answer leaves as the chart's
 * RESULT (a string), and this key has always been written empty — a refused
 * one is written empty too, never the refused text.
 */
export function finalBranchOutput(sf: unknown, validated: boolean): Record<string, unknown> {
  if (!validated) return { finalContent: undefined };
  if (!isValidatedDelivery(sf)) return {};
  return {
    finalContent: sf.finalContent,
    ...(sf.answerValidationCommitted && { answerValidationCommitted: true }),
  };
}
