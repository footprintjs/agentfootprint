/**
 * wrapUp — the branch that asks for a real answer when the action budget
 * runs out mid-task (9.56.0).
 *
 * Mounted as a branch of the Route decider on any agent that can call tools,
 * unless `wrapUpAtMaxIterations: false` turned it off. It carries `{ loopTo }`
 * to the same target the `tool-calls` branch loops to — the SchemaRetry
 * mechanism verbatim: a wrap-up is not a special mode, it is one more ordinary
 * turn of the ReAct loop, with its own `iteration_start` / `llm_start` /
 * `llm_end` bracket and its own `cost.tick` against `costBudget`.
 *
 * ## What it exists to stop
 *
 * `maxIterations` is a cap on ACTIONS, and the model does not know it is about
 * to be hit. Before this, a turn that reached the cap while the model was
 * still asking for tools handed back whatever text happened to ride that last
 * call — which, mid-task, is a fragment:
 *
 *   > "The third finding focus is not settling… Let me check what's on screen
 *   > now:"
 *
 * That sentence reached the person as if it were the answer, under an `'ok'`
 * status, with nothing anywhere saying the budget had run out. Two recorded
 * runs of exactly that shape are why this branch exists.
 *
 * ## Why the tools come off
 *
 * The one thing the run must not do is spend this call the way it spent the
 * last ten. Withholding the tools is what makes the call terminal BY
 * CONSTRUCTION rather than by another rule: with nothing to ask for, the model
 * can only answer, so the wrap-up is exempt from `maxIterations` without any
 * risk of looping past it. The withholding itself happens at request assembly
 * in `callLLM` (the one seam that decides what goes on the wire); this stage
 * only raises the flag.
 *
 * ## What it appends
 *
 * One `role: 'user'` message, authored by the framework, and NOT the fragment
 * that preceded it. The model's tool-asking turn was never appended to history
 * (nothing ran, so nothing round-tripped), and putting the half-sentence back
 * as an assistant turn would invite the model to continue it — which is the
 * opposite of the ask. The fragment is not lost: it is committed as
 * `llmLatestContent`, where the run's own record keeps it.
 *
 * Pure function — no closure over Agent class state, no deps.
 */

import type { TypedScope } from 'footprintjs';
import type { LLMMessage } from '../../../adapters/types.js';
import { typedEmit } from '../../../recorders/core/typedEmit.js';
import type { AgentState } from '../types.js';

/**
 * The instruction the wrap-up call carries, verbatim.
 *
 * Exported so tests, docs and consumers read the one string the wire reads —
 * a sentence quoted in three places and defined in none is how documentation
 * starts lying. It is written to be answerable from what the turn already
 * has: no new lookups, an honest split between done and not-done, and room
 * for the thing the person most needs to hear.
 */
export const WRAP_UP_INSTRUCTION =
  'Your action budget for this turn is exhausted. Do not request tools. ' +
  'Give your best final answer from what you have: what you completed, ' +
  'what remains undone, and anything the person should know.';

/**
 * The stage body. The decider has already established the whole table (the
 * iteration budget ran out, tool calls were pending, the wrap-up is unspent)
 * immediately before routing here — this stage does the work of asking.
 */
export const wrapUpStage = (scope: TypedScope<AgentState>): void => {
  const iteration = scope.iteration as number;

  // The conversation as it really went, plus the ask. A plain local array —
  // a TypedScope array read is a live proxy view, and both the commit and the
  // event payload below must be detached plain data.
  const newHistory: LLMMessage[] = [
    ...(scope.history as readonly LLMMessage[]),
    { role: 'user', content: WRAP_UP_INSTRUCTION },
  ];
  scope.history = newHistory;

  // The one-per-turn latch, raised BEFORE the loop turns. It does double duty
  // and both jobs need it set now: `callLLM` reads it at request assembly to
  // withhold the tools, and the Route decider reads it on the pass after to
  // settle `stoppedEarly` against the answer that actually came back instead
  // of wrapping up a second time.
  scope.wrapUpAsked = true;

  // Close this iteration's bracket before the loop turns — every recorder that
  // synthesizes steps pairs `iteration_start`/`iteration_end` per `iterIndex`,
  // and the crash-checkpoint tracker snapshots history from this payload (the
  // SchemaRetry stage's reasoning, verbatim).
  typedEmit(scope, 'agentfootprint.agent.iteration_end', {
    turnIndex: 0,
    iterIndex: iteration,
    toolCallCount: 0,
    history: newHistory,
  });

  // The wrap-up is a real turn on the record — one more `iteration_start`, one
  // more billed call — so the counter moves with it. What it is exempt from is
  // the LIMIT, not the count: the decider never re-asks whether the budget
  // allows this call, because the call it allows cannot take an action.
  scope.iteration = iteration + 1;
};
