/**
 * mockEmbedder — 5-pattern tests.
 *
 * Tiers:
 *   - unit:     embeds produce vectors of the right length
 *   - boundary: empty string, zero-length, custom dimensions
 *   - scenario: semantic similarity — shared chars have higher cosine
 *   - property: deterministic (same text → same vector)
 *   - security: invalid dimensions throw at construction
 */
import { describe, expect, it } from 'vitest';
import { mockEmbedder } from '../../../src/memory/embedding/mockEmbedder';
import { cosineSimilarity } from '../../../src/memory/embedding/cosine';

// ── Unit ────────────────────────────────────────────────────

describe('mockEmbedder — unit', () => {
  it('produces a vector of length `dimensions`', async () => {
    const emb = mockEmbedder({ dimensions: 16 });
    const v = await emb.embed({ text: 'hello' });
    expect(v).toHaveLength(16);
  });

  it('exposes dimensions field constant', () => {
    const emb = mockEmbedder({ dimensions: 64 });
    expect(emb.dimensions).toBe(64);
  });

  it('default dimensions is 32', () => {
    const emb = mockEmbedder();
    expect(emb.dimensions).toBe(32);
  });

  it('embedBatch returns an array of vectors', async () => {
    const emb = mockEmbedder({ dimensions: 8 });
    const vs = await emb.embedBatch!({ texts: ['a', 'bc', 'def'] });
    expect(vs).toHaveLength(3);
    for (const v of vs) expect(v).toHaveLength(8);
  });
});

// ── Boundary ────────────────────────────────────────────────

describe('mockEmbedder — boundary', () => {
  it('empty string → zero vector', async () => {
    const emb = mockEmbedder({ dimensions: 16 });
    const v = await emb.embed({ text: '' });
    expect(v.every((x) => x === 0)).toBe(true);
  });

  it('single-char text → sparse vector (one non-zero entry)', async () => {
    const emb = mockEmbedder({ dimensions: 32 });
    const v = await emb.embed({ text: 'x' });
    const nonZero = v.filter((x) => x !== 0);
    expect(nonZero).toHaveLength(1);
    expect(nonZero[0]).toBe(1);
  });

  it('dimensions=1 still works', async () => {
    const emb = mockEmbedder({ dimensions: 1 });
    const v = await emb.embed({ text: 'anything' });
    expect(v).toHaveLength(1);
    expect(v[0]).toBe('anything'.length); // all chars collapse to index 0
  });
});

// ── Scenario ────────────────────────────────────────────────

describe('mockEmbedder — scenario', () => {
  it('texts sharing characters score higher cosine than unrelated texts', async () => {
    const emb = mockEmbedder({ dimensions: 128 });
    const query = await emb.embed({ text: 'my favorite pet is a dog' });
    const aboutDogs = await emb.embed({ text: 'dogs are great companions' });
    const aboutNumbers = await emb.embed({ text: '12345 67890 !@#$%' });

    const simDogs = cosineSimilarity(query, aboutDogs);
    const simNumbers = cosineSimilarity(query, aboutNumbers);
    expect(simDogs).toBeGreaterThan(simNumbers);
  });

  it('identical texts give cosine 1', async () => {
    const emb = mockEmbedder();
    const a = await emb.embed({ text: 'same text' });
    const b = await emb.embed({ text: 'same text' });
    expect(cosineSimilarity(a, b)).toBeCloseTo(1);
  });
});

// ── Property ────────────────────────────────────────────────

describe('mockEmbedder — property', () => {
  it('is deterministic — same text always yields the same vector', async () => {
    const emb = mockEmbedder({ dimensions: 32 });
    const texts = ['hello', 'world', '', 'a', 'The quick brown fox'];
    for (const text of texts) {
      const v1 = await emb.embed({ text });
      const v2 = await emb.embed({ text });
      expect(v1).toEqual(v2);
    }
  });

  it('embedBatch result equals N sequential embed() calls', async () => {
    const emb = mockEmbedder({ dimensions: 16 });
    const texts = ['one', 'two', 'three'];
    const batch = await emb.embedBatch!({ texts });
    for (let i = 0; i < texts.length; i++) {
      const single = await emb.embed({ text: texts[i] });
      expect(batch[i]).toEqual(single);
    }
  });

  it('vectors have finite, non-negative coordinates (char counts)', async () => {
    const emb = mockEmbedder();
    const v = await emb.embed({ text: 'Hello, World! 123' });
    for (const x of v) {
      expect(Number.isFinite(x)).toBe(true);
      expect(x).toBeGreaterThanOrEqual(0);
    }
  });
});

// ── Security ────────────────────────────────────────────────

describe('mockEmbedder — security', () => {
  it('rejects non-integer dimensions', () => {
    expect(() => mockEmbedder({ dimensions: 3.5 })).toThrow(/positive integer/);
  });

  it('rejects zero or negative dimensions', () => {
    expect(() => mockEmbedder({ dimensions: 0 })).toThrow(/positive integer/);
    expect(() => mockEmbedder({ dimensions: -1 })).toThrow(/positive integer/);
  });

  it('extremely long text is embedded without error', async () => {
    const emb = mockEmbedder({ dimensions: 32 });
    const huge = 'a'.repeat(100_000);
    const v = await emb.embed({ text: huge });
    expect(v).toHaveLength(32);
    const total = v.reduce((s, x) => s + x, 0);
    expect(total).toBe(100_000); // every char counted exactly once
  });
});
