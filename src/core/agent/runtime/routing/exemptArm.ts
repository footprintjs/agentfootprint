/**
 * exemptArm — what the evidence gate exempts this turn beyond the person's
 * message and the app's text, built ONCE per run for BOTH moments it judges
 * at: the answer (the route decider, `routeFactory.ts`) and the dispatch
 * moment of the contingent check (the tool-calls stage, `toolCalls/factory.ts`
 * → `stages/toolCalls/evidence/towers.ts`). Both hand it to the one builder of
 * the set, `stages/turnExempt.ts` · `exemptForTurn`.
 *
 * Why one builder: the two moments used to build two different sets. The
 * dispatch moment knew only the person's message and the app's text, so a
 * value the person had given the library's batch ask (or a declared default
 * this turn assumed, or a time the person said) filed a contingent row at the
 * next call while the answer moment treated the same value as exempt.
 *
 * @example
 * ```ts
 * const arm = evidenceExemptArm(configuration, inputsArmed, resolve);
 * // arm?.answeredValues(scope) → the person's batch-ask answers this turn
 * ```
 */

import { answeredValuesOf, declaredDefaultsFrom, type InputsRouteArm } from '../../stages/route.js';
import type { buildToolResolver } from '../../stages/toolResolver.js';
import { isRefused, rulesOf } from '../../../../tools/declare.js';
import type { AgentConfiguration } from '../configuration/types.js';

/**
 * The arm, present only with the inputs layer AND the evidence gate armed:
 * `declaredDefaults` read off the tool that answers the name (the shared
 * dispatch resolver), the batch ask's answers, and under `.time()` the time
 * lineage flag.
 */
export function evidenceExemptArm(
  configuration: Pick<AgentConfiguration, 'evidenceGate' | 'timeOptions'>,
  inputsArmed: boolean,
  resolve: ReturnType<typeof buildToolResolver>,
): InputsRouteArm | undefined {
  if (!inputsArmed || configuration.evidenceGate === undefined) return undefined;
  return {
    declaredDefaults: declaredDefaultsFrom((toolName, argument) => {
      const rules = rulesOf(resolve(toolName).tool);
      if (rules === undefined || isRefused(rules)) return undefined;
      return rules.ruled.find((r) => r.argument === argument)?.assume;
    }),
    answeredValues: answeredValuesOf,
    // Under `.time()` (step T7): said time spellings exempt, derived ones filed, not flagged.
    ...(configuration.timeOptions !== undefined && { timeLineage: true as const }),
  };
}
