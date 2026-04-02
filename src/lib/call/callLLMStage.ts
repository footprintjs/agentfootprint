/**
 * CallLLM stage — sends messages + tools to the LLM provider.
 *
 * Reads from scope:
 *   - messages (set by Messages slot or prior stages)
 *   - toolDescriptions (set by Tools slot)
 *
 * Writes to scope:
 *   - adapterResult (discriminated union: 'final' | 'tools' | 'error')
 *   - adapterRawResponse (raw LLM response for recorders)
 *   - llmCall (narrative summary of the LLM call)
 */

import type { TypedScope } from 'footprintjs';
import type { AgentLoopState } from '../../scope/types';
import type { LLMProvider, LLMCallOptions } from '../../types';
import { normalizeAdapterResponse } from './helpers';

/**
 * Create the CallLLM stage function.
 */
export function createCallLLMStage(provider: LLMProvider) {
  if (!provider) {
    throw new Error('createCallLLMStage: provider is required');
  }

  return async (scope: TypedScope<AgentLoopState>) => {
    const messages = scope.messages ?? [];
    const tools = scope.toolDescriptions ?? [];
    const signal = scope.$getEnv()?.signal;

    const options: LLMCallOptions | undefined =
      tools.length > 0 || signal ? { ...(tools.length > 0 && { tools }), signal } : undefined;
    const response = await provider.chat(messages, options);

    // Write raw response for recorders to observe
    scope.adapterRawResponse = response;

    // Normalize to AdapterResult
    scope.adapterResult = normalizeAdapterResponse(response);

    // Write summary for narrative visibility
    const model = response.model ?? 'unknown';
    const usage = response.usage;
    const usageSummary = usage
      ? `${usage.inputTokens ?? '?'}in / ${usage.outputTokens ?? '?'}out`
      : 'no usage data';
    scope.llmCall = `${model} (${usageSummary})`;
  };
}
