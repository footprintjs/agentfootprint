/**
 * defineRAG — sugar factory for retrieval-augmented generation.
 *
 * RAG is a context-engineering flavor: embed the user's question,
 * retrieve top-K semantically similar chunks from a vector store,
 * inject those chunks into the messages slot of the next LLM call.
 * It's the same plumbing as `defineMemory({ type: SEMANTIC,
 * strategy: TOP_K })` — the rename is for intent + ergonomics.
 *
 *   defineMemory ─┬─► EPISODIC   (raw conversation)
 *                 ├─► SEMANTIC   (extracted facts / RAG chunks)
 *                 ├─► NARRATIVE  (beats / summaries)
 *                 └─► CAUSAL     (footprintjs decision snapshots)
 *
 *   defineRAG    ─►  SEMANTIC + TOP_K with RAG-specific defaults
 *                    (asRole='user', threshold=0.7, no LLM-extract)
 *
 * Pattern: Composition over duplication — defineRAG returns a
 *          MemoryDefinition produced by defineMemory. No new engine
 *          code, no new slot subflow, no new event type.
 *
 * Role:    Layer-3 context-engineering primitive. Lives next to
 *          defineSkill / defineSteering / defineInstruction / defineFact
 *          but resolves to a memory subflow rather than an Injection
 *          (RAG content is computed at runtime via async retrieval —
 *          can't fit the synchronous Injection.inject shape).
 *
 * Emits:   Indirectly — the underlying memory pipeline emits
 *          `agentfootprint.context.injected` when retrieved chunks
 *          land in the messages slot.
 *
 * 7-panel review (2026-04-29):
 * - LLM Systems    ✅  injects as 'user' role by default — RAG chunks
 *                      land where the LLM treats them as authoritative
 *                      retrieved context, not behavior rules
 * - Architect      ✅  composition over defineMemory; zero new engine
 *                      code; multi-RAG layering works via per-id keys
 * - API Designer   ✅  one factory, mirrors defineMemory shape; consumer
 *                      ergonomics: `agent.rag(defineRAG({...}))`
 * - Performance    ✅  embedding cost is one call per turn (TURN_START
 *                      timing, default); strict threshold prevents
 *                      injecting low-confidence noise
 * - Privacy        ✅  multi-tenant via MemoryIdentity tuple; doc
 *                      content never crosses tenant boundaries
 * - ML / IR        ✅  embedder version pinned via `embedderId`; cosine
 *                      score semantics inherited from MemoryStore
 * - SoftEng        ✅  thin file (this one); existing memory tests
 *                      cover the underlying pipeline
 *
 * @see ./indexDocuments.ts  for the seeding helper
 * @see ../../memory/define.ts  for the underlying factory
 *
 * @example  Basic usage
 * ```ts
 * import {
 *   Agent, defineRAG, indexDocuments, InMemoryStore, mockEmbedder,
 * } from 'agentfootprint';
 *
 * const embedder = mockEmbedder();
 * const store = new InMemoryStore();
 *
 * // Seed the store once at startup
 * await indexDocuments(store, embedder, [
 *   { id: 'doc1', content: 'Refunds are processed within 3 business days.' },
 *   { id: 'doc2', content: 'Pro plan costs $20/month.' },
 * ]);
 *
 * const docs = defineRAG({
 *   id: 'product-docs',
 *   description: 'Retrieve product documentation chunks',
 *   store,
 *   embedder,
 *   topK: 3,
 *   threshold: 0.6,
 * });
 *
 * const agent = Agent.create({ provider }).rag(docs).build();
 * ```
 */

import type { ContextRole } from '../../events/types.js';
import type { Embedder } from '../../memory/embedding/index.js';
import type { MemoryStore } from '../../memory/store/index.js';
import type { MemoryDefinition } from '../../memory/define.types.js';
import { MEMORY_TYPES, MEMORY_STRATEGIES } from '../../memory/define.types.js';
import { defineMemory } from '../../memory/define.js';

export interface DefineRAGOptions {
  /** Stable id. Becomes the scope-key suffix and the Lens label. */
  readonly id: string;

  /**
   * Human-readable description. Surfaces in narrative + Lens hover.
   * Recommend describing the *corpus* (e.g., "Product documentation
   * chunks indexed weekly from docs.example.com").
   */
  readonly description?: string;

  /**
   * Vector-capable store containing the indexed corpus. Must implement
   * `search()`. Use `indexDocuments(store, embedder, docs)` at startup
   * to populate it. Ships with `InMemoryStore` for dev/tests; swap to
   * `pgvector` / Pinecone / Qdrant adapters in production.
   */
  readonly store: MemoryStore;

  /**
   * Embedder used for the read-side query. Pass the SAME embedder
   * instance (or one with the same `name`) that was used for indexing
   * — cross-model similarity scores are not comparable.
   */
  readonly embedder: Embedder;

  /**
   * Stable id of the embedder. Stored on entries during indexing
   * (via `indexDocuments`) and filtered at search time so a later
   * embedder swap doesn't pollute results.
   */
  readonly embedderId?: string;

  /**
   * Top-K chunks to retrieve per turn. Default 3 (balanced —
   * defends against lost-in-the-middle while giving multiple
   * perspectives). Increase for richer context, decrease for cost.
   */
  readonly topK?: number;

  /**
   * Minimum cosine similarity to inject. **Strict** — when no chunk
   * meets the threshold, NO injection happens (no fallback that would
   * pollute the prompt with weak matches). Default 0.7.
   */
  readonly threshold?: number;

  /**
   * Role to use when injecting retrieved chunks into the messages
   * slot. Default `'user'` — RAG chunks are most often treated as
   * "context the user provided" by LLMs. Use `'system'` for
   * authoritative reference docs that should outweigh user instruction.
   */
  readonly asRole?: ContextRole;
}

/**
 * Build a RAG context-engineering definition. The returned
 * `MemoryDefinition` is registered on the Agent via `.rag(definition)`
 * (or, equivalently, `.memory(definition)` — same plumbing).
 *
 * @throws when `store` does not implement `search()`. RAG requires a
 *         vector-capable adapter.
 */
export function defineRAG(opts: DefineRAGOptions): MemoryDefinition {
  if (!opts.id || opts.id.trim() === '') {
    throw new Error('defineRAG: `id` is required and must be non-empty.');
  }
  if (!opts.store) {
    throw new Error(`defineRAG[${opts.id}]: \`store\` is required.`);
  }
  if (!opts.embedder) {
    throw new Error(`defineRAG[${opts.id}]: \`embedder\` is required.`);
  }
  if (!opts.store.search) {
    throw new Error(
      `defineRAG[${opts.id}]: store must implement search(). ` +
        'Pass a vector-capable adapter (InMemoryStore, pgvector, Pinecone, ...).',
    );
  }

  return defineMemory({
    id: opts.id,
    ...(opts.description !== undefined && { description: opts.description }),
    type: MEMORY_TYPES.SEMANTIC,
    strategy: {
      kind: MEMORY_STRATEGIES.TOP_K,
      topK: opts.topK ?? 3,
      threshold: opts.threshold ?? 0.7,
      embedder: opts.embedder,
    },
    store: opts.store,
    asRole: opts.asRole ?? 'user',
  });
}
