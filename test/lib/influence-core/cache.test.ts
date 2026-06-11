/**
 * EmbeddingCache + contentHash — unit / boundary / property /
 * security / load tiers.
 *
 * The bounded-honesty pins: the cap is RESPECTED (size never exceeds
 * maxEntries) and evictions are VISIBLE (counted in stats), never
 * silent.
 */
import { describe, expect, it } from 'vitest';
import { mockEmbedder } from '../../../src/memory/embedding/mockEmbedder';
import { contentHash, EmbeddingCache, embeddingCache } from '../../../src/lib/influence-core';
import type { Embedder } from '../../../src/lib/influence-core';

/** Counting wrapper around the deterministic mock embedder. */
function countingEmbedder(opts: { withBatch?: boolean; failFirst?: boolean } = {}) {
  const inner = mockEmbedder();
  let failed = false;
  const calls = { embed: 0, embedBatch: 0, batchTexts: [] as string[][] };
  const embedder: Embedder = {
    dimensions: inner.dimensions,
    embed: async (args) => {
      if (opts.failFirst && !failed) {
        failed = true;
        throw new Error('transient embed failure');
      }
      calls.embed += 1;
      return inner.embed(args);
    },
    ...(opts.withBatch
      ? {
          embedBatch: async (args: { texts: readonly string[] }) => {
            calls.embedBatch += 1;
            calls.batchTexts.push([...args.texts]);
            return inner.embedBatch({ texts: args.texts });
          },
        }
      : {}),
  };
  return { embedder, calls };
}

// ── contentHash ─────────────────────────────────────────────────────

describe('contentHash — unit', () => {
  it('is deterministic and content-sensitive', () => {
    expect(contentHash('hello')).toBe(contentHash('hello'));
    expect(contentHash('hello')).not.toBe(contentHash('hellp'));
    expect(contentHash('')).toBe(contentHash(''));
  });

  it('is length-qualified (prefix encodes length)', () => {
    expect(contentHash('aa').startsWith('2-')).toBe(true);
    expect(contentHash('a').startsWith('1-')).toBe(true);
  });

  it('keys are fixed-width hex lanes after the length prefix', () => {
    expect(contentHash('any text')).toMatch(/^[0-9a-z]+-[0-9a-f]{16}$/);
  });
});

// ── hit/miss accounting ─────────────────────────────────────────────

describe('EmbeddingCache — hits, misses, transparency', () => {
  it('second embed of the same text is a hit, not an inner call', async () => {
    const { embedder, calls } = countingEmbedder();
    const cache = new EmbeddingCache(embedder);
    const first = await cache.embed({ text: 'same text' });
    const second = await cache.embed({ text: 'same text' });
    expect(first).toEqual(second);
    expect(calls.embed).toBe(1);
    expect(cache.stats()).toMatchObject({ size: 1, hits: 1, misses: 1, evictions: 0 });
  });

  it('is vector-transparent: cached results equal the bare embedder (property)', async () => {
    const bare = mockEmbedder();
    const cache = new EmbeddingCache(mockEmbedder());
    const texts = ['a', 'bb', 'hello world', '!@#', '', 'hello world', 'a'];
    for (const text of texts) {
      expect(await cache.embed({ text })).toEqual(await bare.embed({ text }));
    }
  });

  it('mirrors the inner embedder dimensions', () => {
    expect(new EmbeddingCache(mockEmbedder()).dimensions).toBe(mockEmbedder().dimensions);
  });

  it('returned vectors are defensive copies — mutating one cannot poison the cache', async () => {
    const cache = new EmbeddingCache(mockEmbedder());
    const vector = await cache.embed({ text: 'mutate me' });
    vector[0] = 999999;
    const fresh = await cache.embed({ text: 'mutate me' });
    expect(fresh[0]).not.toBe(999999);
  });
});

// ── embedBatch ──────────────────────────────────────────────────────

describe('EmbeddingCache — embedBatch', () => {
  it('only misses reach the inner batch; order is preserved', async () => {
    const { embedder, calls } = countingEmbedder({ withBatch: true });
    const cache = new EmbeddingCache(embedder);
    await cache.embed({ text: 'warm' });

    const result = await cache.embedBatch({ texts: ['cold-1', 'warm', 'cold-2'] });
    expect(calls.batchTexts[0]).toEqual(['cold-1', 'cold-2']); // 'warm' never re-embeds
    const bare = mockEmbedder();
    expect(result[0]).toEqual(await bare.embed({ text: 'cold-1' }));
    expect(result[1]).toEqual(await bare.embed({ text: 'warm' }));
    expect(result[2]).toEqual(await bare.embed({ text: 'cold-2' }));
  });

  it('in-batch duplicates embed once and count as hits', async () => {
    const { embedder, calls } = countingEmbedder({ withBatch: true });
    const cache = new EmbeddingCache(embedder);
    const result = await cache.embedBatch({ texts: ['dup', 'dup', 'dup'] });
    expect(calls.batchTexts[0]).toEqual(['dup']);
    expect(result[0]).toEqual(result[1]);
    expect(result[1]).toEqual(result[2]);
    expect(cache.stats()).toMatchObject({ hits: 2, misses: 1 });
  });

  it('falls back to sequential inner.embed when the inner has no batch API', async () => {
    const { embedder, calls } = countingEmbedder();
    const cache = new EmbeddingCache(embedder);
    const result = await cache.embedBatch({ texts: ['x', 'y'] });
    expect(calls.embed).toBe(2);
    expect(result.length).toBe(2);
  });
});

