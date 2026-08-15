/**
 * prepareFinal — first stage of the agent's "Final" branch subflow.
 *
 * Captures the turn payload (`finalContent` from the LLM's latest
 * content; `newMessages` as the `[user, assistant]` pair the memory-
 * write subflows persist) and emits the per-turn observability
 * brackets (`iteration_end`, `turn_end`).
 *
 * Mounted as the FIRST stage of the final-branch subflow built in
 * `buildAgentChart`. Subsequent memory-write subflows mount AFTER this
 * stage so they have `newMessages` available; `breakFinal` is the
 * terminal stage that stops the ReAct loop.
 *
 * Pure function — no closure over Agent class state. Imported and
 * passed directly to `flowChart(...)` in buildAgentChart.
 *
 * NOT the seam for `messageMiddleware`'s `'output'` half, deliberately.
 * This stage runs inside the Final BRANCH subflow, whose state does not
 * merge back into the run (a branch mount hands its outputMapper the
 * branch's RESULT, not its scope). Rows filed here would land in an
 * isolated commit log and never reach `snapshot.sharedState`, splitting
 * one ledger across two places. The chain runs one stage earlier instead
 * — in the Route decider, in the main chart — and rewrites
 * `llmLatestContent`, which is the value this stage copies. See
 * `stages/route.ts`.
 */

import type { TypedScope } from 'footprintjs';
import { typedEmit } from '../../../recorders/core/typedEmit.js';
import { composeAnswerWithCoverage } from '../coverage/index.js';
import type { AgentState } from '../types.js';

/**
 * The stage body, with the answer passed IN.
 *
 * One body, two entry points. The answer is a parameter rather than a read of
 * `scope.llmLatestContent` because `.limitsTravelWithTheAnswer()` composes a
 * different one — and everything filed here (`finalContent`, `newMessages`,
 * which memory persists, and `turn_end.finalContent`) must agree about what
 * the answer WAS. Note that `llmLatestContent` itself is a READ-ONLY input to
 * this branch subflow, so there is no version of this where the composed
 * answer is written back over it: the capture is the only place all four
 * readers meet.
 */
const captureTurnPayload = (scope: TypedScope<AgentState>, answer: string): void => {
  const iteration = scope.iteration;
  scope.finalContent = answer;
  // v2.14 — attach thinking blocks to the assistant final message
  // (if any). For non-Anthropic providers this is informational; for
  // Anthropic + extended-thinking-with-tool-use, signature round-trip
  // requires the blocks to persist on the assistant turn even when
  // it's the FINAL turn (continuation in the next user message).
  const thinkingBlocks = scope.thinkingBlocks;
  const hasThinking = thinkingBlocks !== undefined && thinkingBlocks.length > 0;
  // The turn payload memory writes persist: the user's message
  // paired with the agent's final answer.
  scope.newMessages = [
    { role: 'user', content: scope.userMessage },
    {
      role: 'assistant',
      content: scope.finalContent,
      ...(hasThinking && { thinkingBlocks }),
    },
  ];

  typedEmit(scope, 'agentfootprint.agent.iteration_end', {
    turnIndex: 0,
    iterIndex: iteration,
    toolCallCount: 0,
  });
  typedEmit(scope, 'agentfootprint.agent.turn_end', {
    turnIndex: 0,
    finalContent: scope.finalContent,
    totalInputTokens: scope.totalInputTokens,
    totalOutputTokens: scope.totalOutputTokens,
    iterationCount: iteration,
    durationMs: Date.now() - scope.turnStartMs,
  });
};

export const prepareFinalStage = (scope: TypedScope<AgentState>): void => {
  captureTurnPayload(scope, scope.llmLatestContent);
};

/**
 * `.limitsTravelWithTheAnswer()`'s half of prepare-final — the SAME stage,
 * with the run's declared coverage folded into the answer first.
 *
 * Mounted in place of `prepareFinalStage` by both chart builders when the
 * option is configured, and nowhere else: an agent that did not ask for it
 * runs the function above, byte for byte. Written as one stage rather than a
 * second one because everything the capture files must agree about what the
 * answer WAS — a second stage afterwards would leave `turn_end` reporting an
 * answer the caller never saw.
 *
 * It runs AFTER the evidence gate has judged (the gate is in the Route
 * decider, one stage earlier). That ordering is deliberate: the block is
 * composed by the framework out of what the TOOLS declared, so subjecting it
 * to a check for values the MODEL could not support would be asking whether
 * the library grounded itself.
 */
export const prepareFinalWithLimitsStage = (scope: TypedScope<AgentState>): void => {
  const declared = scope.coverageDeclared;
  const answer =
    declared !== undefined && declared.length > 0
      ? composeAnswerWithCoverage(scope.llmLatestContent, declared)
      : scope.llmLatestContent;
  captureTurnPayload(scope, answer);
};
