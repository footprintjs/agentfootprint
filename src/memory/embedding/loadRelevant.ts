/**
 * loadRelevant — read-side stage that embeds a query and fetches the
 * top-k most similar entries from a vector-capable `MemoryStore`.
 *
 * Reads from scope:   `identity`, `newMessages` (or custom queryFrom)
 * Writes to scope:    `loaded` (MemoryEntry[], ordered best-first — to be
 *                     narrowed by `pickByBudget` downstream)
 *
 * Query derivation:
 *   Default: the last user message in `newMessages`. That's the natural
 *   "what is the user asking about?" signal. Override with `queryFrom`
 *   for custom retrieval (e.g., compose user + assistant content,
 *   pull a summary, etc.).
 *
 * Empty behavior:
 *   No query text → no search → `loaded = []`. Downstream
 *   `pickByBudget` picks nothing and the formatter emits nothing — safe.
 *
 * Feature detection:
 *   Throws at stage build time if the store doesn't implement
 *   `search()`. Fail-loud — a semantic pipeline configured against a
 *   non-vector store is a config bug, not a runtime condition.
 */
import type { TypedScope } from 'footprintjs';
import type { LLMMessage as Message } from '../../adapters/types';
import type { MemoryStore } from '../store';
import type { MemoryState } from '../stages';
import type { Embedder } from './types';

export interface LoadRelevantConfig {
  /** The vector-capable store. Must implement `search()`. */
  readonly store: MemoryStore;

  /** Embedder used to turn the query text into a vector. */
  readonly embedder: Embedder;

  /**
   * Identifier for the embedder. When set, the search filters entries
   * to those produced by the same embedder (prevents cross-model
   * similarity pollution).
   */
  readonly embedderId?: string;

  /** Top-k to retrieve. Default 20 — picker will narrow further by budget. */
  readonly k?: number;

  /** Minimum cosine score [-1, 1] to consider a match. Default: none. */
  readonly minScore?: number;

  /** Filter results by tier. */
  readonly tiers?: ReadonlyArray<'hot' | 'warm' | 'cold'>;

  /**
   * Extract the query text from scope. Default: the last user message
   * in `newMessages`. Override for custom retrieval signals.
   */
  readonly queryFrom?: (scope: TypedScope<MemoryState>) => string;
}

/**
 * Default query extractor — last user message.
 *
 * Inside the memory-read subflow (mounted by `mountMemoryRead`), the
 * current turn's messages are piped in as `scope.messages` via the
 * mount's inputMapper. Falls back to `newMessages` for custom pipelines
 * that wire differently.
 */
function defaultQueryFrom(scope: TypedScope<MemoryState>): string {
  const scopeAny = scope as unknown as { messages?: readonly Message[] };
  const incoming = scopeAny.messages ?? [];
  const source: readonly Message[] =
    incoming.length > 0 ? incoming : ((scope.newMessages ?? []) as readonly Message[]);

  for (let i = source.length - 1; i >= 0; i--) {
    const m = source[i];
    if (m.role !== 'user') continue;
    if (m.content) return m.content;
  }
  return '';
}

export function loadRelevant(config: LoadRelevantConfig) {
  const { store, embedder } = config;
  if (!store.search) {
    throw new Error(
      'loadRelevant: the configured store does not implement search(). ' +
        'Use a vector-capable adapter (InMemoryStore, pgvector, Pinecone, ...).',
    );
  }
  const queryFrom = config.queryFrom ?? defaultQueryFrom;
  const k = config.k ?? 20;

  return async (scope: TypedScope<MemoryState>): Promise<void> => {
    const identity = scope.identity;
    const text = queryFrom(scope).trim();
    if (text.length === 0) {
      scope.loaded = [];
      return;
    }

    const signal = scope.$getEnv?.()?.signal;
    const queryVec = (await embedder.embed({
      text,
      ...(signal ? { signal } : {}),
    })) as number[];

    // store.search optional on MemoryStore but required when an embedder
    // is configured (validated upstream by defineMemory).
    // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
    const results = await store.search!(identity, queryVec, {
      k,
      ...(config.minScore !== undefined && { minScore: config.minScore }),
      ...(config.tiers && { tiers: config.tiers }),
      ...(config.embedderId !== undefined && { embedderId: config.embedderId }),
    });

    // Write loaded entries to scope in best-first order — downstream
    // pickByBudget further narrows by the token budget.
    scope.loaded = results.map((r) => r.entry) as MemoryState['loaded'];
  };
}
