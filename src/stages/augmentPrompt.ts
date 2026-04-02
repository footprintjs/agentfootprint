/**
 * AugmentPrompt stage — injects retrieved context into messages before LLM call.
 */

import type { TypedScope } from 'footprintjs';
import { systemMessage } from '../types';
import type { RAGState } from '../scope/types';

export function augmentPromptStage(scope: TypedScope<RAGState>): void {
  const result = scope.retrievalResult;
  // Graceful degradation: if retrieval returned nothing, skip context injection.
  // LLM proceeds with user query only — useful in hybrid pipelines where retrieval is optional.
  if (!result || result.chunks.length === 0) return;

  // Format chunks into numbered context block
  const context = result.chunks.map((c, i) => `[${i + 1}] ${c.content}`).join('\n\n');

  scope.contextWindow = context;

  // Inject context into messages
  const messages = scope.messages ?? [];
  const contextMsg = systemMessage(
    `Use the following context to answer the user's question:\n\n${context}`,
  );

  // Insert after system prompt if present, otherwise at front
  const sysIdx = messages.findIndex((m) => m.role === 'system');
  if (sysIdx >= 0) {
    const updated = [...messages];
    updated.splice(sysIdx + 1, 0, contextMsg);
    scope.messages = updated;
  } else {
    scope.messages = [contextMsg, ...messages];
  }
}