// ── LRU bounds + visible eviction (bounded honesty) ─────────────────

describe('EmbeddingCache — bounded LRU with visible evictions', () => {
  it('evicts the least recently used past maxEntries and COUNTS it', async () => {
    const { embedder, calls } = countingEmbedder();
    const cache = new EmbeddingCache(embedder, { maxEntries: 2 });
    await cache.embed({ text: 'one' });
    await cache.embed({ text: 'two' });
    await cache.embed({ text: 'three' }); // evicts 'one'
    expect(cache.stats()).toMatchObject({ size: 2, evictions: 1 });

    await cache.embed({ text: 'one' }); // re-embed — it was evicted
    expect(calls.embed).toBe(4);
  });

  it('a cache hit refreshes recency — the refreshed entry survives the next eviction', async () => {
    const { embedder, calls } = countingEmbedder();
    const cache = new EmbeddingCache(embedder, { maxEntries: 2 });
    await cache.embed({ text: 'one' });
    await cache.embed({ text: 'two' });
    await cache.embed({ text: 'one' }); // refresh 'one' — now 'two' is LRU
    await cache.embed({ text: 'three' }); // evicts 'two'
    await cache.embed({ text: 'one' }); // still cached
    expect(calls.embed).toBe(3); // one, two, three — never re-embedded 'one'
  });

  it('clear() drops vectors but keeps the honesty counters', async () => {
    const cache = new EmbeddingCache(mockEmbedder(), { maxEntries: 2 });
    await cache.embed({ text: 'one' });
    cache.clear();
    expect(cache.stats()).toMatchObject({ size: 0, misses: 1 });
  });

  it('rejects a non-positive or fractional maxEntries (fail-loud)', () => {
    expect(() => new EmbeddingCache(mockEmbedder(), { maxEntries: 0 })).toThrow(/positive integer/);
    expect(() => new EmbeddingCache(mockEmbedder(), { maxEntries: 1.5 })).toThrow(
      /positive integer/,
    );
  });

  it('factory sugar builds the same thing', async () => {
    const cache = embeddingCache(mockEmbedder(), { maxEntries: 8 });
    await cache.embed({ text: 'via factory' });
    expect(cache.stats().maxEntries).toBe(8);
  });
});

// ── concurrency: single-flight + failure honesty ────────────────────

describe('EmbeddingCache — concurrency', () => {
  it('concurrent embeds of the same text coalesce into ONE inner call', async () => {
    const { embedder, calls } = countingEmbedder();
    const cache = new EmbeddingCache(embedder);
    const [a, b, c] = await Promise.all([
      cache.embed({ text: 'racy' }),
      cache.embed({ text: 'racy' }),
      cache.embed({ text: 'racy' }),
    ]);
    expect(calls.embed).toBe(1);
    expect(a).toEqual(b);
    expect(b).toEqual(c);
    expect(cache.stats()).toMatchObject({ hits: 2, misses: 1 });
  });

  it('rejections are NOT cached — the next request retries the inner embedder', async () => {
    const { embedder, calls } = countingEmbedder({ failFirst: true });
    const cache = new EmbeddingCache(embedder);
    await expect(cache.embed({ text: 'flaky' })).rejects.toThrow(/transient/);
    const vector = await cache.embed({ text: 'flaky' }); // retried, succeeds
    expect(vector.length).toBe(cache.dimensions);
    expect(calls.embed).toBe(1); // the successful call
    expect(cache.stats().size).toBe(1);
  });
});

// ── security: stats expose numbers only, never content ──────────────

describe('EmbeddingCache — security', () => {
  it('stats() carries no text, no keys, no vectors — counters only', async () => {
    const cache = new EmbeddingCache(mockEmbedder());
    await cache.embed({ text: 'secret PII content' });
    const stats = cache.stats() as unknown as Record<string, unknown>;
    expect(Object.keys(stats).sort()).toEqual([
      'evictions',
      'hits',
      'maxEntries',
      'misses',
      'size',
    ]);
    for (const value of Object.values(stats)) expect(typeof value).toBe('number');
  });
});

// ── load: the cap holds under sustained pressure ────────────────────

describe('EmbeddingCache — load', () => {
  it('10k embeds over 500 distinct texts with cap 64: size ≤ cap, evictions visible', async () => {
    const cache = new EmbeddingCache(mockEmbedder(), { maxEntries: 64 });
    for (let i = 0; i < 10_000; i++) {
      await cache.embed({ text: `text-${i % 500}` });
      if (cache.stats().size > 64) throw new Error('cap exceeded mid-run');
    }
    const stats = cache.stats();
    expect(stats.size).toBeLessThanOrEqual(64);
    expect(stats.evictions).toBeGreaterThan(0);
    expect(stats.hits + stats.misses).toBe(10_000);
  });
});
