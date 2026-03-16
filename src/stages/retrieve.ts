/**
 * Retrieve stage — calls retriever provider, writes RetrievalResult to scope.
 */

import type { ScopeFacade } from 'footprintjs';
import type { RetrieverProvider, RetrieveOptions } from '../types';
import { getTextContent } from '../types/content';
import { AgentScope } from '../scope';

export function createRetrieveStage(retriever: RetrieverProvider, options?: RetrieveOptions) {
  return async (scope: ScopeFacade) => {
    // Use explicit retrieval query if set, otherwise last user message
    const lastUserContent = AgentScope.getMessages(scope)
      .filter((m) => m.role === 'user')
      .pop()?.content;
    const query =
      AgentScope.getRetrievalQuery(scope) ??
      (lastUserContent ? getTextContent(lastUserContent) : '');

    const result = await retriever.retrieve(query, options);

    // Write to scope — recorders observe this
    AgentScope.setRetrievalResult(scope, result);
  };
}
