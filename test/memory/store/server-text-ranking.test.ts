/**
 * The store declares what its `search()` ranks (9.3.0) — the R3 test slice.
 *
 * Seven patterns, in the house order:
 *   unit · boundary · scenario · property · security · refusal · integration
 *
 * ── The failure this exists to end ──────────────────────────────────────
 * `defineRAG` has always required an `Embedder`, because somebody has to turn
 * the question into a vector. A managed knowledge-base service does not work
 * that way: it embeds and ranks on ITS side and its retrieval API takes TEXT.
 * Wired to one of those, the embedder was still constructed, still called once
 * per turn, still billed — and the vector it produced was discarded on arrival.
 * The wiring looked identical to a working one.
 *
 * So a store may now DECLARE `ranksBy: 'server-text'`, and the declaration is
 * load-bearing in both directions:
 *
 *   1. A retriever over such a store takes NO embedder, and passing one is
 *      REFUSED rather than ignored (an ignored embedder reads, from the
 *      wiring, exactly like a working one).
 *   2. Every other store keeps the refusals it already had — absence of a
 *      declaration can never mean either value, which is what keeps every
 *      adapter written before this release working unchanged.
 *
 * The mock store below is a whole managed backend in twenty lines: it answers
 * `search()` from the TEXT and would return nothing at all if this library
 * embedded the question and passed only a vector.
 */

import { describe, expect, it } from 'vitest';

import { Agent, defineRAG, indexDocuments } from '../../../src/index.js';
import { mock } from '../../../src/llm-providers.js';
import { InMemoryStore, mockEmbedder, defineMemory } from '../../../src/memory/index.js';
import { MEMORY_STRATEGIES, MEMORY_TYPES } from '../../../src/memory/define.types.js';
import { resolveRankingMode } from '../../../src/memory/store/index.js';
import type { MemoryStore, ScoredEntry, SearchOptions } from '../../../src/memory/store/index.js';
import type { MemoryEntry } from '../../../src/memory/entry/index.js';
import type { MemoryIdentity } from '../../../src/memory/identity/index.js';

/**
 * A managed knowledge base, in miniature.
 *
 * It ranks WORDS: `search()` reads {@link SearchOptions.text} and scores by
 * naive term overlap over a population IT holds. The `query` vector argument is
 * the one thing it cannot use — which is exactly why it declares
 * `ranksBy: 'server-text'`, and why an embedder on the read side would be spend
 * with no reader.
 */
class ServerTextStore implements MemoryStore {
  readonly supportsVectorSearch = false;
  readonly ranksBy = 'server-text' as const;

  /** Every search this store was asked to run, for the tests to inspect. */
  readonly searches: { query: readonly number[]; text: string | undefined }[] = [];

  constructor(private readonly documents: readonly { id: string; content: string }[]) {}

  async search<T = unknown>(
    _identity: MemoryIdentity,
    query: readonly number[],
    options?: SearchOptions,
  ): Promise<readonly ScoredEntry<T>[]> {
    this.searches.push({ query, text: options?.text });
    const words = (options?.text ?? '').toLowerCase().split(/\W+/).filter(Boolean);
    const now = Date.now();
    return this.documents
      .map((doc) => {
        const haystack = doc.content.toLowerCase();
        const hits = words.filter((w) => haystack.includes(w)).length;
        return {
          entry: {
            id: doc.id,
            value: { id: doc.id, content: doc.content },
            version: 1,
            createdAt: now,
            updatedAt: now,
            lastAccessedAt: now,
            accessCount: 0,
          } as unknown as MemoryEntry<T>,
          score: words.length === 0 ? 0 : hits / words.length,
        };
      })
      .filter((hit) => hit.score > 0)
      .sort((a, b) => b.score - a.score)
      .slice(0, options?.k ?? 10);
  }

  // The rest of the port: this backend owns its own ingestion, so the write
  // half is somebody else's console, not this object's problem.
  async get(): Promise<null> {
    return null;
  }
  async put(): Promise<void> {}
  async putMany(): Promise<void> {}
  async list(): Promise<{ entries: []; cursor?: string }> {
    return { entries: [] };
  }
  async delete(): Promise<void> {}
  async forget(): Promise<void> {}
}

