/** Existing response accounting, including completed responses whose content is withheld. */
import type { TypedScope } from 'footprintjs';
import type { AgentState } from '../../types.js';
import type { LLMResponse } from '../../../../provider-contract/types.js';
import { typedEmit } from '../../../../recorders/core/typedEmit.js';
import { emitCostTick } from '../../../cost.js';
import type { CallLLMStageDeps } from './types.js';
import type { PreparedCall } from './prepareCall.js';
import type { ExecutedCall } from './executeCall.js';

export function recordResponseTokens(scope: TypedScope<AgentState>, response: LLMResponse): void {
  scope.totalInputTokens = scope.totalInputTokens + response.usage.input;
  scope.totalOutputTokens = scope.totalOutputTokens + response.usage.output;
  // Cache reads as a cost (9.110.0) — VALUE-conditional: the key exists
  // only once a provider has reported one, so a provider that reports
  // none (the mock, a local model) writes nothing and keeps its bytes.
  if (typeof response.usage.cacheRead === 'number') {
    scope.totalCacheReadTokens = (scope.totalCacheReadTokens ?? 0) + response.usage.cacheRead;
  }
}

/** A completed assessment still reports usage; this is not delivery of an answer. */
export function recordTerminalResponse(
  scope: TypedScope<AgentState>,
  deps: CallLLMStageDeps,
  prepared: PreparedCall,
  executed: ExecutedCall,
): void {
  const { response, answeredBy, localFallback } = executed;
  recordResponseTokens(scope, response);
  deps.onResponseCommitted?.(scope, localFallback);
  typedEmit(scope, 'agentfootprint.stream.llm_end', {
    iteration: prepared.iteration,
    content: '',
    contentWithheld: true,
    toolCallCount: 0,
    usage: response.usage,
    stopReason: response.stopReason,
    durationMs: Date.now() - prepared.startMs,
  });
  emitCostTick(scope, deps.pricingTable, deps.costBudget, answeredBy, response.usage);
}
