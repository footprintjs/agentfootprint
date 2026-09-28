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
 * ## The assumed values travel with them
 *
 * On an agent whose inputs layer is armed (honesty layer 2), a prose answer's
 * limits section also carries the "Assumed" block — the values a tool's
 * `assume` rule filled this turn. A typed answer carries the same values as
 * data, on the same key: `answerCoverage.assumed`, read from the SAME rows by
 * the SAME reading the block prints from (`arguments/serve.ts` ·
 * `assumedLinesFor`), so the block and the data cannot disagree about which
 * values were assumed. Read only under that arm — a run that armed no inputs
 * layer never reads the ledger here — and `middlewareDecisions` only when the
 * agent has a before-tool chain that can rewrite a filled value.
 *
 * ## Why here, and not in PrepareFinal — and not in the answer layer
 *
 * PrepareFinal runs inside the Final BRANCH subflow, and a branch mount hands
 * its output mapper the branch's RESULT (the answer string), not its scope —
 * nothing written there reaches the run's state (`stages/route.ts` ·
 * `buildRouteDeciderStage`). The answer layer (honesty layer 4) heads that
 * same branch, so it cannot write the key back either, and the key must exist
 * whether or not that layer is armed: one writer, here. The Route decider is
 * the last stage on the main chart, and its writes commit before the branch
 * resolves, so the value lands in the snapshot a caller reads
 * (`agent.answerCoverage()`) and the Final branch receives it through its
 * input mapper to project onto `turn_end`.
 */

import type { TypedScope } from 'footprintjs';
import { answerCoverageOf, coverageOfAnswer } from '../coverage/index.js';
import type { AnswerCoverage, DeclaredCoverage } from '../coverage/index.js';
import type { FindingsLedger } from '../findings/types.js';
import type { AgentState } from '../types.js';
import type { RouteBranch } from './route.js';

/**
 * The inputs layer is armed (honesty layer 2): the typed answer's limits
 * carry this turn's assumed values too. `rewrites` — the agent has a
 * before-tool middleware chain, so a filled value may have been rewritten
 * (the row is then left out, as the block leaves it out).
 */
export interface AnswerCoverageInputsArm {
  readonly rewrites: boolean;
}

/** This turn's assumed values — the block's own reading, loaded under the arm only. */
async function assumedValuesOf(
  scope: TypedScope<AgentState>,
  inputs: AnswerCoverageInputsArm,
): Promise<NonNullable<AnswerCoverage['assumed']>> {
  const ledger = [...((scope.findingsLedger as FindingsLedger | undefined) ?? [])];
  if (!ledger.some((row) => row.kind === 'argument')) return [];
  const { assumedLinesFor } = await import('../arguments/serve.js');
  return assumedLinesFor(
    ledger,
    scope.turnNumber as number,
    inputs.rewrites
      ? () => [...((scope.middlewareDecisions as readonly unknown[] | undefined) ?? [])]
      : undefined,
  );
}

/**
 * Wrap the Route decider so its terminal decision commits the answer's
 * limits. Only `'final'` writes, and only when the run's tools declared
 * something or (under the inputs layer's arm) a value was assumed — a run
 * with neither commits exactly the keys it would have without the option.
 */
export function withAnswerCoverage(
  decide: (scope: TypedScope<AgentState>) => RouteBranch | Promise<RouteBranch>,
  inputs?: AnswerCoverageInputsArm,
): (scope: TypedScope<AgentState>) => Promise<RouteBranch> {
  return async (scope) => {
    const branch = await decide(scope);
    if (branch !== 'final') return branch;
    const declared = scope.coverageDeclared as readonly DeclaredCoverage[] | undefined;
    const folded = declared === undefined ? undefined : coverageOfAnswer(declared);
    const assumed = inputs === undefined ? [] : await assumedValuesOf(scope, inputs);
    const limits = answerCoverageOf(folded, assumed);
    if (limits !== undefined) scope.answerCoverage = limits;
    return branch;
  };
}
