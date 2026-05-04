/**
 * route — decider that branches the ReAct loop into 'tool-calls' or 'final'.
 *
 * Runs after CallLLM. If the LLM returned tool calls AND we haven't hit
 * `maxIterations`, route to the tool execution branch (which loops back
 * to PromptBuilder). Otherwise route to the final-branch subflow which
 * persists memory writes and breaks the loop.
 *
 * Emits `agentfootprint.agent.route_decided` with the chosen branch +
 * a human-readable rationale (visible in narrative + observability).
 *
 * Pure function — no closure over Agent class state. Imported and
 * passed directly to `addDeciderFunction(...)` in buildAgentChart.
 */

import type { TypedScope } from 'footprintjs';
import { typedEmit } from '../../../recorders/core/typedEmit.js';
import type { AgentState } from '../types.js';

export type RouteBranch = 'tool-calls' | 'final';

export const routeDeciderStage = (scope: TypedScope<AgentState>): RouteBranch => {
  const toolCalls = scope.llmLatestToolCalls as readonly { name: string }[];
  const iteration = scope.iteration as number;
  const chosen: RouteBranch =
    toolCalls.length > 0 && iteration < scope.maxIterations ? 'tool-calls' : 'final';

  typedEmit(scope, 'agentfootprint.agent.route_decided', {
    turnIndex: 0,
    iterIndex: iteration,
    chosen,
    rationale:
      chosen === 'tool-calls'
        ? `LLM requested ${toolCalls.length} tool call(s)`
        : iteration >= scope.maxIterations
          ? 'maxIterations reached — forcing final'
          : 'LLM produced no tool calls — final answer',
  });

  return chosen;
};
