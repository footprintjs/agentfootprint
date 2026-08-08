/**
 * staticVectorStore — serve a corpus that was built somewhere else.
 *
 * Pattern: read-only `MemoryStore` adapter over a plain-JSON bundle.
 * Role:    memory/store layer, beside `InMemoryStore` — the runtime half of
 *          the corpus-as-build-artifact story (`exportCorpus` in
 *          `agentfootprint/rag` is the build half).
 * Emits:   N/A.
 *
 * ── Why a corpus would be a build artifact ──────────────────────────────────
 * An immutable or serverless runtime has no durable disk and often no
 * credentials to an embedding API — while the BUILD machine has both. The
 * field-reported shape: index the documents where the credentials live, ship
 * the result with the deploy, serve it read-only where the process runs. The
 * bundle is deliberately plain JSON — `JSON.parse(readFileSync(...))`, a
 * bundler import, a KV fetch — because the runtime that needs this is exactly
 * the runtime that cannot open a database file.
 *
 *   build time:   indexCorpus → exportCorpus(store) → corpus.json
 *   run time:     staticVectorStore(bundle) → defineRAG({ store })
 *
 * ── What it refuses, and why loudly ─────────────────────────────────────────
 * Writes. A static corpus is not a conversation log, and accepting a write
 * that evaporates with the process would be the quiet version of losing data.
 * Every write method throws a refusal naming the fix (re-export at build
 * time, or use a writable store).
 *
 * The wrong embedder. The bundle records the embedder id and dimensions it
 * was built with. Pass your runtime embedder as the second argument and a
 * mismatch is refused AT LOAD — the same rule `sqliteVectorStore` enforces:
 * dimensions always decide; ids decide only when both sides named themselves.
 * At search time, a query vector of the wrong length, or an `embedderId`
 * naming a different space, is refused rather than silently ranking to
 * nothing — the field report's own embedder-id format change was caught by
 * exactly this class of check.
 *
 * Entries are seeded in the exact shape the retrieval formatter reads —
 * `value.content` for the passage (with provenance under `value.metadata`) —
 * because a corpus that indexes perfectly and renders an empty passage was
 * this door's worst shipped bug (8.19.0).
 */
import type { MemoryIdentity } from '../identity/index.js';
import { identityNamespace } from '../identity/index.js';
import type { MemoryEntry } from '../entry/index.js';
import { cosineSimilarity } from '../embedding/cosine.js';
import type {
  ListOptions,
  ListResult,
  MemoryStore,
  PutIfVersionResult,
  ScoredEntry,
  SearchOptions,
} from './types.js';

/** The bundle format marker. Version the FORMAT, not the library. */
export const CORPUS_BUNDLE_FORMAT = 'agentfootprint-corpus-v1' as const;

/** One exported corpus entry: the passage, its vector, and its coordinates. */
export interface CorpusBundleEntry {
  /** The chunk id, e.g. `'refunds.md#3'` — what the model cites. */
  readonly id: string;
  /** The passage text. */
  readonly text: string;
  /** The embedding vector, in the bundle embedder's space. */
  readonly vector: readonly number[];
  /**
   * Everything else the stored value carried — provenance (`docUri`,
   * `heading`, `page`, offsets, hashes) and any consumer metadata, flattened
   * into one record the retrieval formatter's provenance reader understands.
   */
  readonly metadata?: Readonly<Record<string, unknown>>;
}

/**
 * A corpus as a plain-JSON build artifact. Produced by `exportCorpus`
 * (`agentfootprint/rag`), served by {@link staticVectorStore}, loadable into a
 * writable store by `importCorpus`. Survives `JSON.stringify` → `JSON.parse`
 * byte-for-byte, which is the whole point.
 */
