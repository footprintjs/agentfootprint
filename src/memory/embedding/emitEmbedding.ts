/**
 * emitEmbedding — one place that reports an embedding call.
 *
 * Pattern: leaf helper over the emit channel.
 * Role:    memory/ layer. Both halves of the two-phase cost model go through
 *          it — `embedMessages` reports `'document'`, `loadRelevant` reports
 *          `'query'` — so the two can never drift into describing the same
 *          fact two different ways.
 * Emits:   `agentfootprint.embedding.generated`.
 *
 * ── Why this event matters more than it looks ───────────────────────────────
 * Embedding cost is not one number. **Index time** embeds the corpus: it
 * happens once, and its cost scales with how much you store. **Query time**
 * embeds the user's question: it happens per retrieval, and its cost scales
 * with traffic. `inputKind` is the field that separates them, and separating
 * them is what makes "should this corpus live in a file?" a question with an
 * arithmetic answer instead of a feeling.
 *
 * The payload has been declared since 2.x and nothing emitted it, so any
 * dashboard built against it has been reading a flat line that meant "not
 * wired", not "no cost".
 *
 * Telemetry rides the EMIT channel, never a commit payload — a cost report is
 * an observation about a stage, not state the next stage reads.
 */
import type { TypedScope } from 'footprintjs';
import type { EmbeddingGeneratedPayload } from '../../events/payloads.js';

/**
 * Fire the event when the scope has an emit channel, and do nothing when it
 * does not.
 *
 * A memory pipeline can be mounted outside an Agent (`mountMemoryRead` on a
 * bare flowchart), and a stage that threw because nobody was listening would
 * make observability a requirement rather than an option.
 */
export function emitEmbedding(
  scope: TypedScope<Record<string, unknown>> | { $emit?: unknown },
  payload: EmbeddingGeneratedPayload,
): void {
  const emitter = (scope as { $emit?: (type: string, payload: unknown) => void }).$emit;
  if (typeof emitter === 'function') {
    emitter.call(scope, 'agentfootprint.embedding.generated', payload);
  }
}
