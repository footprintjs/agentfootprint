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
