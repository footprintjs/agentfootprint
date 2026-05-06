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
 */

import type { TypedScope } from 'footprintjs';
import { typedEmit } from '../../../recorders/core/typedEmit.js';
import type { AgentState } from '../types.js';

export const prepareFinalStage = (scope: TypedScope<AgentState>): void => {
  const iteration = scope.iteration;
  scope.finalContent = scope.llmLatestContent;
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
