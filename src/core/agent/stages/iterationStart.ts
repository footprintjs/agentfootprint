/**
 * iterationStart — per-iteration marker stage.
 *
 * Emits `agentfootprint.agent.iteration_start` so observability adapters
 * + recorders can bracket each ReAct iteration. Fires AFTER the slot
 * subflows (SystemPrompt, Messages, Tools, CacheDecision, CacheGate)
 * have produced this iteration's prompt assembly and BEFORE CallLLM.
 *
 * `turnIndex: 0` is intentional — the agent currently runs ONE turn per
 * `agent.run()`. The turn index is reserved for future multi-turn
 * orchestration; iteration index is the per-iteration counter.
 */

import type { TypedScope } from 'footprintjs';
import { typedEmit } from '../../../recorders/core/typedEmit.js';
import type { AgentState } from '../types.js';

export const iterationStartStage = (scope: TypedScope<AgentState>): void => {
  typedEmit(scope, 'agentfootprint.agent.iteration_start', {
    turnIndex: 0,
    iterIndex: scope.iteration,
  });
};
