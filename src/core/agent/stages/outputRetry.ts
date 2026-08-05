/**
 * outputRetry — the branch that asks again when the answer failed the schema.
 *
 * Mounted as a THIRD branch of the Route decider, and only on an agent that
 * opted into `.outputSchema(parser, { retries })`. It carries `{ loopTo }`
 * to the same target the `tool-calls` branch loops to, which is the whole
 * mechanism: a retry is not a special mode, it is one more ordinary turn of
 * the ReAct loop. The injection engine re-evaluates, the slots recompose,
 * the cache decides, the model is called — so the attempt gets its own
 * `iteration_start` / `llm_start` / `llm_end` bracket and its own `cost.tick`
 * against `costBudget`.
 *
 * That is the difference from the in-stage schema retry the reliability gate
 * has done since v2.13. There, N attempts happen inside ONE `call-llm` stage:
 * one bracket for all of them, and one cost tick carrying only the last
 * attempt's usage — attempts that were genuinely billed and are invisible in
 * the recording. Here every attempt is a turn, and the recording says so.
 *
 * The two layers compose rather than collide. With `.reliability()` also
 * configured, its in-stage rules run FIRST and decide what to do with a
 * response before it is committed; `retries` governs answers that WERE
 * committed and turned out invalid.
 *
 * Pure function apart from its enforcement config — no closure over Agent
 * class state.
 */

import type { TypedScope } from 'footprintjs';
import type { LLMMessage } from '../../../adapters/types.js';
import { typedEmit } from '../../../recorders/core/typedEmit.js';
import {
  buildCorrectiveTurn,
  correctiveMessageHash,
  recordOutputAttempt,
  type ResolvedOutputEnforcement,
} from '../outputEnforcement.js';
import type { AgentState } from '../types.js';

/**
 * Build the retry stage. `enforcement.retries` is the cap the decider already
 * checked before routing here — this stage does the work of asking again.
 */
export function buildOutputRetryStage(
  enforcement: ResolvedOutputEnforcement,
): (scope: TypedScope<AgentState>) => void {
  return (scope) => {
    const iteration = scope.iteration as number;
    const failure = scope.outputSchemaFailure;
    if (failure === undefined) {
      // Unreachable through the decider, which writes the carrier immediately
      // before routing here. Returning quietly rather than throwing keeps a
      // hand-built chart that mounts this branch without the decider from
      // taking down a run over a missing diagnostic.
      return;
    }

    const failedAnswer = scope.llmLatestContent as string;
    const [answerTurn, correctionTurn] = buildCorrectiveTurn(failedAnswer, failure, {
      attempt: failure.attempt,
      // The total the run may spend: the first attempt plus its retries.
      totalAttempts: enforcement.retries + 1,
    });
    const hash = correctiveMessageHash(correctionTurn.content);

    // The conversation, as it really went: the answer that failed, then the
    // correction. A plain local array — a TypedScope array read is a live
    // proxy view, and both the commit and the event payload below must be
    // detached plain data.
    const newHistory: LLMMessage[] = [
      ...(scope.history as readonly LLMMessage[]),
      answerTurn,
      correctionTurn,
    ];
    scope.history = newHistory;

    recordOutputAttempt(scope, {
      attempt: failure.attempt,
      iteration,
      outcome: 'retried',
      stage: failure.stage,
      error: failure.error,
      ...(failure.path !== undefined && { path: failure.path }),
      correctiveMessageHash: hash,
    });

    typedEmit(scope, 'agentfootprint.agent.output_schema_retry', {
      attempt: failure.attempt,
      // What is left AFTER this correction — `0` means this is the last ask.
      retriesRemaining: enforcement.retries - failure.attempt,
      iteration,
      stage: failure.stage,
      error: failure.error,
      ...(failure.path !== undefined && { path: failure.path }),
      correctiveMessageHash: hash,
    });

    // Close this iteration's bracket before the loop turns. Every recorder
    // that synthesizes steps counts on `iteration_start` and `iteration_end`
    // pairing per `iterIndex`, and the crash-checkpoint tracker takes its
    // history snapshot from this payload — so a retry that skipped it would
    // leave a run with one more start than end and a checkpoint one turn
    // behind the conversation.
    typedEmit(scope, 'agentfootprint.agent.iteration_end', {
      turnIndex: 0,
      iterIndex: iteration,
      toolCallCount: 0,
      history: newHistory,
    });

    // A retry consumes an iteration, exactly as a tool call does. It is one
    // more real turn against the agent's declared budget, and the iteration
    // counter is the vocabulary every bracket in the run is keyed on.
    scope.iteration = iteration + 1;
  };
}
