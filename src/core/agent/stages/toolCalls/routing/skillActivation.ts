import type {
  CallResultCell,
  CallExecution,
  CallSkillRoute,
  CallArguments,
} from '../contracts/callCells.js';
import type { TypedScope } from 'footprintjs';
import type { AgentState } from '../../../types.js';
import type { ToolCallsHandlerDeps } from '../contracts/handlerDeps.js';
import type { DispatchCall } from '../contracts/batchCall.js';

interface ActivateLandedSkillFrame {
  readonly tc: DispatchCall;
  readonly outcome: CallResultCell;
  readonly execution: CallExecution;
  readonly skillRoute: CallSkillRoute;
  readonly callArguments: CallArguments;
}

/** The existing synchronous skillActivation phase; no new await or checkpoint carrier. */
export function activateLandedSkill(
  scope: TypedScope<AgentState>,
  deps: Pick<ToolCallsHandlerDeps, 'allowedSkillIds' | 'engagementPlan'>,
  frame: ActivateLandedSkillFrame,
): void {
  // (2) `read_skill` is the auto-attached activation tool.
  //     When the LLM calls it with a valid Skill id, append
  //     to `activatedInjectionIds` so the InjectionEngine's
  //     NEXT pass activates that Skill (lifetime: turn — stays
  //     active until the turn ends).
  if (
    frame.tc.name === 'read_skill' &&
    !frame.outcome.error &&
    !frame.execution.denied &&
    !frame.skillRoute.skillRejected
  ) {
    const requestedId = (frame.callArguments.callArgs as { id?: unknown }).id;
    if (typeof requestedId === 'string' && requestedId.length > 0) {
      const current = scope.activatedInjectionIds as readonly string[];
      if (!current.includes(requestedId)) {
        scope.activatedInjectionIds = [...current, requestedId];
      }
      // (3) The same call is also a MOVE through the graph. `read_skill`
      //     answers "activated for the next iteration", and for a skill
      //     whose activation is cursor-gated (a route target, an exclusive
      //     entry) or rule-gated (an intent entry whose rule didn't match)
      //     appending the id alone never made that true — the sentence was
      //     a promise the engine didn't keep. Record the pick the gate just
      //     accepted; the Injection Engine hands it to `graph.nextSkill`,
      //     which moves the cursor unless a declared edge fired first.
      //     Last accepted pick of a parallel batch wins the cursor; all of
      //     them still land in `activatedInjectionIds`.
      //
      //     Only a HOP moves the cursor. An OPEN skill (one the graph never
      //     wires) is not a node, so parking the cursor on it would strand
      //     the graph: every route trigger reads `nextSkill(ctx) === id`, and
      //     from a non-node nothing can fire. It activates through its own
      //     `llm-activated` trigger and the graph stays exactly where it was.
      if (deps.allowedSkillIds && frame.skillRoute.skillHop) scope.pendingSkillPick = requestedId;
      // The kernel's per-pass feed: every pick the gate accepted, hop
      // or not. A re-engagement is here and NOT in `pendingSkillPick`,
      // which is the whole point — it changes engagement, not position.
      if (deps.engagementPlan) {
        const picks = (scope.acceptedSkillPicks as readonly string[] | undefined) ?? [];
        if (!picks.includes(requestedId)) {
          scope.acceptedSkillPicks = [...picks, requestedId];
        }
      }
    }
  }
}
