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

  /** Embed a single text into a vector of length `dimensions`. */
  embed(args: EmbedArgs): Promise<number[]>;

  /**
   * Optional batch API. When present, pipeline stages can avoid N
   * sequential round-trips for turn-level indexing. Adapter SHOULD
   * implement when the backend supports it.
   */
  embedBatch?(args: EmbedBatchArgs): Promise<number[][]>;
}