export interface CorpusBundle {
  readonly format: typeof CORPUS_BUNDLE_FORMAT;
  /** The embedding space every vector in `entries` lives in. */
  readonly embedder: {
    /** The embedder id recorded at index time (`'default-embedder'` when the index never named one). */
    readonly id: string;
    /** Vector length. Every entry's vector has exactly this many numbers. */
    readonly dimensions: number;
  };
  /** The namespace the corpus was exported from (`identityNamespace` form). */
  readonly namespace: string;
  /** Unix ms at export time. */
  readonly exportedAt: number;
  readonly entries: readonly CorpusBundleEntry[];
}

/** The embedder-shaped slice the load-time fingerprint check needs. */
export interface EmbedderFingerprint {
  readonly id?: string;
  readonly dimensions: number;
}

/**
 * Validate a value as a `CorpusBundle`, teachingly. Shared by
 * `staticVectorStore` and `importCorpus`, so a truncated file or a
 * hand-edited bundle fails the same way at every door.
 */
export function assertCorpusBundle(
  bundle: unknown,
  caller: string,
): asserts bundle is CorpusBundle {
  const b = bundle as Partial<CorpusBundle> | null | undefined;
  if (b === null || typeof b !== 'object') {
    throw new Error(
      `${caller}: expected a corpus bundle object, received ${b === null ? 'null' : typeof b}. ` +
        `A bundle comes from exportCorpus() — typically JSON.parse of the file it was saved to.`,
    );
  }
  if (b.format !== CORPUS_BUNDLE_FORMAT) {
    throw new Error(
      `${caller}: this is not a corpus bundle — \`format\` is ${JSON.stringify(
        (b as { format?: unknown }).format,
      )}, expected '${CORPUS_BUNDLE_FORMAT}'. Bundles are produced by exportCorpus(); a raw ` +
        `entries array or a different artifact cannot be served as one.`,
    );
  }
  const dims = b.embedder?.dimensions;
  if (typeof b.embedder?.id !== 'string' || typeof dims !== 'number' || dims < 1) {
    throw new Error(
      `${caller}: the bundle does not name its embedding space — \`embedder\` must carry a ` +
        `string \`id\` and a positive \`dimensions\`. Without them nothing can refuse a wrong ` +
        `embedder at load, which is the silent failure this format exists to prevent.`,
    );
  }
  if (typeof b.namespace !== 'string' || b.namespace.length === 0) {
    throw new Error(
      `${caller}: the bundle carries no \`namespace\`. Re-export with exportCorpus().`,
    );
  }
  if (!Array.isArray(b.entries)) {
    throw new Error(`${caller}: \`entries\` must be an array. Re-export with exportCorpus().`);
  }
  b.entries.forEach((entry: Partial<CorpusBundleEntry>, i: number) => {
    const where = `entries[${i}]${entry?.id ? ` ('${entry.id}')` : ''}`;
    if (!entry || typeof entry.id !== 'string' || entry.id.length === 0) {
      throw new Error(`${caller}: ${where} has no \`id\`.`);
    }
    if (typeof entry.text !== 'string' || entry.text.trim().length === 0) {
      throw new Error(
        `${caller}: ${where} has no passage on \`text\`. A citable id with nothing to cite is ` +
          `the blank-citation bug; a bundle never carries one.`,
      );
    }
    if (!Array.isArray(entry.vector) || entry.vector.length !== dims) {
      throw new Error(
        `${caller}: ${where} carries a vector of length ` +
          `${Array.isArray(entry.vector) ? entry.vector.length : 'none'}, but the bundle's ` +
          `embedder declares ${dims} dimensions. The bundle is corrupt or hand-edited — ` +
          `re-export it.`,
      );
    }
  });
}

/**
 * The `MemoryEntry` a bundle entry seeds — in the exact shape the retrieval
 * formatter reads: passage on `value.content`, provenance under
 * `value.metadata`. Shared with `importCorpus` so a static corpus and an
 * imported one render identically.
 */
