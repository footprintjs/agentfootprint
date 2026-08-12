/**
 * `geminiEmbedder()` — the model facts, the two default task types, the
 * one-text-per-request law, and the refusal that stops a clipped vector from
 * reaching a store.
 *
 * Everything here runs through the `_client` double — a
 * `{ models: { embedContent } }` object, the same shape the Google surface pin
 * injects. No SDK, no credentials, no network.
 */

import { describe, expect, it, vi } from 'vitest';

import {
  geminiEmbedder,
  type GeminiEmbedClientLike,
  type GeminiEmbedParams,
  type GeminiEmbedResponse,
} from '../../src/embedders/index.js';

interface Recorder {
  readonly params: GeminiEmbedParams[];
  readonly client: GeminiEmbedClientLike;
}

/** A double that answers with `dims`-long vectors, one per text sent. */
function fakeEmbed(
  answer: (params: GeminiEmbedParams, call: number) => GeminiEmbedResponse,
): Recorder {
  const params: GeminiEmbedParams[] = [];
  return {
    params,
    client: {
      models: {
        embedContent(p) {
          params.push(p);
          return Promise.resolve(answer(p, params.length));
        },
      },
    },
  };
}

/** The ordinary answer: one vector per text, of the requested size. */
const vectors = (dims: number) => (params: GeminiEmbedParams) => ({
  embeddings: params.contents.map(() => ({ values: Array.from({ length: dims }, (_, i) => i) })),
});

// ── Unit — what the factory knows before it calls anything ───────────

describe('geminiEmbedder — the model facts', () => {
  it('defaults to gemini-embedding-001 at its native size, with the space in the id', () => {
    const embedder = geminiEmbedder({ apiKey: 'k' });
    expect(embedder.dimensions).toBe(3072);
    expect(embedder.id).toBe('gemini:gemini-embedding-001:3072');
    // 2,048 tokens at the stated 4-characters-per-token assumption.
    expect(embedder.maxInputChars).toBe(8000);
  });

  it('declares the OTHER model’s much larger window — which is why the ceiling is per-model', () => {
    expect(geminiEmbedder({ apiKey: 'k', model: 'gemini-embedding-2' }).maxInputChars).toBe(32_000);
  });

  it('puts the requested size in the id, because it is a different embedding space', () => {
    const embedder = geminiEmbedder({ apiKey: 'k', dimensions: 768 });
    expect(embedder.dimensions).toBe(768);
    expect(embedder.id).toBe('gemini:gemini-embedding-001:768');
  });

  it('refuses a size the model cannot produce, rather than reporting it', () => {
    expect(() => geminiEmbedder({ apiKey: 'k', dimensions: 4096 })).toThrow(/at most 3072/);
    expect(() => geminiEmbedder({ apiKey: 'k', dimensions: 0 })).toThrow(/positive whole number/);
    expect(() => geminiEmbedder({ apiKey: 'k', dimensions: 12.5 })).toThrow(
      /positive whole number/,
    );
  });

  it('refuses an unknown model with no size, and accepts one that states its own', () => {
    expect(() => geminiEmbedder({ apiKey: 'k', model: 'gemini-embedding-99' })).toThrow(
      /unknown model/,
    );
    const stated = geminiEmbedder({ apiKey: 'k', model: 'gemini-embedding-99', dimensions: 256 });
    expect(stated.dimensions).toBe(256);
    // No ceiling is DECLARED for a model this library has never met — an absent
    // one leaves the indexer's own conservative default in place, a guessed one
    // would clip in silence.
    expect(stated.maxInputChars).toBeUndefined();
  });

  it('refuses taskType on the model that takes none, and names what replaced it', () => {
    expect(() =>
      geminiEmbedder({ apiKey: 'k', model: 'gemini-embedding-2', taskType: 'CLUSTERING' }),
    ).toThrow(/takes no `task_type`/);
    expect(() =>
      geminiEmbedder({ apiKey: 'k', model: 'gemini-embedding-2', taskType: 'CLUSTERING' }),
    ).toThrow(/gemini-embedding-001/);
  });
});

