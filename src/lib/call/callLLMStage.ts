/**
 * CallLLM stage — sends messages + tools to the LLM provider.
 *
 * Reads from scope:
 *   - messages (set by Messages slot or prior stages)
 *   - toolDescriptions (set by Tools slot)
 *
 * Writes to scope:
 *   - adapterResult (discriminated union: 'final' | 'tools' | 'error')
 *   - ADAPTER_PATHS.RESPONSE (raw LLM response for recorders)
 */

import type { ScopeFacade } from 'footprintjs/advanced';
import type { LLMProvider, LLMCallOptions } from '../../types';
import { ADAPTER_PATHS } from '../../types';
import { AgentScope } from '../../scope';
import { normalizeAdapterResponse } from './helpers';

/**
 * Create the CallLLM stage function.
 */
export function createCallLLMStage(provider: LLMProvider) {
  if (!provider) {
    throw new Error('createCallLLMStage: provider is required');
  }

  return async (scope: ScopeFacade) => {
    const messages = AgentScope.getMessages(scope);
    const tools = AgentScope.getToolDescriptions(scope);
    const signal = scope.getEnv()?.signal;

    const options: LLMCallOptions | undefined =
      tools.length > 0 || signal ? { ...(tools.length > 0 && { tools }), signal } : undefined;
    const response = await provider.chat(messages, options);

    // Write raw response for recorders to observe
    scope.setValue(ADAPTER_PATHS.RESPONSE, response);

    // Normalize to AdapterResult
    AgentScope.setAdapterResult(scope, normalizeAdapterResponse(response));
  };
}
