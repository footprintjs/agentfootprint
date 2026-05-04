/**
 * indexDocuments — seed a vector-capable MemoryStore with documents.
 *
 * Embeds each document, builds a `MemoryEntry<{content, metadata?}>`,
 * batches into `store.putMany()`. Used at application startup to
 * populate a RAG store before the first agent run.
 *
 * Pattern: Bulk-write helper. Not a flowchart stage — it runs once
 *          at boot, not per-iteration.
 * Role:    Layer-3 RAG pipeline starter. Pairs with `defineRAG()`
 *          which only does the read side.
 * Emits:   N/A — startup-time batch write, not part of the agent run.
 *
 * @example
 * ```ts
 * import { InMemoryStore, mockEmbedder, indexDocuments, defineRAG } from 'agentfootprint';
 *
 * const store = new InMemoryStore();
 * const embedder = mockEmbedder();
 *
 * await indexDocuments(store, embedder, [
 *   { id: 'doc1', content: 'Refunds processed within 3 business days.' },
 *   { id: 'doc2', content: 'Pro plan: $20/mo, includes priority support.', metadata: { tier: 'pro' } },
 *   { id: 'doc3', content: 'Free plan: limited to 100 calls/month.' },
 * ]);
 *
 * const docs = defineRAG({ id: 'product-docs', store, embedder });
 * agent.rag(docs);
 * ```
 */

import type { Embedder } from '../../memory/embedding/index.js';
import type { MemoryEntry } from '../../memory/entry/index.js';
import type { MemoryStore } from '../../memory/store/index.js';
import type { MemoryIdentity } from '../../memory/identity/index.js';

/** A document to index. `id` must be unique within the store + identity. */
export interface RagDocument {
  readonly id: string;
  readonly content: string;
  readonly metadata?: Readonly<Record<string, unknown>>;
}

export interface IndexDocumentsOptions {
  /**
   * Identity scope to write under. Default: a single shared
   * `{ conversationId: '_global' }` namespace, suitable for app-wide
   * corpora.
   *
   * **Multi-tenant footgun:** the read side (`agent.run({ identity })`)
   * queries within whichever identity is passed at request time.
   * If you index here under `_global` but query under
   * `{ tenant: 'acme' }`, you'll get ZERO results — silently. Either:
   *   1. Index every document under each tenant's identity (duplicated
   *      storage, but isolated), or
   *   2. Index under `_global` AND query under `_global` (shared
   *      corpus across tenants — fine for product docs, NOT for
   *      tenant-private data), or
   *   3. Use a vector store adapter that supports multi-namespace
   *      reads at query time (Pinecone, Qdrant — outside this helper's
   *      scope).
   */
  readonly identity?: MemoryIdentity;

  /**
   * Stable id of the embedder. Stored on each entry so a future
   * embedder swap doesn't silently mix similarity scores. Default:
   * `'default-embedder'` — pass an explicit id when you may rotate
   * embedders.
   */
  readonly embedderId?: string;

  /**
   * Optional tier tag to attach to indexed entries (`'hot'` /
   * `'warm'` / `'cold'`). Useful when read-side `defineRAG` should
   * filter to a subset of the corpus.
   */
  readonly tier?: 'hot' | 'warm' | 'cold';

  /**
   * Optional TTL in milliseconds from indexing time. Useful for
   * compliance retention windows (e.g., re-index quarterly).
   */
  readonly ttlMs?: number;

  /**
   * Optional abort signal — embedders making network calls thread
   * this through to abort batch indexing on shutdown / timeout.
   */
  readonly signal?: AbortSignal;

  /**
   * Max number of concurrent embed calls when the embedder doesn't
   * implement `embedBatch`. Default `8`. Without this cap, a 10K-doc
   * corpus would fire 10K parallel embed calls and trigger rate limits.
   * Ignored when `embedBatch` is available (the embedder controls
   * its own batching).
   */
  readonly maxConcurrency?: number;
}

const DEFAULT_IDENTITY: MemoryIdentity = { conversationId: '_global' };

/**
 * Embed + persist documents. Returns the count actually indexed
 * (skips duplicates if the store rejects them). Throws on embedder
 * failure or store error — fail loud at startup is desirable.
 *
 * **Re-indexing semantics:** entries are written with `version: 1` and
 * `putMany` (most adapters: last-write-wins). Re-running this helper
 * after the store has been mutated by other writers may stomp their
 * versions. For idempotent corpus refresh, either delete-then-index
 * or use a custom upsert via `store.putIfVersion()` per document. A
 * first-class `mode: 'upsert' | 'replace'` API is planned for a
 * future release.
 */
export async function indexDocuments(
  store: MemoryStore,
  embedder: Embedder,
  documents: readonly RagDocument[],
  options: IndexDocumentsOptions = {},
): Promise<number> {
  if (!store) throw new Error('indexDocuments: `store` is required.');
  if (!embedder) throw new Error('indexDocuments: `embedder` is required.');
  if (!Array.isArray(documents) || documents.length === 0) return 0;

  const identity = options.identity ?? DEFAULT_IDENTITY;
  const embedderId = options.embedderId ?? 'default-embedder';
  const now = Date.now();
  const ttl = options.ttlMs ? now + options.ttlMs : undefined;

  // Embed in batch when supported, else fall back to capped-concurrency
  // single calls. Unlimited concurrency on a large corpus would
  // saturate embedder rate limits; cap defaults to 8.
  const texts = documents.map((d) => d.content);
  let vectors: readonly (readonly number[])[];
  if (embedder.embedBatch) {
    vectors = await embedder.embedBatch({
      texts,
      ...(options.signal && { signal: options.signal }),
    });
  } else {
    const limit = Math.max(1, options.maxConcurrency ?? 8);
    vectors = await embedWithConcurrency(embedder, texts, limit, options.signal);
  }

  const entries: MemoryEntry<RagDocument>[] = documents.map((doc, i) => {
    const vec = vectors[i];
    return {
      id: doc.id,
      value: doc,
      version: 1,
      createdAt: now,
      updatedAt: now,
      lastAccessedAt: now,
      accessCount: 0,
      ...(vec && vec.length > 0 && { embedding: [...vec] }),
      embeddingModel: embedderId,
      ...(ttl !== undefined && { ttl }),
      ...(options.tier && { tier: options.tier }),
      source: { turn: 0, identity },
    };
  });

  await store.putMany(identity, entries);
  return entries.length;
}

async function embedWithConcurrency(
  embedder: Embedder,
  texts: readonly string[],
  limit: number,
  signal?: AbortSignal,
): Promise<readonly (readonly number[])[]> {
  const results: (readonly number[])[] = new Array(texts.length);
  let next = 0;
  const workers = Array.from({ length: Math.min(limit, texts.length) }, async () => {
    for (;;) {
      const i = next++;
      if (i >= texts.length) return;
      // i bounded by texts.length above; texts[i] is defined.
      // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
      const text = texts[i]!;
      results[i] = await embedder.embed({
        text,
        ...(signal && { signal }),
      });
    }
  });
  await Promise.all(workers);
  return results;
}