const DOCS = [
  { id: 'refunds.md#0', content: 'Refunds are processed within 3 business days of approval.' },
  {
    id: 'pricing.md#0',
    content: 'The Pro plan costs $20 per month and includes priority support.',
  },
];

/**
 * A store that declares NOTHING — the state every adapter written before 9.3.0
 * is in. `InMemoryStore` cannot stand in for one: it declares
 * `supportsVectorSearch: true`, which is itself a declaration.
 */
function undeclaredStore(): MemoryStore {
  const inner = new InMemoryStore();
  return {
    get: inner.get.bind(inner),
    put: inner.put.bind(inner),
    putMany: inner.putMany.bind(inner),
    list: inner.list.bind(inner),
    delete: inner.delete.bind(inner),
    forget: inner.forget.bind(inner),
    search: inner.search.bind(inner),
  };
}

// ─── Unit — the resolver reads the two declarations ────────────────

describe('resolveRankingMode — unit', () => {
  it('reads a declared mode', () => {
    expect(resolveRankingMode(new ServerTextStore(DOCS), 'test')).toBe('server-text');
  });

  it('a bare `supportsVectorSearch: true` IS a vector declaration', () => {
    // A pre-9.3.0 adapter gets the new behaviour without a new line.
    const store = Object.assign(new InMemoryStore(), { supportsVectorSearch: true });
    expect(resolveRankingMode(store, 'test')).toBe('vector');
  });

  it('a store that declares NOTHING stays undeclared — absence is not a value', () => {
    expect(resolveRankingMode(undeclaredStore(), 'test')).toBeUndefined();
  });

  it('refuses two declarations that contradict each other, naming the store', () => {
    const store = Object.assign(new InMemoryStore(), {
      ranksBy: 'server-text' as const,
      supportsVectorSearch: true,
    });
    expect(() => resolveRankingMode(store, 'defineRAG[docs]')).toThrow(/cannot both be/);
    expect(() => resolveRankingMode(store, 'defineRAG[docs]')).toThrow(/defineRAG\[docs\]/);
  });
});

// ─── Boundary — the shape of the call that reaches the store ───────

describe('server-text retrieval — the call the store receives', () => {
  it('the QUESTION arrives as text, and no vector is ever produced', async () => {
    const store = new ServerTextStore(DOCS);
    const agent = Agent.create({ provider: mock({ reply: 'ok' }), model: 'mock' })
      .rag(defineRAG({ id: 'docs', store }))
      .build();

    const events: { type: string }[] = [];
    agent.on('*', (e) => events.push(e as never));
    await agent.run({ message: 'How long do refunds take?' });

    expect(store.searches).toHaveLength(1);
    expect(store.searches[0]?.text).toContain('refunds');
    // `[]` is what the port's `query` argument honestly is here.
    expect(store.searches[0]?.query).toEqual([]);
    // …and nothing was billed for a vector nobody wanted: the recording says
    // an embedding happened only when one did.
    expect(events.filter((e) => e.type === 'agentfootprint.embedding.generated')).toHaveLength(0);
  });

  it('a vector store is unchanged — the question is still embedded for it', async () => {
    const store = new InMemoryStore();
    const embedder = mockEmbedder();
    await indexDocuments(store, embedder, DOCS);
    const agent = Agent.create({ provider: mock({ reply: 'ok' }), model: 'mock' })
      .rag(defineRAG({ id: 'docs', store, embedder }))
      .build();

    const events: { type: string }[] = [];
    agent.on('*', (e) => events.push(e as never));
    await agent.run({ message: 'How long do refunds take?' });
    expect(events.filter((e) => e.type === 'agentfootprint.embedding.generated')).toHaveLength(1);
  });
});

// ─── Scenario / integration — the passage reaches the prompt ───────

