import { describe, it, expect, vi, afterEach } from 'vitest';
import {
  openaiEmbedder,
  localEmbedder,
  staticEmbedder,
  bedrockEmbedder,
  type Model2VecBackend,
  type TransformersBackend,
} from '../../src/embedders/index.js';
import { mockEmbedder } from '../../src/memory/index.js';

afterEach(() => vi.unstubAllGlobals());

/** Capture the request body openaiEmbedder actually puts on the wire. */
function stubFetch(embedding: number[] = [0.1, 0.2, 0.3]) {
  const fetchMock = vi.fn().mockResolvedValue({
    ok: true,
    json: async () => ({ data: [{ embedding }] }),
  });
  vi.stubGlobal('fetch', fetchMock);
  return () => {
    const [, init] = fetchMock.mock.calls[0] as [string, { body: string }];
    return JSON.parse(init.body) as Record<string, unknown>;
  };
}

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

// ─────────────────────────────────────────────────────────────────────────
// 7.9 — `.dimensions` used to be a claim the request never backed up: the
// option was read, reported, and then dropped on the floor (the body was
// `{ model, input }`). Ask for 256 → get 1536 from an embedder claiming 256,
// and any store trusting `.dimensions` corrupts silently.
//
// `dimensions` is "Only supported in `text-embedding-3` and later models"
// (https://developers.openai.com/api/docs/api-reference/embeddings/create),
// so it is sent ONLY when explicitly asked for — never as a side effect of a
// default, which would break ada-002 for callers who asked for nothing.
// ─────────────────────────────────────────────────────────────────────────
describe('openaiEmbedder — dimensions is honoured, not just reported', () => {
  it('sends an explicit dimensions AND reports the same number', async () => {
    const body = stubFetch(new Array(256).fill(0.01));
    const e = openaiEmbedder({ apiKey: 'sk-test', dimensions: 256 });
    const v = await e.embed({ text: 'hello' });
    expect(body()['dimensions']).toBe(256); // ← was absent from the body
    expect(e.dimensions).toBe(256);
    expect(v).toHaveLength(e.dimensions); // ← the claim the old code broke
  });

  it('sends dimensions on the batch path too', async () => {
    const body = stubFetch();
    await openaiEmbedder({ apiKey: 'sk-test', dimensions: 3 }).embedBatch!({ texts: ['a'] });
    expect(body()['dimensions']).toBe(3);
  });

  it('omits dimensions entirely when the caller did not ask (ada-002 rejects it)', async () => {
    const body = stubFetch();
    await openaiEmbedder({ apiKey: 'sk-test', model: 'text-embedding-ada-002' }).embed({
      text: 'hello',
    });
    const sent = body();
    expect(Object.keys(sent).sort()).toEqual(['input', 'model']); // byte-identical to 7.8
    expect('dimensions' in sent).toBe(false);
  });

  it('reports each known model’s documented native size, not one hard-coded guess', () => {
    const dims = (model: string) => openaiEmbedder({ apiKey: 'sk-test', model }).dimensions;
    expect(dims('text-embedding-3-small')).toBe(1536);
    expect(dims('text-embedding-3-large')).toBe(3072); // ← used to say 1536
    expect(dims('text-embedding-ada-002')).toBe(1536);
    expect(openaiEmbedder({ apiKey: 'sk-test' }).dimensions).toBe(1536); // default model
  });

  it('refuses to guess for an unknown model rather than report a number that may lie', () => {
    expect(() => openaiEmbedder({ apiKey: 'sk-test', model: 'nomic-embed-text' })).toThrow(
      /unknown model 'nomic-embed-text'/,
    );
  });

  it('an unknown model is usable the moment its length is stated', async () => {
    const body = stubFetch(new Array(768).fill(0.5));
    const e = openaiEmbedder({
      apiKey: 'sk-test',
      baseURL: 'http://localhost:11434/v1',
      model: 'nomic-embed-text',
      dimensions: 768,
    });
    expect(e.dimensions).toBe(768);
    expect(await e.embed({ text: 'x' })).toHaveLength(768);
    expect(body()['dimensions']).toBe(768);
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

// ─────────────────────────────────────────────────────────────────────────
// 7.9 — `{ backend }`: the lazy `import(spec)` keeps the peer deps optional
// but is invisible to every bundler, so the bare specifier reached the browser
// unresolved ("Failed to resolve module specifier '@huggingface/transformers'").
// Passing an already-imported module lets the CONSUMER's bundler resolve it
// statically. Same shape as the `client` option on the store adapters.
// ─────────────────────────────────────────────────────────────────────────
describe('localEmbedder({ backend }) — an already-imported transformers module', () => {
  function fakeTransformers() {
    const calls: unknown[][] = [];
    const backend: TransformersBackend = {
      env: {},
      async pipeline(task, model, opts) {
        calls.push([task, model, opts]);
        return async (input: unknown) =>
          Array.isArray(input)
            ? { data: [], tolist: () => (input as string[]).map((_, i) => [i, i + 1]) }
            : { data: [0.5, 0.25], tolist: () => [] };
      },
    };
    return { backend, calls };
  }

  it('embeds through the injected module — no dynamic import at all', async () => {
    // Without the fix this rejects: the option is ignored and the bare
    // specifier is looked up (and @huggingface/transformers is not installed).
    const { backend, calls } = fakeTransformers();
    const e = localEmbedder({ backend });
    expect(await e.embed({ text: 'hello' })).toEqual([0.5, 0.25]);
    expect(calls).toEqual([['feature-extraction', 'Xenova/all-MiniLM-L6-v2', { dtype: 'q8' }]]);
  });

  it('batches through the injected module and builds the pipeline only once', async () => {
    const { backend, calls } = fakeTransformers();
    const e = localEmbedder({ backend, model: 'Xenova/bge-small-en-v1.5', dtype: 'fp32' });
    expect(await e.embedBatch!({ texts: ['a', 'b'] })).toEqual([
      [0, 1],
      [1, 2],
    ]);
    await e.embed({ text: 'again' });
    expect(calls).toEqual([['feature-extraction', 'Xenova/bge-small-en-v1.5', { dtype: 'fp32' }]]);
  });

  it('still applies cacheDir to the injected module’s env', async () => {
    const { backend } = fakeTransformers();
    await localEmbedder({ backend, cacheDir: '/tmp/models' }).embed({ text: 'x' });
    expect(backend.env).toEqual({ cacheDir: '/tmp/models' });
  });
});

describe('staticEmbedder({ backend }) — an already-imported Model2Vec module', () => {
  it('embeds through the injected module — no dynamic import at all', async () => {
    // Without the fix this ignores `backend` and imports '@yarflam/potion-base-8m'.
    const backend: Model2VecBackend = {
      embed: (texts) => texts.map((t) => [t.length, 1, 2]),
    };
    const e = staticEmbedder({ backend, dimensions: 3 });
    expect(await e.embed({ text: 'abcd' })).toEqual([4, 1, 2]);
    expect(await e.embedBatch!({ texts: ['a', 'bc'] })).toEqual([
      [1, 1, 2],
      [2, 1, 2],
    ]);
  });

  it('accepts encode() and a default export, and never touches { module }', async () => {
    const viaEncode = staticEmbedder({
      module: 'this-package-does-not-exist',
      backend: { encode: (texts) => texts.map(() => [9]) },
      dimensions: 1,
    });
    expect(await viaEncode.embed({ text: 'x' })).toEqual([9]);

    const viaDefault = staticEmbedder({
      backend: { default: { embed: (texts: readonly string[]) => texts.map(() => [7]) } },
      dimensions: 1,
    });
    expect(await viaDefault.embed({ text: 'x' })).toEqual([7]);
  });

  it('names the injected module in the error when it has no embed()/encode()', async () => {
    const e = staticEmbedder({ backend: { default: 42 } as Model2VecBackend });
    await expect(e.embed({ text: 'x' })).rejects.toThrow(/module passed as \{ backend \}/);
  });

  it('injected potion === lazily-imported potion (real weights, both paths agree)', async () => {
    const potion = (await import('@yarflam/potion-base-8m')) as unknown as Model2VecBackend;
    const injected = await staticEmbedder({ backend: potion }).embed({ text: 'a red dress' });
    const lazy = await staticEmbedder().embed({ text: 'a red dress' });
    expect(injected).toHaveLength(256);
    expect(injected).toEqual(lazy);
  }, 30_000);
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

// ─────────────────────────────────────────────────────────────────────────
// The declared input ceiling (9.1.0). PINNED, because these numbers are what
// an indexer now trusts INSTEAD of its own conservative default: a ceiling
// that drifts upward starts clipping chunks in silence, which is the bug the
// field reported. Vendor-free — every factory below constructs without a key,
// an SDK, a download or a network call.
// ─────────────────────────────────────────────────────────────────────────
describe('maxInputChars — every shipped embedder declares its own ceiling', () => {
  it('states the number where the knowledge is', () => {
    // The measured cliff: 512 wordpiece tokens ≈ 1,800-2,000 characters.
    expect(localEmbedder().maxInputChars).toBe(2000);
    // Documented 8,191-token window at 4 chars/token, floored.
    expect(openaiEmbedder({ apiKey: 'k' }).maxInputChars).toBe(32000);
    // Titan's documented 8,192-token window, same conversion.
    expect(bedrockEmbedder().maxInputChars).toBe(32000);
    // No transformer, no context window — nothing is ever clipped.
    expect(staticEmbedder().maxInputChars).toBe(1_000_000);
    // Reads every character in a loop; declared so a mock-first run does not
    // report clipping that only the default ceiling believes in.
    expect(mockEmbedder().maxInputChars).toBe(1_000_000);
  });

  it('a model this library does not know declares NOTHING rather than a guess', () => {
    // A wrong ceiling clips in silence; an absent one leaves the indexer's
    // conservative default in place. The same rule `.dimensions` applies.
    expect(
      openaiEmbedder({ apiKey: 'k', model: 'my-gateway-model', dimensions: 768 }).maxInputChars,
    ).toBeUndefined();
    expect(
      bedrockEmbedder({ model: 'cohere.embed-english-v3', dimensions: 1024 }).maxInputChars,
    ).toBeUndefined();
  });

  it('localEmbedder takes the number from the caller — the cliff belongs to the MODEL', () => {
    // `model` is swappable and a long-context build reads far more than the
    // default says; without this the indexer would keep cutting a corpus into
    // pieces a quarter of what the model can take.
    expect(localEmbedder({ model: 'Xenova/long-ctx', maxInputChars: 30000 }).maxInputChars).toBe(
      30000,
    );
  });
});
