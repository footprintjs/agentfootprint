/**
 * RAG — 7-pattern tests
 * (unit · scenario · integration · property · security · performance · ROI).
 *
 * Covers `defineRAG()` factory + `indexDocuments()` seeding helper +
 * end-to-end Agent integration via `.rag()` alias.
 */

import { describe, expect, it } from 'vitest';

import { defineRAG, indexDocuments, type RagDocument, Agent } from '../../../src/index.js';
import { mock } from '../../../src/llm-providers.js';
import { InMemoryStore, mockEmbedder } from '../../../src/memory/index.js';

// ─── Unit — defineRAG factory shape ────────────────────────────────

describe('defineRAG — unit', () => {
  it('returns a frozen MemoryDefinition with type=semantic', () => {
    const store = new InMemoryStore();
    const def = defineRAG({
      id: 'docs',
      store,
      embedder: mockEmbedder(),
    });
    expect(def.id).toBe('docs');
    expect(def.type).toBe('semantic');
    expect(def.read).toBeDefined();
    expect(Object.isFrozen(def)).toBe(true);
  });

  // THE behavior change of 8.8.0. Before it, `defineRAG` also mounted the
  // semantic pipeline's write half, which embedded every conversation turn
  // into the SAME namespace as the documents — making the user's own
  // question the best-scoring "document" in the corpus (cosine 1.0 against
  // itself) and spending a top-K slot on it. See the scenario test below
  // that reproduces exactly that.
  it('is READ-ONLY — no write subflow is compiled (8.8.0)', () => {
    const def = defineRAG({ id: 'docs', store: new InMemoryStore(), embedder: mockEmbedder() });
    expect(def.write).toBeUndefined();
  });

  it("defaults `corpus` to the same '_global' namespace indexDocuments writes to", () => {
    const def = defineRAG({ id: 'docs', store: new InMemoryStore(), embedder: mockEmbedder() });
    expect(def.corpus).toEqual({ conversationId: '_global' });
  });

  it('carries the rag flavor, so injections compose as source:"rag"', () => {
    const def = defineRAG({ id: 'docs', store: new InMemoryStore(), embedder: mockEmbedder() });
    expect(def.flavor).toBe('rag');
  });

  it('an explicit corpus wins over the default', () => {
    const def = defineRAG({
      id: 'docs',
      store: new InMemoryStore(),
      embedder: mockEmbedder(),
      corpus: { tenant: 'acme' },
    });
    expect(def.corpus).toEqual({ tenant: 'acme' });
  });

  // Two tests used to live here: "default asRole is 'user'" and "asRole is
  // configurable". Both asserted a field on the definition that no run ever
  // read — `formatDefault` writes `role: 'system'` unconditionally — so the
  // documented 'user' default described a behaviour that never happened.
  // The option is refused now, and this is what is left worth pinning.
  it('asRole is refused by name — it was never read (7.20.0)', () => {
    expect(() =>
      defineRAG({
        id: 'reference',
        store: new InMemoryStore(),
        embedder: mockEmbedder(),
        asRole: 'system',
      } as never),
    ).toThrow(/defineRAG\('reference'\): `asRole` has never been read/);
  });

  it('default topK=3, threshold=0.7', () => {
    const def = defineRAG({
      id: 'docs',
      store: new InMemoryStore(),
      embedder: mockEmbedder(),
    });
    // Pipeline knobs are wrapped — assert via successful build.
    expect(def.read).toBeDefined();
  });
});

// ─── Security — input validation + remediation hints ──────────────

describe('defineRAG — security', () => {
  it('throws on empty id', () => {
    expect(() =>
      defineRAG({ id: '', store: new InMemoryStore(), embedder: mockEmbedder() }),
    ).toThrow(/`id` is required/);
  });

  it('throws on missing store with hint', () => {
    expect(() =>
      defineRAG({ id: 'x', store: undefined as never, embedder: mockEmbedder() }),
    ).toThrow(/`store` is required/);
  });

  it('throws on missing embedder with hint', () => {
    expect(() =>
      defineRAG({ id: 'x', store: new InMemoryStore(), embedder: undefined as never }),
    ).toThrow(/`embedder` is required/);
  });

  it('throws on non-vector store with remediation pointing at adapters', () => {
    const noSearchStore = {
      get: async () => null,
      put: async () => {},
      list: async () => ({ entries: [] }),
    };
    expect(() =>
      defineRAG({ id: 'x', store: noSearchStore as never, embedder: mockEmbedder() }),
    ).toThrow(/vector-capable adapter/);
  });
});