export function bundleEntryToMemoryEntry(
  entry: CorpusBundleEntry,
  bundle: CorpusBundle,
): MemoryEntry<{ id: string; content: string; metadata?: Record<string, unknown> }> {
  return {
    id: entry.id,
    value: {
      id: entry.id,
      content: entry.text,
      ...(entry.metadata !== undefined && { metadata: { ...entry.metadata } }),
    },
    version: 1,
    createdAt: bundle.exportedAt,
    updatedAt: bundle.exportedAt,
    lastAccessedAt: bundle.exportedAt,
    accessCount: 0,
    embedding: [...entry.vector],
    embeddingModel: bundle.embedder.id,
  };
}

const READ_ONLY_FIX =
  `A static corpus is a build artifact: change it by re-indexing at build time and ` +
  `re-exporting (exportCorpus), or load the bundle into a writable store with ` +
  `importCorpus(store, bundle). For conversation memory alongside a static corpus, ` +
  `register a SEPARATE defineMemory with its own writable store.`;

function refuseWrite(method: string): never {
  throw new Error(
    `staticVectorStore.${method}: this store is read-only — accepting the write and losing ` +
      `it with the process would be the quiet version of data loss. ${READ_ONLY_FIX}`,
  );
}

/**
 * Serve an exported corpus bundle as a read-only, vector-capable
 * `MemoryStore`.
 *
 * @param bundle   a `CorpusBundle` from `exportCorpus` (usually
 *                 `JSON.parse` of the shipped file).
 * @param embedder optional — the embedder the RUNTIME will query with (or
 *                 just `{ id, dimensions }`). When given, a fingerprint
 *                 mismatch is refused HERE, at load, instead of surfacing as
 *                 an empty retrieval at the first question. Recommended.
 *
 * @example
 * ```ts
 * import { staticVectorStore } from 'agentfootprint/memory';
 * import corpus from './corpus.json';
 *
 * const store = staticVectorStore(corpus, embedder);
 * const docs = defineRAG({ id: 'docs', store, embedder });
 * ```
 */
