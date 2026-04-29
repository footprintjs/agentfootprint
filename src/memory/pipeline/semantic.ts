/**
 * semanticPipeline — vector-retrieval memory preset.
 *
 * Instead of loading the N most-recent messages, this preset embeds
 * the user's current turn and pulls the k most semantically similar
 * prior messages from a vector-capable store.
 *
 *   READ  :  LoadRelevant → PickByBudget → FormatDefault
 *   WRITE :  EmbedMessages → WriteMessages
 *
 * Contrast with `defaultPipeline` (recency) and `narrativePipeline`
 * (beat-level compression). Semantic retrieval is the right tool when:
 *   - Conversations are long enough that recency misses relevant
 *     context from many turns ago.
 *   - The user asks questions that reference topics from distant
 *     history ("what did I say about X last week?").
 *   - You have a real vector store (pgvector / Pinecone / Qdrant) —
 *     `InMemoryStore`'s O(n) scan is only useful for dev / tests.
 *
 * You MUST supply an `Embedder`. No default. The library ships
 * `mockEmbedder()` for tests — bring your own for production
 * (OpenAI, Voyage, Cohere, Sentence Transformers, custom).
 *
 * Most consumers reach for `semanticPipeline` indirectly through
 * `defineMemory({ type: MEMORY_TYPES.SEMANTIC, strategy: { kind:
 * MEMORY_STRATEGIES.TOP_K, topK, threshold, embedder }, store })`.
 *
 * @example Direct usage (low-level — custom flowchart composition):
 * ```ts
 * import { semanticPipeline, mockEmbedder, InMemoryStore } from 'agentfootprint/memory';
 *
 * const pipeline = semanticPipeline({
 *   store: new InMemoryStore(),
 *   embedder: mockEmbedder(),  // swap for openaiEmbedder() etc. in production
 * });
 * ```
 */
import { flowChart } from 'footprintjs';

import { pickByBudget, type PickByBudgetConfig } from '../stages/pickByBudget';
import { formatDefault, type FormatDefaultConfig } from '../stages/formatDefault';
import { writeMessages, type WriteMessagesConfig } from '../stages/writeMessages';
import type { MemoryState } from '../stages';
import type { MemoryStore } from '../store';
import type { MemoryPipeline } from './types';

import { loadRelevant, type LoadRelevantConfig } from '../embedding/loadRelevant';
import {
  embedMessages,
  type EmbedMessagesConfig,
  type EmbedMessagesState,
} from '../embedding/embedMessages';
import type { Embedder } from '../embedding/types';

export interface SemanticPipelineConfig {
  /** Vector-capable store. Must implement `search()`. */
  readonly store: MemoryStore;

  /** Embedder used for both write-side indexing and read-side query. */
  readonly embedder: Embedder;

  /**
   * Stable id for the embedder — attached to written entries and used
   * as a filter at read time so a later embedder swap doesn't produce
   * cross-model similarity pollution. Example: `"openai-text-embedding-3-small"`.
   */
  readonly embedderId?: string;

  /** Top-k entries to consider per turn. Default 20; picker narrows further. */
  readonly k?: number;

  /** Cosine threshold below which matches are dropped. Default none. */
  readonly minScore?: number;

  /** Tier filter for retrieval. */
  readonly tiers?: ReadonlyArray<'hot' | 'warm' | 'cold'>;

  /** Tier to tag writes with. */
  readonly writeTier?: 'hot' | 'warm' | 'cold';

  /** TTL for written entries (ms from write time). */
  readonly writeTtlMs?: number;

  /** Forwarded to `pickByBudget`. */
  readonly reserveTokens?: number;
  readonly minimumTokens?: number;
  readonly maxEntries?: number;

  /** Forwarded to `formatDefault`. */
  readonly formatHeader?: string;
  readonly formatFooter?: string;
}

/**
 * Build the semantic read + write pipelines sharing a single store.
 * Returns `{ read, write }` ready to pass to `Agent.memory()` via the appropriate `defineMemory` config (or used directly via `mountMemoryRead`/`mountMemoryWrite`).
 */
export function semanticPipeline(config: SemanticPipelineConfig): MemoryPipeline {
  if (!config.store.search) {
    throw new Error(
      'semanticPipeline: the configured store does not implement search(). ' +
        'Pass a vector-capable adapter (InMemoryStore, pgvector, Pinecone, ...).',
    );
  }

  const loadConfig: LoadRelevantConfig = {
    store: config.store,
    embedder: config.embedder,
    ...(config.embedderId !== undefined && { embedderId: config.embedderId }),
    ...(config.k !== undefined && { k: config.k }),
    ...(config.minScore !== undefined && { minScore: config.minScore }),
    ...(config.tiers && { tiers: config.tiers }),
  };
  const pickConfig: PickByBudgetConfig = {
    ...(config.reserveTokens !== undefined && { reserveTokens: config.reserveTokens }),
    ...(config.minimumTokens !== undefined && { minimumTokens: config.minimumTokens }),
    ...(config.maxEntries !== undefined && { maxEntries: config.maxEntries }),
  };
  const formatConfig: FormatDefaultConfig = {
    ...(config.formatHeader !== undefined && { header: config.formatHeader }),
    ...(config.formatFooter !== undefined && { footer: config.formatFooter }),
  };
  const embedConfig: EmbedMessagesConfig = {
    embedder: config.embedder,
    ...(config.embedderId !== undefined && { embedderId: config.embedderId }),
  };
  const writeConfig: WriteMessagesConfig = {
    store: config.store,
    ...(config.writeTier && { tier: config.writeTier }),
    ...(config.writeTtlMs !== undefined && { ttlMs: config.writeTtlMs }),
  };

  // ── Read subflow: LoadRelevant → PickByBudget → FormatDefault
  let readBuilder = flowChart<MemoryState>(
    'LoadRelevant',
    loadRelevant(loadConfig),
    'load-relevant',
    undefined,
    'Embed the query + fetch top-k semantically similar entries',
  );
  readBuilder = pickByBudget(pickConfig)(readBuilder);
  const read = readBuilder
    .addFunction(
      'Format',
      formatDefault(formatConfig),
      'format-default',
      'Render selected entries as a system message',
    )
    .build();

  // ── Write subflow: EmbedMessages → WriteMessages
  const write = flowChart<EmbedMessagesState>(
    'EmbedMessages',
    embedMessages(embedConfig),
    'embed-messages',
    undefined,
    'Embed newMessages into per-message vectors for vector search',
  )
    .addFunction(
      'WriteMessages',
      writeMessages(writeConfig),
      'write-messages',
      'Batch-persist messages with embeddings via store.putMany',
    )
    .build();

  return { read, write };
}
