/**
 * answerCoverage — `.limitsTravelWithTheAnswer()` for a TYPED answer: the
 * run's declared limits committed as data beside the answer, never appended
 * to it.
 *
 * Pattern: a decorator over the Route decider (the `withAnswerValidation`
 *          precedent, `./answerValidation.ts`) — it wraps only the terminal
 *          decision and writes in the OUTER scope.
 * Role:    core/ layer. Mounted by `Agent.buildChart` only when the agent has
 *          an output schema AND asked for its limits to travel; every other
 *          agent is handed the decider it always had.
 * Emits:   N/A (the Final branch projects the value onto `turn_end`).
 *
 * ## Why the answer is not touched
 *
 * `.limitsTravelWithTheAnswer()` appends a block of prose to the answer. An
 * answer with an output schema is JSON, and JSON followed by prose is not JSON,
 * so `runTyped()` threw on every answer that had limits. The limits now travel
 * BESIDE a typed answer: the answer string stays exactly what the model sent
 * (after the Route decider's own peel), and the same fold the block would have
 * printed (`coverage/answer.ts` · `coverageOfAnswer`) is committed as
 * `AgentState.answerCoverage`.
 *
 * ## Why here, and not in PrepareFinal
 *
 * PrepareFinal runs inside the Final BRANCH subflow, and a branch mount hands
 * its output mapper the branch's result, not its scope — nothing written there
 * reaches the run's state (`stages/route.ts` · `buildRouteDeciderStage`). The
 * Route decider is the last stage on the main chart, and its writes commit
 * before the branch resolves, so the value lands in the snapshot a caller
 * reads (`agent.answerCoverage()`) and the Final branch receives it through
 * its input mapper to project onto `turn_end`.
 */

import type { TypedScope } from 'footprintjs';
import { coverageOfAnswer } from '../coverage/index.js';
import type { DeclaredCoverage } from '../coverage/index.js';
import type { AgentState } from '../types.js';
import type { RouteBranch } from './route.js';

/**
 * Wrap the Route decider so its terminal decision commits the answer's
 * coverage. Only `'final'` writes, and only when the run's tools declared
 * something — a run with nothing declared commits exactly the keys it would
 * have without the option.
 */
export function withAnswerCoverage(
  decide: (scope: TypedScope<AgentState>) => RouteBranch | Promise<RouteBranch>,
): (scope: TypedScope<AgentState>) => Promise<RouteBranch> {
  return async (scope) => {
    const branch = await decide(scope);
    if (branch !== 'final') return branch;
    const declared = scope.coverageDeclared as readonly DeclaredCoverage[] | undefined;
    const folded = declared === undefined ? undefined : coverageOfAnswer(declared);
    if (folded !== undefined) scope.answerCoverage = folded;
    return branch;
  };
}
