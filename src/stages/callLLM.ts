/**
 * CallLLM stage — sends messages to LLM via adapter, writes AdapterResult to scope.
 */

import type { TypedScope } from 'footprintjs';
import type { LLMProvider } from '../types';
import type { BaseLLMState } from '../scope/types';
import { normalizeAdapterResponse } from './helpers';

export function createCallLLMStage(provider: LLMProvider) {
  return async (scope: TypedScope<BaseLLMState>) => {
    const messages = scope.messages ?? [];
    const tools = scope.toolDescriptions ?? [];

    const options = tools.length > 0 ? { tools } : undefined;
    const response = await provider.chat(messages, options);

    scope.adapterRawResponse = response;
    scope.adapterResult = normalizeAdapterResponse(response);
  };
}