// ── Unit — what goes on the wire ─────────────────────────────────────

describe('geminiEmbedder — the request', () => {
  it('embeds ONE text as a QUERY and MANY as DOCUMENTS', async () => {
    const fake = fakeEmbed(vectors(3072));
    const embedder = geminiEmbedder({ apiKey: 'k', _client: fake.client });
    await embedder.embed({ text: 'a question' });
    await embedder.embedBatch!({ texts: ['passage one', 'passage two'] });
    expect(fake.params.map((p) => p.config?.taskType)).toEqual([
      'RETRIEVAL_QUERY',
      'RETRIEVAL_DOCUMENT',
      'RETRIEVAL_DOCUMENT',
    ]);
  });

  it('a pinned taskType wins on both call sites', async () => {
    const fake = fakeEmbed(vectors(3072));
    const embedder = geminiEmbedder({
      apiKey: 'k',
      taskType: 'SEMANTIC_SIMILARITY',
      _client: fake.client,
    });
    await embedder.embed({ text: 'a' });
    await embedder.embedBatch!({ texts: ['b'] });
    expect(fake.params.every((p) => p.config?.taskType === 'SEMANTIC_SIMILARITY')).toBe(true);
  });

  it('sends outputDimensionality only when a size was asked for', async () => {
    const bare = fakeEmbed(vectors(3072));
    await geminiEmbedder({ apiKey: 'k', _client: bare.client }).embed({ text: 'a' });
    expect(bare.params[0]?.config?.outputDimensionality).toBeUndefined();

    const sized = fakeEmbed(vectors(768));
    await geminiEmbedder({ apiKey: 'k', dimensions: 768, _client: sized.client }).embed({
      text: 'a',
    });
    expect(sized.params[0]?.config?.outputDimensionality).toBe(768);
  });

  it('sends no taskType at all on the model that takes none', async () => {
    const fake = fakeEmbed(vectors(3072));
    await geminiEmbedder({
      apiKey: 'k',
      model: 'gemini-embedding-2',
      _client: fake.client,
    }).embed({ text: 'a' });
    expect(fake.params[0]?.config?.taskType).toBeUndefined();
  });

  it('sends ONE text per call — the documented limit, not a conservative guess', async () => {
    const fake = fakeEmbed(vectors(3072));
    const out = await geminiEmbedder({ apiKey: 'k', _client: fake.client }).embedBatch!({
      texts: ['a', 'b', 'c'],
    });
    expect(fake.params).toHaveLength(3);
    expect(fake.params.map((p) => p.contents)).toEqual([['a'], ['b'], ['c']]);
    expect(out).toHaveLength(3);
  });

  it('threads the abort signal into each call and stops between them', async () => {
    const controller = new AbortController();
    const fake = fakeEmbed((params, call) => {
      if (call === 1) controller.abort();
      return vectors(3072)(params);
    });
    const embedder = geminiEmbedder({ apiKey: 'k', _client: fake.client });
    await expect(
      embedder.embedBatch!({ texts: ['a', 'b', 'c'], signal: controller.signal }),
    ).rejects.toThrow();
    // One call went out; the abort was seen before the second.
    expect(fake.params).toHaveLength(1);
    expect(fake.params[0]?.config?.abortSignal).toBe(controller.signal);
  });
});

// ── Functional — the truncation refusal ──────────────────────────────