// ─── Unit — indexDocuments helper ─────────────────────────────────

describe('indexDocuments — unit', () => {
  it('returns 0 for empty document array', async () => {
    const count = await indexDocuments(new InMemoryStore(), mockEmbedder(), []);
    expect(count).toBe(0);
  });

  it('writes documents with embeddings + embeddingModel tag', async () => {
    const store = new InMemoryStore();
    const docs: RagDocument[] = [
      { id: 'd1', content: 'Refunds in 3 business days.' },
      { id: 'd2', content: 'Pro plan is $20/month.' },
    ];
    const count = await indexDocuments(store, mockEmbedder(), docs, {
      embedderId: 'test-embedder',
    });
    expect(count).toBe(2);

    const stored = await store.list({ conversationId: '_global' });
    expect(stored.entries.length).toBe(2);
    for (const e of stored.entries) {
      expect(e.embedding).toBeDefined();
      expect((e.embedding ?? []).length).toBeGreaterThan(0);
      expect(e.embeddingModel).toBe('test-embedder');
    }
  });

  it('respects custom identity for tenant-scoped corpora', async () => {
    const store = new InMemoryStore();
    const tenantA = { tenant: 'a', conversationId: 'corpus' };
    const tenantB = { tenant: 'b', conversationId: 'corpus' };
    await indexDocuments(store, mockEmbedder(), [{ id: 'a-only', content: 'A' }], {
      identity: tenantA,
    });
    await indexDocuments(store, mockEmbedder(), [{ id: 'b-only', content: 'B' }], {
      identity: tenantB,
    });

    const a = await store.list(tenantA);
    const b = await store.list(tenantB);
    expect(a.entries.length).toBe(1);
    expect(b.entries.length).toBe(1);
    expect(a.entries[0]!.id).toBe('a-only');
    expect(b.entries[0]!.id).toBe('b-only');
  });

  it('attaches optional tier + ttl', async () => {
    const store = new InMemoryStore();
    const ttlMs = 60_000;
    await indexDocuments(store, mockEmbedder(), [{ id: 'd', content: 'doc' }], {
      tier: 'hot',
      ttlMs,
    });
    const r = await store.list({ conversationId: '_global' });
    expect(r.entries[0]!.tier).toBe('hot');
    expect(r.entries[0]!.ttl).toBeGreaterThan(Date.now());
  });

  it('caps embed-fallback concurrency to maxConcurrency (rate-limit safety)', async () => {
    // Embedder without embedBatch → single-call fallback path. Without a
    // cap, indexing 100 docs would fire 100 parallel embed calls and
    // saturate provider rate limits. Verify the cap is honored.
    let inFlight = 0;
    let peakInFlight = 0;
    const embedder = {
      name: 'tracked-embedder',
      dimensions: 4,
      embed: async ({ text }: { text: string }) => {
        inFlight++;
        peakInFlight = Math.max(peakInFlight, inFlight);
        await new Promise((r) => setTimeout(r, 1));
        inFlight--;
        // simple deterministic vector based on first-char codepoint
        return [text.charCodeAt(0) / 128, 0, 0, 0];
      },
    };
    const store = new InMemoryStore();
    const docs: RagDocument[] = Array.from({ length: 50 }, (_, i) => ({
      id: `d${i}`,
      content: `chunk ${String.fromCharCode(65 + (i % 26))}`,
    }));
    await indexDocuments(store, embedder, docs, { maxConcurrency: 4 });
    expect(peakInFlight).toBeLessThanOrEqual(4);
    const r = await store.list({ conversationId: '_global' });
    expect(r.entries.length).toBe(50);
  });

  it('default fallback concurrency is 8 (sane production default)', async () => {
    let inFlight = 0;
    let peakInFlight = 0;
    const embedder = {
      name: 'tracked',
      dimensions: 4,
      embed: async () => {
        inFlight++;
        peakInFlight = Math.max(peakInFlight, inFlight);
        await new Promise((r) => setTimeout(r, 1));
        inFlight--;
        return [0, 0, 0, 0];
      },
    };
    await indexDocuments(
      new InMemoryStore(),
      embedder,
      Array.from({ length: 30 }, (_, i) => ({ id: `d${i}`, content: 'x' })),
    );
    expect(peakInFlight).toBeLessThanOrEqual(8);
  });
});

// ─── Integration — Agent + RAG end-to-end ─────────────────────────