export function staticVectorStore(
  bundle: CorpusBundle,
  embedder?: EmbedderFingerprint,
): MemoryStore {
  assertCorpusBundle(bundle, 'staticVectorStore');

  if (embedder !== undefined) {
    // The sqliteVectorStore rule, applied at load: dimensions ALWAYS decide;
    // ids decide only when both sides named themselves.
    if (embedder.dimensions !== bundle.embedder.dimensions) {
      throw new Error(
        `staticVectorStore: this bundle was built in '${bundle.embedder.id}@` +
          `${bundle.embedder.dimensions}' and the configured embedder produces ` +
          `${embedder.dimensions}-dimensional vectors. Vectors of different lengths cannot ` +
          `be compared at all. Re-export the corpus with the runtime's embedder, or ` +
          `configure the embedder the corpus was built with.`,
      );
    }
    if (embedder.id !== undefined && embedder.id !== bundle.embedder.id) {
      throw new Error(
        `staticVectorStore: this bundle was built in '${bundle.embedder.id}@` +
          `${bundle.embedder.dimensions}' and the configured embedder is '${embedder.id}'. ` +
          `Cosine similarity between two embedding spaces is not a weak signal — it is not ` +
          `a signal, and it comes back as a confident number in the same range as a real ` +
          `one. Re-export the corpus with '${embedder.id}', or configure ` +
          `'${bundle.embedder.id}'.`,
      );
    }
  }

  const entries = new Map<string, MemoryEntry<unknown>>();
  for (const entry of bundle.entries) {
    entries.set(entry.id, bundleEntryToMemoryEntry(entry, bundle));
  }
  const namespace = bundle.namespace;

  const inNamespace = (identity: MemoryIdentity): boolean =>
    identityNamespace(identity) === namespace;

  return {
    // Vectors in, ranked vectors out — the cosine scan below ranks the
    // embeddings the bundle carries. Declared, so corpus builders can tell
    // this apart from a server-side store (and refuse to INDEX into it —
    // which they will anyway, at the first write).
    supportsVectorSearch: true,

    async get<T = unknown>(identity: MemoryIdentity, id: string): Promise<MemoryEntry<T> | null> {
      if (!inNamespace(identity)) return null;
      // No access-count bump: the store is read-only, decay signals frozen
      // at export.
      return (entries.get(id) as MemoryEntry<T> | undefined) ?? null;
    },

    async put(): Promise<void> {
      refuseWrite('put');
    },
    async putMany(): Promise<void> {
      refuseWrite('putMany');
    },
    async putIfVersion(): Promise<PutIfVersionResult> {
      refuseWrite('putIfVersion');
    },
    async delete(): Promise<void> {
      refuseWrite('delete');
    },
    async forget(): Promise<void> {
      refuseWrite('forget');
    },
    async recordSignature(): Promise<void> {
      refuseWrite('recordSignature');
    },
    async feedback(): Promise<void> {
      refuseWrite('feedback');
    },

    async list<T = unknown>(
      identity: MemoryIdentity,
      options?: ListOptions,
    ): Promise<ListResult<T>> {
      if (!inNamespace(identity)) return { entries: [] };
      const limit = Math.max(1, Math.min(options?.limit ?? 100, 1000));
      const all = [...entries.values()];
      const offset = options?.cursor ? parseInt(options.cursor, 10) : 0;
      const safeOffset = Number.isFinite(offset) && offset >= 0 ? offset : 0;
      const page = all.slice(safeOffset, safeOffset + limit);
      const next = safeOffset + page.length;
      return {
        entries: page as MemoryEntry<T>[],
        ...(next < all.length && { cursor: String(next) }),
      };
    },

    async seen(): Promise<boolean> {
      return false; // no signature set was exported; recognition is a write-side concern
    },

    async getFeedback(): Promise<{ average: number; count: number } | null> {
      return null;
    },

    async search<T = unknown>(
      identity: MemoryIdentity,
      query: readonly number[],
      options?: SearchOptions,
    ): Promise<readonly ScoredEntry<T>[]> {
      // A wrong-space query is refused BY NAME rather than ranked to an empty
      // page — the loud version of the mismatch machinery, because on a
      // static corpus "no results" reads as "the corpus has nothing to say".
      if (query.length !== bundle.embedder.dimensions) {
        throw new Error(
          `staticVectorStore.search: the query vector has ${query.length} dimensions, but ` +
            `this bundle was built in '${bundle.embedder.id}@${bundle.embedder.dimensions}'. ` +
            `The query was embedded with a different embedder than the corpus. Configure the ` +
            `embedder the corpus was built with, or re-export the corpus.`,
        );
      }
      if (options?.embedderId !== undefined && options.embedderId !== bundle.embedder.id) {
        throw new Error(
          `staticVectorStore.search: the retriever declares embedderId '${options.embedderId}' ` +
            `but this bundle was built in '${bundle.embedder.id}@` +
            `${bundle.embedder.dimensions}'. Silently skipping every entry would look like an ` +
            `empty corpus. Align the retriever's \`embedderId\` with the bundle, or re-export ` +
            `the corpus with the new embedder.`,
        );
      }
      if (!inNamespace(identity)) return [];

      const k = options?.k ?? 10;
      const tierFilter = options?.tiers ? new Set(options.tiers) : undefined;
      const minScore = options?.minScore;
      const scored: ScoredEntry<T>[] = [];
      for (const entry of entries.values()) {
        if (tierFilter && (!entry.tier || !tierFilter.has(entry.tier))) continue;
        const emb = entry.embedding;
        if (!emb || emb.length !== query.length) continue;
        const score = cosineSimilarity(emb, query);
        if (minScore !== undefined && score < minScore) continue;
        scored.push({ entry: entry as MemoryEntry<T>, score });
      }
      scored.sort((a, b) => {
        if (b.score !== a.score) return b.score - a.score;
        return a.entry.id < b.entry.id ? -1 : a.entry.id > b.entry.id ? 1 : 0;
      });
      return scored.slice(0, k);
    },
  };
}
