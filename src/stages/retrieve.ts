/**
 * Retrieve stage — calls retriever provider, writes RetrievalResult to scope.
 */

import type { TypedScope } from 'footprintjs';
import type { RetrieverProvider, RetrieveOptions } from '../types';
import { getTextContent } from '../types/content';
import type { RAGState } from '../scope/types';

export function createRetrieveStage(retriever: RetrieverProvider, options?: RetrieveOptions) {
  return async (scope: TypedScope<RAGState>) => {
    // Use explicit retrieval query if set, otherwise last user message
    const lastUserContent = (scope.messages ?? []).filter((m) => m.role === 'user').pop()?.content;
    const query = scope.retrievalQuery ?? (lastUserContent ? getTextContent(lastUserContent) : '');

    const result = await retriever.retrieve(query, options);

    // Write to scope — recorders observe this
    scope.retrievalResult = result;
  };
}
