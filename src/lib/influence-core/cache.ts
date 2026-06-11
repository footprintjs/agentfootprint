/**
 * EmbeddingCache — content-hash embedding cache (RFC-002 §3).
 *
 * Pattern: transparent Decorator — implements `Embedder` itself, so
 *          every influence-core function (and any other embedder
 *          consumer) takes a plain `Embedder` and the cache is pure
 *          injection: wrap once, thread the SAME instance through
 *          lint + margins + edge weights, and a description embedded
 *          for the catalog lint is free for the margin scorer.
 * Role:    `src/lib/influence-core/` leaf. No agent/runtime imports.
 *
 * ## Bounded honesty (the library convention)
 *
 * The cache is BOUNDED — `maxEntries` caps memory (LRU eviction), and
 * the eviction count is VISIBLE via `stats()`. A consumer seeing
 * `evictions > 0` knows the cache is thrashing and can size it up;
 * nothing silently degrades out of view.
 *
 * ## Keying
 *
 * Entries are keyed by `contentHash(text)` — a fast non-cryptographic
 * 64-bit FNV-1a (length-qualified). NOT a security boundary: it
 * deduplicates embedding calls, it does not authenticate content.
 * Collisions are astronomically unlikely at cache scale (≤ maxEntries
 * live keys) but would silently return the colliding text's vector —
 * acceptable for a similarity proxy, never rely on it for exact-match
 * semantics. One cache per embedder instance: keys do NOT encode the
 * model, so sharing one cache across different embedders would mix
 * vector spaces (the same reason `MemoryStore` rejects mixed
 * dimensions).
 *
 * ## Concurrency
 *
 * In-flight requests coalesce: N concurrent `embed()` calls for the
 * same text issue ONE inner call (single-flight). Rejections are NOT
 * cached — a failed embedding retries on the next request.
 */
import type { Embedder, EmbedArgs, EmbedBatchArgs } from './types.js';

/**
 * Fast, deterministic, browser-safe content hash (FNV-1a, two 32-bit
 * lanes + length qualifier → "len-xxxxxxxxyyyyyyyy"). Non-cryptographic
 * — cache keying only.
 */
export function contentHash(text: string): string {
  let h1 = 0x811c9dc5; // FNV offset basis
  let h2 = 0xcbf29ce4; // second lane, different seed
  for (let i = 0; i < text.length; i++) {
    const c = text.charCodeAt(i);
    h1 = Math.imul(h1 ^ c, 0x01000193); // FNV prime
    h2 = Math.imul(h2 ^ c, 0x01000197); // distinct odd prime
  }
  const lane1 = (h1 >>> 0).toString(16).padStart(8, '0');
  const lane2 = (h2 >>> 0).toString(16).padStart(8, '0');
  return `${text.length.toString(36)}-${lane1}${lane2}`;
}

export interface EmbeddingCacheOptions {
  /**
   * Maximum cached vectors. Oldest (least recently used) entries are
   * evicted past the cap; evictions are counted in `stats()`.
   * Default 1024 — a 30-tool catalog plus a long run's reasoning
   * steps fit with a wide margin.
   */
  readonly maxEntries?: number;
}

/** Visible cache health — the bounded-honesty surface. */
export interface EmbeddingCacheStats {
  /** Vectors currently held. */
  readonly size: number;
  /** The configured cap. */
  readonly maxEntries: number;
  /** Served from cache (includes coalesced in-flight joins). */
  readonly hits: number;
  /** Forwarded to the inner embedder. */
  readonly misses: number;
  /** Entries dropped to respect `maxEntries`. >0 = consider sizing up. */
  readonly evictions: number;
}

const DEFAULT_MAX_ENTRIES = 1024;

/**
 * Wrap an embedder with a bounded, content-hash-keyed LRU cache.
 * See module docs for keying, bounds, and concurrency semantics.
 */
export class EmbeddingCache implements Embedder {
  readonly dimensions: number;

  private readonly inner: Embedder;
  private readonly maxEntries: number;
  /** LRU store — Map iteration order is recency (refreshed on hit). */
  private readonly vectors = new Map<string, readonly number[]>();
  /** Single-flight joins — promises live here until settled. */
  private readonly inflight = new Map<string, Promise<number[]>>();
  private hits = 0;
  private misses = 0;
  private evictions = 0;

