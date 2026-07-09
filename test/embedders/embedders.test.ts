import { describe, it, expect, vi, afterEach } from 'vitest';
import { openaiEmbedder, localEmbedder, staticEmbedder } from '../../src/embedders/index.js';

afterEach(() => vi.unstubAllGlobals());

describe('openaiEmbedder', () => {
  it('throws without an api key', () => {
    expect(() => openaiEmbedder({ apiKey: '' })).toThrow(/api key/i);
  });

  it('embeds one text via the OpenAI API (mocked fetch)', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ data: [{ embedding: [0.1, 0.2, 0.3] }] }),
    });
    vi.stubGlobal('fetch', fetchMock);
    const e = openaiEmbedder({ apiKey: 'sk-test', dimensions: 3 });
    expect(e.dimensions).toBe(3);
    expect(await e.embed({ text: 'hello' })).toEqual([0.1, 0.2, 0.3]);
    const [url, init] = fetchMock.mock.calls[0] as [
      string,
      { body: string; headers: Record<string, string> },
    ];
    expect(url).toContain('/embeddings');
    expect(JSON.parse(init.body).input).toEqual(['hello']);
    expect(init.headers.authorization).toBe('Bearer sk-test');
  });

  it('batch embeds', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ data: [{ embedding: [1] }, { embedding: [2] }] }),
      }),
    );
    const e = openaiEmbedder({ apiKey: 'sk-test' });
    expect(await e.embedBatch!({ texts: ['a', 'b'] })).toEqual([[1], [2]]);
  });

  it('surfaces API errors', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({ ok: false, status: 429, text: async () => 'rate limited' }),
    );
    await expect(openaiEmbedder({ apiKey: 'sk-test' }).embed({ text: 'x' })).rejects.toThrow(/429/);
  });
});

describe('local / static embedders (optional peer deps, lazy)', () => {
  it('localEmbedder has the MiniLM dimensions + the Embedder shape (no import yet)', () => {
    const e = localEmbedder();
    expect(e.dimensions).toBe(384);
    expect(typeof e.embed).toBe('function');
    expect(typeof e.embedBatch).toBe('function');
  });

  it('staticEmbedder has the potion dimensions + batch', () => {
    const e = staticEmbedder();
    expect(e.dimensions).toBe(256);
    expect(typeof e.embed).toBe('function');
    expect(typeof e.embedBatch).toBe('function');
  });

  it('localEmbedder.embed rejects cleanly when the peer dep is not installed', async () => {
    // @huggingface/transformers is an OPTIONAL peer, not installed here → the
    // lazy dynamic import rejects rather than being a build/import-time failure.
    await expect(localEmbedder().embed({ text: 'x' })).rejects.toBeTruthy();
  });
});

function cosine(a: number[], b: number[]): number {
  let dot = 0;
  let na = 0;
  let nb = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i]! * b[i]!;
    na += a[i]! * a[i]!;
    nb += b[i]! * b[i]!;
  }
  return dot / (Math.sqrt(na) * Math.sqrt(nb) || 1);
}

// Real integration test against the potion peer dep (installed as a devDependency
// here; OPTIONAL for consumers). This is what verifies the adapter actually maps
// potion's async `embed(texts) => Promise<Float32Array[]>` onto the Embedder shape
// — the previous adapter guessed a synchronous encoder and silently produced [].
describe('staticEmbedder (real potion embeddings)', () => {
  it('embeds to 256-dim vectors and preserves semantic similarity', async () => {
    const e = staticEmbedder();

    const [dress] = [await e.embed({ text: 'a red evening dress' })];
    expect(dress).toHaveLength(256);
    expect(dress.every((n) => typeof n === 'number' && Number.isFinite(n))).toBe(true);

    // Related text should be more similar to the dress than an unrelated one.
    const gown = await e.embed({ text: 'an elegant crimson gown' });
    const taxes = await e.embed({ text: 'quarterly corporate tax accounting' });
    expect(cosine(dress, gown)).toBeGreaterThan(cosine(dress, taxes));
  }, 30_000);

  it('embedBatch returns one 256-dim row per input, matching embed()', async () => {
    const e = staticEmbedder();
    const rows = await e.embedBatch!({ texts: ['hello world', 'goodbye moon'] });
    expect(rows).toHaveLength(2);
    expect(rows[0]).toHaveLength(256);
    expect(rows[1]).toHaveLength(256);

    const single = await e.embed({ text: 'hello world' });
    expect(cosine(rows[0]!, single)).toBeGreaterThan(0.999); // same text ⇒ same vector
  }, 30_000);
});
