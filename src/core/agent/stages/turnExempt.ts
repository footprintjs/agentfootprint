/**
 * stages/turnExempt — THE exempt set of this turn: what the person, the app
 * and the library's own ask supplied, which no evidence check may flag.
 *
 * One builder for both moments the evidence gate judges at: the answer
 * (`route.ts` · `judgeEvidence`) and the dispatch moment of the contingent
 * check (`toolCalls/evidence/towers.ts` · `towersFor`). Both are handed the
 * same arm, built once by `runtime/routing/exemptArm.ts`. Before, the
 * dispatch moment built its own smaller set, so a value the person had given
 * the batch ask filed a contingent row at the next call and nothing at the
 * answer.
 *
 * @example
 * ```ts
 * const exempt = exemptForTurn(scope, history, arm, timeSaid);
 * exempt.has(normalizeToken('ARR-2291')); // true when the person answered it this turn
 * ```
 */

import type { TypedScope } from 'footprintjs';
import type { LLMMessage } from '../../../provider-contract/types.js';
import type { InjectionRecord } from '../../../recorders/core/types.js';
import { exemptFromRun } from '../evidence/evidenceIndex.js';
import type { AgentState } from '../types.js';
import type { InputsRouteArm, TimeLineage } from './route.js';

/**
 * The time-lineage reader for an armed arm (`InputsRouteArm.timeLineage`),
 * loaded through `import()` — `undefined` when `.time()` is not armed, so the
 * resolver stays off a plain agent's graph (the optional-family law). Reads no
 * scope, so loading it before the judges moves no read in the trace.
 */
export async function loadTimeLineage(
  inputs: InputsRouteArm | undefined,
): Promise<TimeLineage | undefined> {
  if (inputs?.timeLineage !== true) return undefined;
  return (await import('./timeLineage.js')).timeLineageOf;
}

/** The exempt set, from the served `history`, the arm and the time the person said. */
export function exemptForTurn(
  scope: TypedScope<AgentState>,
  history: readonly LLMMessage[],
  inputs: InputsRouteArm | undefined,
  timeSaid: readonly string[] | undefined,
): ReadonlySet<string> {
  return exemptFromRun({
    userMessage: scope.userMessage as string | undefined,
    history,
    systemPromptInjections: scope.systemPromptInjections as readonly InjectionRecord[] | undefined,
    ...(inputs?.declaredDefaults !== undefined && {
      declaredDefaults: inputs.declaredDefaults(scope),
    }),
    ...(inputs?.answeredValues !== undefined && {
      answeredValues: inputs.answeredValues(scope),
    }),
    ...(timeSaid !== undefined && { timeSaid }),
  });
}
