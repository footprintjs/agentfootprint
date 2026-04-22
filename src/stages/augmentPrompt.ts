/**
 * AugmentPrompt stage — injects retrieved context into messages before
 * the LLM call.
 *
 * Context-engineering emit: after the new system message lands in
 * `messages[]`, fires `agentfootprint.context.rag.chunks` with the FULL
 * picture — chunk count + top score (from the retrieval result) PLUS
 * the role / targetIndex / deltaCount (from the message-array mutation
 * we just performed). One event per RAG injection — Lens uses it to
 * tag the iteration AND update the per-slot accumulated ledger
 * (e.g. "messages now has +1 system from RAG this turn").
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

  // Insert after system prompt if present, otherwise at front.
  const sysIdx = messages.findIndex((m) => m.role === 'system');
  let targetIndex: number;
  if (sysIdx >= 0) {
    const updated = [...messages];
    targetIndex = sysIdx + 1;
    updated.splice(targetIndex, 0, contextMsg);
    scope.messages = updated;
  } else {
    targetIndex = 0;
    scope.messages = [contextMsg, ...messages];
  }

  // Emit the enriched context-engineering event. Slot tells Lens which
  // Agent slot to tag (Messages); role + deltaCount surface the actual
  // wire-level shape (a 2nd `system`-role message); targetIndex pinpoints
  // where in the array it landed (for the "Inspect messages" drill-down).
  // Guard $emit — bare scope stubs in tests don't have it.
  if (typeof (scope as unknown as { $emit?: unknown }).$emit === 'function') {
    scope.$emit('agentfootprint.context.rag.chunks', {
      slot: 'messages',
      role: 'system' as const,
      targetIndex,
      deltaCount: { system: 1 },
      chunkCount: result.chunks.length,
      topScore: result.chunks[0]?.score,
      // Defensive: only pass text previews + scores, not full chunk bodies —
      // keeps emit-channel payloads small for the consumer callback path.
      preview: result.chunks.slice(0, 3).map((c) => ({
        score: c.score,
        textPreview: (c.content ?? '').slice(0, 120),
      })),
    });
  }
}