describe('geminiEmbedder — a clipped vector never reaches a store by default', () => {
  const clipped = (): GeminiEmbedResponse => ({
    embeddings: [{ values: [1, 2, 3], statistics: { truncated: true, tokenCount: 2048 } }],
  });

  it('refuses when the service admits it truncated, and names both fixes', async () => {
    const fake = fakeEmbed(clipped);
    const embedder = geminiEmbedder({ apiKey: 'k', dimensions: 3, _client: fake.client });
    await expect(embedder.embed({ text: 'x'.repeat(40_000) })).rejects.toThrow(/CLIPPED/);
    await expect(embedder.embed({ text: 'x'.repeat(40_000) })).rejects.toThrow(/maxChunkChars/);
    await expect(embedder.embed({ text: 'x'.repeat(40_000) })).rejects.toThrow(
      /onTruncation: 'allow'/,
    );
  });

  it("`onTruncation: 'allow'` returns the vector unchanged", async () => {
    const fake = fakeEmbed(clipped);
    const embedder = geminiEmbedder({
      apiKey: 'k',
      dimensions: 3,
      onTruncation: 'allow',
      _client: fake.client,
    });
    await expect(embedder.embed({ text: 'x'.repeat(40_000) })).resolves.toEqual([1, 2, 3]);
  });

  it('says nothing when the service reported no statistics — it cannot tell, and does not pretend', async () => {
    const fake = fakeEmbed(() => ({ embeddings: [{ values: [1, 2, 3] }] }));
    const embedder = geminiEmbedder({ apiKey: 'k', dimensions: 3, _client: fake.client });
    await expect(embedder.embed({ text: 'x'.repeat(40_000) })).resolves.toEqual([1, 2, 3]);
  });

  it('names the offending text’s size, so the caller can pick a chunk size', async () => {
    const fake = fakeEmbed(clipped);
    const embedder = geminiEmbedder({ apiKey: 'k', dimensions: 3, _client: fake.client });
    await expect(embedder.embed({ text: 'y'.repeat(12_345) })).rejects.toThrow(/12,345-character/);
  });
});

// ── Functional — the read-side refusals ──────────────────────────────

describe('geminiEmbedder — refuses an answer it cannot trust', () => {
  it('a count that does not match the texts sent', async () => {
    const fake = fakeEmbed(() => ({ embeddings: [] }));
    await expect(
      geminiEmbedder({ apiKey: 'k', _client: fake.client }).embed({ text: 'a' }),
    ).rejects.toThrow(/paired with texts by POSITION/);
  });

  it('a row with no readable values', async () => {
    const fake = fakeEmbed(() => ({ embeddings: [{ values: undefined }] }));
    await expect(
      geminiEmbedder({ apiKey: 'k', _client: fake.client }).embed({ text: 'a' }),
    ).rejects.toThrow(/no `embeddings\[0\]\.values` array/);
  });

  it('a length that disagrees with the .dimensions this embedder reports', async () => {
    const fake = fakeEmbed(vectors(1536));
    await expect(
      geminiEmbedder({ apiKey: 'k', dimensions: 768, _client: fake.client }).embed({ text: 'a' }),
    ).rejects.toThrow(/1536-number vector while this embedder reports .dimensions 768/);
  });
});

// ── Refusals — configuration ─────────────────────────────────────────

describe('geminiEmbedder — the same two doors as gemini()', () => {
  it('refuses when neither a project nor a key is resolvable', () => {
    vi.stubEnv('GOOGLE_CLOUD_PROJECT', '');
    vi.stubEnv('GEMINI_API_KEY', '');
    vi.stubEnv('GOOGLE_API_KEY', '');
    try {
      // The connection is resolved LAZILY, on first embed — so a factory call
      // that only reads model facts stays cheap, and the refusal still arrives
      // before any network could.
      const embedder = geminiEmbedder();
      expect(embedder.dimensions).toBe(3072);
      return expect(embedder.embed({ text: 'a' })).rejects.toThrow(
        /no Google project and no API key/,
      );
    } finally {
      vi.unstubAllEnvs();
    }
  });

  it('names the install when @google/genai cannot be resolved', async () => {
    vi.resetModules();
    vi.doMock('../../src/lib/lazyRequire.js', () => ({
      lazyRequire: (specifier: string): unknown => {
        throw new Error(`Cannot find module '${specifier}'`);
      },
    }));
    try {
      const { geminiEmbedder: isolated } = await import('../../src/embedders/index.js');
      await expect(isolated({ apiKey: 'k' }).embed({ text: 'a' })).rejects.toThrow(
        /geminiEmbedder requires the `@google\/genai` package/,
      );
    } finally {
      vi.doUnmock('../../src/lib/lazyRequire.js');
      vi.resetModules();
    }
  });
});
