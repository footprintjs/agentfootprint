import { describe, it, expect, vi, afterEach } from 'vitest';
import { openaiEmbedder, localEmbedder, staticEmbedder } from '../../src/embedders/index.js';

afterEach(() => vi.unstubAllGlobals());

describe('openaiEmbedder', () => {
  it('throws without an api key', () => {
    expect(() => openaiEmbedder({ apiKey: '' })).toThrow(/api key/i);
  });

  it('embeds one text via the OpenAI API (mocked fetch)', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue({ ok: true, json: async () => ({ data: [{ embedding: [0.1, 0.2, 0.3] }] }) });
    vi.stubGlobal('fetch', fetchMock);
    const e = openaiEmbedder({ apiKey: 'sk-test', dimensions: 3 });
    expect(e.dimensions).toBe(3);
    expect(await e.embed({ text: 'hello' })).toEqual([0.1, 0.2, 0.3]);
    const [url, init] = fetchMock.mock.calls[0] as [string, { body: string; headers: Record<string, string> }];
    expect(url).toContain('/embeddings');
    expect(JSON.parse(init.body).input).toEqual(['hello']);
    expect(init.headers.authorization).toBe('Bearer sk-test');
  });

  it('batch embeds', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({ ok: true, json: async () => ({ data: [{ embedding: [1] }, { embedding: [2] }] }) }),
    );
    const e = openaiEmbedder({ apiKey: 'sk-test' });
    expect(await e.embedBatch!({ texts: ['a', 'b'] })).toEqual([[1], [2]]);
  });

  it('surfaces API errors', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 429, text: async () => 'rate limited' }));
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

  it('staticEmbedder has the potion dimensions', () => {
    const e = staticEmbedder();
    expect(e.dimensions).toBe(256);
    expect(typeof e.embed).toBe('function');
  });

  it('localEmbedder.embed rejects cleanly when the peer dep is not installed', async () => {
    // @huggingface/transformers is an OPTIONAL peer, not installed here → the
    // lazy dynamic import rejects rather than being a build/import-time failure.
    await expect(localEmbedder().embed({ text: 'x' })).rejects.toBeTruthy();
  });
});