  constructor(inner: Embedder, options: EmbeddingCacheOptions = {}) {
    const maxEntries = options.maxEntries ?? DEFAULT_MAX_ENTRIES;
    if (!Number.isInteger(maxEntries) || maxEntries <= 0) {
      throw new Error(`EmbeddingCache: maxEntries must be a positive integer (got ${maxEntries})`);
    }
    this.inner = inner;
    this.maxEntries = maxEntries;
    this.dimensions = inner.dimensions;
  }

  async embed(args: EmbedArgs): Promise<number[]> {
    const key = contentHash(args.text);

    const cached = this.vectors.get(key);
    if (cached !== undefined) {
      this.hits += 1;
      this.refresh(key, cached);
      return cached.slice();
    }

    const joined = this.inflight.get(key);
    if (joined !== undefined) {
      this.hits += 1; // coalesced — no extra inner call
      return (await joined).slice();
    }

    this.misses += 1;
    const promise = this.inner.embed(args);
    this.inflight.set(key, promise);
    try {
      const vector = await promise;
      this.store(key, vector);
      return vector.slice();
    } finally {
      // Settled either way; rejections are never cached.
      this.inflight.delete(key);
    }
  }

  async embedBatch(args: EmbedBatchArgs): Promise<number[][]> {
    const { texts, signal } = args;
    const out = new Array<number[] | undefined>(texts.length);

    // Partition into cache hits and misses (deduplicating within the
    // batch — the same text twice embeds once).
    const missTexts: string[] = [];
    const missSlots = new Map<string, number[]>(); // key → output indices
    for (let i = 0; i < texts.length; i++) {
      const key = contentHash(texts[i]);
      const cached = this.vectors.get(key);
      if (cached !== undefined) {
        this.hits += 1;
        this.refresh(key, cached);
        out[i] = cached.slice();
        continue;
      }
      const slots = missSlots.get(key);
      if (slots !== undefined) {
        this.hits += 1; // in-batch duplicate — one inner embed serves both
        slots.push(i);
        continue;
      }
      this.misses += 1;
      missSlots.set(key, [i]);
      missTexts.push(texts[i]);
    }

    if (missTexts.length > 0) {
      const vectors = this.inner.embedBatch
        ? await this.inner.embedBatch({ texts: missTexts, ...(signal ? { signal } : {}) })
        : await this.embedSequential(missTexts, signal);
      let v = 0;
      for (const [key, slots] of missSlots) {
        const vector = vectors[v++];
        this.store(key, vector);
        for (const slot of slots) out[slot] = vector.slice();
      }
    }

    return out as number[][];
  }

  /** Visible cache health (bounded honesty — see module docs). */
  stats(): EmbeddingCacheStats {
    return {
      size: this.vectors.size,
      maxEntries: this.maxEntries,
      hits: this.hits,
      misses: this.misses,
      evictions: this.evictions,
    };
  }

  /** Drop all cached vectors. Stats counters are preserved. */
  clear(): void {
    this.vectors.clear();
  }

  private refresh(key: string, vector: readonly number[]): void {
    // Map insertion order doubles as the LRU order.
    this.vectors.delete(key);
    this.vectors.set(key, vector);
  }

  private store(key: string, vector: readonly number[]): void {
    // Defensive copy in — callers can't mutate the cached vector.
    this.vectors.set(key, vector.slice());
    while (this.vectors.size > this.maxEntries) {
      const oldest = this.vectors.keys().next().value as string;
      this.vectors.delete(oldest);
      this.evictions += 1;
    }
  }

  private async embedSequential(texts: readonly string[], signal?: AbortSignal) {
    const vectors: number[][] = [];
    for (const text of texts) {
      vectors.push(await this.inner.embed({ text, ...(signal ? { signal } : {}) }));
    }
    return vectors;
  }
}

/** Factory sugar — `embeddingCache(embedder)` reads like the built-ins. */
export function embeddingCache(
  inner: Embedder,
  options: EmbeddingCacheOptions = {},
): EmbeddingCache {
  return new EmbeddingCache(inner, options);
}