describe('server-text retrieval — end to end', () => {
  it('a corpus this library never embedded still answers the turn', async () => {
    const store = new ServerTextStore(DOCS);
    const seen: string[] = [];
    const agent = Agent.create({
      provider: mock({
        respond: (req) => {
          // The corpus arrives in the SYSTEM prompt — that is where the
          // injection layer puts a retrieved passage.
          seen.push(String(req.systemPrompt ?? ''));
          return 'Three business days.';
        },
      }),
      model: 'mock',
    })
      .system('Answer using retrieved documentation.')
      // This backend scores by term overlap, so the floor is stated rather
      // than left at the cosine-calibrated 0.7 default — a server-side score
      // is the backend's unit, and this is the option that says so.
      .rag(defineRAG({ id: 'docs', store, threshold: 0.15 }))
      .build();

    const answer = await agent.run({ message: 'How long do refunds take?' });
    expect(answer).toBe('Three business days.');
    // The whole point: the backend's own passage, in the prompt, with no
    // embedder anywhere in the wiring.
    expect(seen.join('\n')).toContain('Refunds are processed within 3 business days');
  });

  it('the retriever is READ-ONLY by construction — there is no write half to disable', () => {
    const def = defineRAG({ id: 'docs', store: new ServerTextStore(DOCS) });
    expect(def.write).toBeUndefined();
    expect(def.read).toBeDefined();
  });
});

// ─── Property — what a declaration does and does not change ────────

describe('server-text declarations — property', () => {
  it('an undeclared store behaves exactly as it did before this existed', () => {
    // The compatibility guarantee, stated as a test: absence changes nothing.
    const def = defineRAG({
      id: 'docs',
      store: undeclaredStore(),
      embedder: mockEmbedder(),
    });
    expect(def.type).toBe('semantic');
  });

  it('defineMemory accepts a server-text store only as a READ-ONLY memory', () => {
    const store = new ServerTextStore(DOCS);
    const ok = defineMemory({
      id: 'kb',
      type: MEMORY_TYPES.SEMANTIC,
      store,
      readOnly: true,
      strategy: { kind: MEMORY_STRATEGIES.TOP_K, retrieval: { select: () => [], k: 3 } } as never,
    } as never);
    expect(ok.write).toBeUndefined();
  });
});

// ─── Security / refusal — the option that would be read by nothing ─

describe('server-text declarations — refusal', () => {
  it('refuses an embedder passed to a server-text store rather than ignoring it', () => {
    expect(() =>
      defineRAG({ id: 'docs', store: new ServerTextStore(DOCS), embedder: mockEmbedder() }),
    ).toThrow(/`embedder` cannot be used with a store that declares/);
  });

  it('refuses an embedderId too — it would name a filter that filtered nothing', () => {
    expect(() =>
      defineRAG({ id: 'docs', store: new ServerTextStore(DOCS), embedderId: 'mock' }),
    ).toThrow(/`embedderId` cannot be used/);
  });

  it('still refuses a MISSING embedder for every other store', () => {
    expect(() => defineRAG({ id: 'docs', store: undeclaredStore() })).toThrow(
      /`embedder` is required/,
    );
    expect(() => defineRAG({ id: 'docs', store: new InMemoryStore() })).toThrow(
      /somebody has to turn the question into a vector/,
    );
  });

  it('refuses to INDEX into a server-text store — the vectors would never be read', async () => {
    await expect(indexDocuments(new ServerTextStore(DOCS), mockEmbedder(), DOCS)).rejects.toThrow(
      /report success and retrieve nothing/,
    );
  });

  it('refuses a contradiction at the wiring layer, not at the first empty answer', () => {
    const store = Object.assign(new ServerTextStore(DOCS), { supportsVectorSearch: true });
    expect(() => defineRAG({ id: 'docs', store })).toThrow(/cannot both be/);
  });

  it('CAUSAL recall still requires an embedder — there is no text path into a snapshot pool', () => {
    expect(() =>
      defineMemory({
        id: 'past-runs',
        type: MEMORY_TYPES.CAUSAL,
        store: new ServerTextStore(DOCS),
        strategy: { kind: MEMORY_STRATEGIES.TOP_K, topK: 3 },
      } as never),
    ).toThrow(/CAUSAL type requires an `embedder`/);
  });
});