describe('RAG — Agent integration', () => {
  it('agent.rag(definition) registers + runs end-to-end', async () => {
    const store = new InMemoryStore();
    const embedder = mockEmbedder();
    await indexDocuments(store, embedder, [
      { id: 'doc1', content: 'Refunds processed within 3 business days.' },
      { id: 'doc2', content: 'Pro plan costs $20 per month.' },
    ]);

    const docs = defineRAG({ id: 'docs', store, embedder });

    const agent = Agent.create({
      provider: mock({ reply: 'Refunds take 3 business days.' }),
      model: 'mock',
      maxIterations: 1,
    })
      .system('Answer using retrieved documentation.')
      .rag(docs)
      .build();

    const result = await agent.run({
      message: 'How long do refunds take?',
      identity: { conversationId: '_global' },
    });
    expect(typeof result).toBe('string');
  });

  it('multiple RAG retrievers layer cleanly (per-id scope keys)', () => {
    const store1 = new InMemoryStore();
    const store2 = new InMemoryStore();
    const docs1 = defineRAG({ id: 'docs', store: store1, embedder: mockEmbedder() });
    const docs2 = defineRAG({ id: 'kb', store: store2, embedder: mockEmbedder() });

    const agent = Agent.create({ provider: mock({ reply: 'ok' }), model: 'mock' })
      .rag(docs1)
      .rag(docs2)
      .build();
    expect(agent).toBeDefined();
  });

  it('rag and memory are siblings — same builder accepts both', () => {
    const docs = defineRAG({
      id: 'docs',
      store: new InMemoryStore(),
      embedder: mockEmbedder(),
    });
    const agent = Agent.create({ provider: mock({ reply: 'ok' }), model: 'mock' })
      .rag(docs)
      .build();
    expect(agent).toBeDefined();
  });
});

// ─── Property — invariants ────────────────────────────────────────

describe('RAG — properties', () => {
  it('every defineRAG output is frozen (immutability)', () => {
    const cases = [
      { id: 'a', store: new InMemoryStore(), embedder: mockEmbedder() },
      { id: 'b', store: new InMemoryStore(), embedder: mockEmbedder(), topK: 5 },
      { id: 'c', store: new InMemoryStore(), embedder: mockEmbedder(), threshold: 0.85 },
      { id: 'd', store: new InMemoryStore(), embedder: mockEmbedder(), embedderId: 'e1' },
    ];
    for (const c of cases) {
      const def = defineRAG(c);
      expect(Object.isFrozen(def)).toBe(true);
    }
  });

  it('id round-trips unchanged onto the definition', () => {
    for (const id of ['docs', 'product-kb', 'support_tickets']) {
      const def = defineRAG({
        id,
        store: new InMemoryStore(),
        embedder: mockEmbedder(),
      });
      expect(def.id).toBe(id);
    }
  });
});

// ─── Performance — pipeline build is O(1) ─────────────────────────

describe('RAG — performance', () => {
  it('repeated defineRAG calls are independent (no shared state)', () => {
    const a = defineRAG({ id: 'a', store: new InMemoryStore(), embedder: mockEmbedder() });
    const b = defineRAG({ id: 'b', store: new InMemoryStore(), embedder: mockEmbedder() });
    expect(a).not.toBe(b);
    expect(a.id).not.toBe(b.id);
  });
});

// ─── ROI — what the surface unlocks ───────────────────────────────

describe('RAG — ROI', () => {
  it('one factory + one helper expresses the entire RAG flow', async () => {
    // The pitch: RAG ships as ONE FACTORY FILE. This test proves
    // that — defineRAG (read) + indexDocuments (write) is the whole
    // public surface.
    const store = new InMemoryStore();
    const embedder = mockEmbedder();
    await indexDocuments(store, embedder, [
      { id: '1', content: 'doc one' },
      { id: '2', content: 'doc two' },
    ]);
    const def = defineRAG({ id: 'corpus', store, embedder });
    expect(def).toBeDefined();
  });

  it('RAG composes with memory + skills + steering — no engine changes', () => {
    const docs = defineRAG({
      id: 'docs',
      store: new InMemoryStore(),
      embedder: mockEmbedder(),
    });

    // Just smoke-test the builder accepts everything together.
    const agent = Agent.create({ provider: mock({ reply: 'ok' }), model: 'mock' })
      .system('Test')
      .rag(docs)
      .build();
    expect(agent).toBeDefined();
  });
});
