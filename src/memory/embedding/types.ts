/**
 * Embedder — text-to-vector abstraction.
 *
 * Pluggable interface: consumers bring their own embedding backend
 * (OpenAI, Voyage, Cohere, Sentence Transformers, a local model, a
 * custom rules-based hashing scheme, etc.). The library ships
 * `mockEmbedder()` for tests — no default real embedder, since LLM
 * providers' embedding APIs are not uniform (Anthropic doesn't
 * publish one at all).
 *
 * An embedder is configured once (model + api key + dims) and reused
 * across many turns. `dimensions` is a constant per instance — mixing
 * embedders of different dims within the same `MemoryStore` breaks
 * cosine similarity, so adapters should reject mismatched sizes.
 */

export interface EmbedArgs {
  /** The text to embed. */
  readonly text: string;
  /**
   * Optional abort signal — embedders making network calls should
   * thread this through to respect run-level timeouts.
   */
  readonly signal?: AbortSignal;
}

export interface EmbedBatchArgs {
  readonly texts: readonly string[];
  readonly signal?: AbortSignal;
}

/**
 * An Embedder turns text into a dense vector of constant dimensionality.
 * Implement `embedBatch` for backends that support one-call multi-embed
 * (OpenAI / Voyage / etc.) — without it, batch callers fall back to
 * N sequential `embed()` calls.
 */
export interface Embedder {
  /** Vector length. Constant per embedder instance. */
  readonly dimensions: number;

  /**
   * Stable name of the embedding space this instance produces (8.9.0).
   *
   * Together with `dimensions` it forms the fingerprint a durable store
   * records per vector — `'<id>@<dims>'` — and refuses on when it changes.
   * Cosine similarity between two embedding spaces is not a weak signal; it
   * is not a signal, and it comes back as a confident number in the same
   * range as a real one. A store that can name the space can refuse the mix;
   * one that cannot has to let it through.
   *
   * Optional, because an `Embedder` is a structural interface and every
   * hand-written one predates this field. When it is absent the store falls
   * back to comparing `dimensions` alone, which catches the arithmetically
   * impossible case and not the merely wrong one.
   *
   * Every shipped embedder sets it, and it is what you pass as `embedderId`:
   *
   * ```ts
   * const embedder = staticEmbedder();
   * await indexDocuments(store, embedder, docs, { embedderId: embedder.id });
   * defineRAG({ id: 'docs', store, embedder, embedderId: embedder.id });
   * ```
   */
  readonly id?: string;

  /** Embed a single text into a vector of length `dimensions`. */
  embed(args: EmbedArgs): Promise<number[]>;

  /**
   * Optional batch API. When present, pipeline stages can avoid N
   * sequential round-trips for turn-level indexing. Adapter SHOULD
   * implement when the backend supports it.
   */
  embedBatch?(args: EmbedBatchArgs): Promise<number[][]>;
}
