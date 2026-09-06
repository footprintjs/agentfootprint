/**
 * stepNudge — the branch that asks once when a final answer left declared
 * steps unrun (9.18.0).
 *
 * Mounted as a branch of the Route decider, and only on an agent with ≥1
 * STEPPED skill. It carries `{ loopTo }` to the same target the
 * `tool-calls` branch loops to — the SchemaRetry mechanism verbatim: a
 * nudge is not a special mode, it is one more ordinary turn of the ReAct
 * loop, with its own `iteration_start` / `llm_start` bracket and its own
 * `cost.tick` against `costBudget`.
 *
 * What it appends is the conversation as it really went: the premature
 * answer as the assistant turn, then a `role: 'user'` teaching message
 * naming every unrun step and its note. At most once per turn
 * (`stepNudgeSpent`); the model stopping AGAIN is honored
 * (`steps_unfinished { action: 'accepted' }`, judged by the decider) — a
 * procedure is a declared order, never a forced march.
 *
 * That teaching message is written by `nudgeTeachingMessage` (skillSteps.ts
 * owns every sentence about a procedure) and, since 9.86.0, opens with
 * `STEP_NUDGE_FRAME_PREFIX` from the authorship registry. It has to: this
 * stage puts it in `scope.history` under `role: 'user'`, where it looks like
 * a person's turn to `isSaidByPerson` — and its body lists the skill id and
 * the unrun steps' TOOL NAMES, which is precisely what a routing rule
 * scanning history matches on. The opening is what tells the window's
 * refusal engine and a rule author that nobody said it.
 *
 * Pure function apart from its plan closure — no Agent class state.
 */

import type { TypedScope } from 'footprintjs';
import type { LLMMessage } from '../../../adapters/types.js';
import { typedEmit } from '../../../recorders/core/typedEmit.js';
import {
  nudgeTeachingMessage,
  pointerOf,
  remainingStepsOf,
  stepInProgress,
  type StepPlanFor,
} from '../../../lib/injection-engine/skillSteps.js';
import type { AgentState } from '../types.js';

// LENS · injected-turn · persistent-history
// reads: ptr ← pointerOf(scope.stepPointer); plan ← stepPlanFor(ptr.skillId); the sentence ← skillSteps.ts · nudgeTeachingMessage
// known gap: the teaching message names the skill id and every unrun step's tool name with no
// scope.hiddenSkillIds filter. Mitigating: the pointer can only stand on a skill this caller activated.
// law: may omit, never deny; every clause anchored to the call it was composed on.
/**
 * Build the nudge stage. The decider already judged the table (steps
 * remain, no limit fired, nudge unspent) before routing here — this stage
 * does the work of asking.
 */
export function buildStepNudgeStage(
  stepPlanFor: StepPlanFor,
): (scope: TypedScope<AgentState>) => void {
  return (scope) => {
    const ptr = pointerOf(scope.stepPointer);
    const plan = stepInProgress(ptr) ? stepPlanFor(ptr.skillId) : undefined;
    if (!ptr || !plan) {
      // Unreachable through the decider, which judges the pointer
      // immediately before routing here. Returning quietly rather than
      // throwing keeps a hand-built chart that mounts this branch without
      // the decider from taking down a run (the SchemaRetry discipline).
      return;
    }

    const iteration = scope.iteration as number;
    const prematureAnswer = scope.llmLatestContent as string;
    const teaching = nudgeTeachingMessage(ptr, plan);

    // The conversation, as it really went: the answer that stopped early,
    // then the teaching ask. A plain local array — a TypedScope array read
    // is a live proxy view, and both the commit and the event payload below
    // must be detached plain data.
    const newHistory: LLMMessage[] = [
      ...(scope.history as readonly LLMMessage[]),
      { role: 'assistant', content: prematureAnswer },
      { role: 'user', content: teaching },
    ];
    scope.history = newHistory;

    // The one-per-turn latch. Spent BEFORE the loop turns, so a second
    // premature stop is accepted rather than re-nudged — never a forced
    // continue.
    scope.stepNudgeSpent = true;

    typedEmit(scope, 'agentfootprint.skill.steps_unfinished', {
      skillId: ptr.skillId,
      remaining: remainingStepsOf(ptr, plan),
      total: ptr.total,
      action: 'nudged',
      iteration,
    });

    // Close this iteration's bracket before the loop turns — every recorder
    // that synthesizes steps pairs `iteration_start`/`iteration_end` per
    // `iterIndex`, and the crash-checkpoint tracker snapshots history from
    // this payload (the SchemaRetry stage's reasoning, verbatim).
    typedEmit(scope, 'agentfootprint.agent.iteration_end', {
      turnIndex: 0,
      iterIndex: iteration,
      toolCallCount: 0,
      history: newHistory,
    });

    // A nudge consumes an iteration, exactly as a tool call does — one more
    // real turn against the agent's declared budget.
    scope.iteration = iteration + 1;
  };
}
