/**
 * Retrieve stage — calls retriever provider, writes RetrievalResult to scope.
 *
 * Context-engineering emit: after retrieval, fires
 * `agentfootprint.context.rag.chunks` so Lens can tag the Agent's
 * Messages slot with "🔍 N chunks — top score X.XX" on the iteration
 * that received the injection. This is the teaching surface: students
 * see *what* RAG added to the prompt, not just that RAG "ran".
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

    // Note: the context-engineering emit fires from augmentPrompt (the
    // stage that actually injects the system message), not here. Reason:
    // augmentPrompt has access to the final `messages[]` AND the role +
    // targetIndex of the injected message — full picture in one event.
    // Retrieve's job is just to fetch + write the result; emitting here
    // would force consumers to correlate two events to learn what
    // ultimately landed in the prompt.
  };
}
