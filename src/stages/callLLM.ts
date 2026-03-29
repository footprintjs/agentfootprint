/**
 * CallLLM stage — sends messages to LLM via adapter, writes AdapterResult to scope.
 */

import type { ScopeFacade } from 'footprintjs/advanced';
import type { LLMProvider } from '../types';
import { AgentScope } from '../scope';
import { ADAPTER_PATHS } from '../types';
import { normalizeAdapterResponse } from './helpers';

export function createCallLLMStage(provider: LLMProvider) {
  return async (scope: ScopeFacade) => {
    const messages = AgentScope.getMessages(scope);
    const tools = AgentScope.getToolDescriptions(scope);

    const options = tools.length > 0 ? { tools } : undefined;
    const response = await provider.chat(messages, options);

    // Write raw response for recorders to observe
    scope.setValue(ADAPTER_PATHS.RESPONSE, response);

    // Normalize to AdapterResult
    AgentScope.setAdapterResult(scope, normalizeAdapterResponse(response));
  };
}
