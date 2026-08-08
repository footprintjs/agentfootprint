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

  /**
   * The longest input, in CHARACTERS, this embedder represents FAITHFULLY
   * (9.1.0). Text past it is not refused by the backend — it is CLIPPED, and
   * a full-looking vector comes back for the opening of the passage.
   *
   * That is the failure this field exists to stop. An indexer stores the whole
   * chunk as the passage and the clipped vector as its index, so retrieval
   * cannot find text that is visibly present in the passage it later serves.
   * Nothing throws, nothing scores zero; the corpus is simply, quietly,
   * partially indexed.
   *
   * The number belongs HERE because this is the only object that knows it. An
   * indexer's own default is a guess about a backend it has never met: it is
   * necessarily the smallest ceiling any embedder might have, which then
   * under-uses every embedder that can read four times as much. Declared, the
   * indexers (`indexCorpus`, `indexFolder`, `indexDocuments`) read this in
   * preference to their own default, and an explicit `maxChunkChars` on the
   * call still wins over both — the caller is allowed to know better.
   *
   * Optional, because `Embedder` is a structural interface and every
   * hand-written one predates this field. Absent, the indexers behave exactly
   * as they did before it existed. Every shipped embedder declares one, and a
   * hand-written embedder over a hosted model should: the alternative is that
   * its ceiling is discovered by someone reading a retrieval result that is
   * missing a paragraph they can see.
   *
   * Characters rather than tokens, because a splitter cuts characters. Where
   * a backend states a TOKEN limit, the shipped embedders convert it at a
   * stated, deliberately conservative characters-per-token assumption and say
   * so in their own docs.
   */
  readonly maxInputChars?: number;

  /** Embed a single text into a vector of length `dimensions`. */
  embed(args: EmbedArgs): Promise<number[]>;

  /**
   * Optional batch API. When present, pipeline stages can avoid N
   * sequential round-trips for turn-level indexing. Adapter SHOULD
   * implement when the backend supports it.
   */
  embedBatch?(args: EmbedBatchArgs): Promise<number[][]>;
}
