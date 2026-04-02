/**
 * CallLLM stage — sends messages to LLM via adapter, writes AdapterResult to scope.
 */

import type { TypedScope } from 'footprintjs';
import type { LLMProvider, LLMToolDescription } from '../types';
import type { RAGState } from '../scope/types';
import { normalizeAdapterResponse } from './helpers';

export function createCallLLMStage(provider: LLMProvider) {
  return async (scope: TypedScope<RAGState>) => {
    const messages = scope.messages ?? [];
    const tools =
      (scope.$getValue('toolDescriptions') as LLMToolDescription[] | undefined) ?? [];

    const options = tools.length > 0 ? { tools } : undefined;
    const response = await provider.chat(messages, options);

    // Write raw response for recorders to observe
    scope.adapterRawResponse = response;

    // Normalize to AdapterResult
    scope.adapterResult = normalizeAdapterResponse(response);
  };
}
