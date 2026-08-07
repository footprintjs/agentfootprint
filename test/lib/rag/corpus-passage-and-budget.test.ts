/**
 * The corpus says what it retrieved (8.19.0) — the field-report slice.
 *
 * Seven patterns, in the house order:
 *   unit · boundary · scenario · property · security · refusal · integration
 *
 * Three findings from a production RAG deployment, and what this file pins:
 *
 *   1. THE EMPTY BODY. `chunkText` read `value.content` only, so a `Chunk`
 *      from this library's own `rag` door — which keeps its passage on
 *      `text` — rendered a perfect citation around NOTHING. Right document,
 *      right heading, right score, no passage, no error anywhere. Every
 *      corpus built with `indexCorpus` / `indexFolder` was in this state.
 *   2. A COUNT BOUND IS NOT A SIZE BOUND. `topK` says how many passages;
 *      nothing said how much text. `maxChars` is the size bound, and the
 *      passages it drops are RECORDED, never silent.
 *   3. A STORE THAT CANNOT SERVE VECTORS BACK. `indexCorpus` accepted one,
 *      embedded the corpus, and reported success over an index nothing
 *      could ever read.
 */

import { describe, expect, it, vi } from 'vitest';

import { Agent, defineRAG, indexDocuments } from '../../../src/index.js';
import { indexCorpus, indexFolder } from '../../../src/doors/rag.js';
import { mock } from '../../../src/llm-providers.js';
import { InMemoryStore, mockEmbedder } from '../../../src/memory/index.js';
import { chunkText } from '../../../src/memory/retrieval/index.js';
import { AgentCoreStore, RedisStore } from '../../../src/memory-providers.js';
import { recordRun } from '../../../src/observe.js';
import type { MemoryStore } from '../../../src/memory/store/index.js';
import type { RetrievalEvidence } from '../../../src/memory/retrieval/index.js';

const REFUNDS = `# Refund policy

## Refund timing

Refunds are processed within 3 business days of approval. The money returns
to the original payment method, and a bank may take a further 2-5 days.

## Eligibility

Purchases are refundable within 30 days of the original purchase date here.`;

interface TurnResult {
  readonly systemPrompt: string;
  readonly evidence: RetrievalEvidence | undefined;
  readonly events: readonly { type: string; payload: Record<string, unknown> }[];
}

/** One turn against a corpus, with everything the trace kept. */
async function askAgainst(
  store: MemoryStore,
  ragOptions: Record<string, unknown> = {},
): Promise<TurnResult> {
  const embedder = mockEmbedder();
  const agent = Agent.create({ provider: mock({ reply: 'ok' }), model: 'mock' })
    .rag(
      defineRAG({
        id: 'docs',
        store,
        embedder,
        embedderId: embedder.id,
        threshold: -1,
        topK: 5,
        ...ragOptions,
      } as never),
    )
    .build();
  const events: { type: string; payload: Record<string, unknown> }[] = [];
  agent.on('*', (e) => events.push(e as never));
  const rec = recordRun(agent);
  await agent.run({ message: 'How long do refunds take?' });
  const state = rec.toRecording().snapshot.sharedState as Record<string, unknown>;
  const injections = (state['systemPromptInjections'] ?? []) as { rawContent?: string }[];
  return {
    systemPrompt: injections
      .map((r) => r.rawContent ?? '')
      .filter((s) => s.length > 0)
      .join('\n\n'),
    evidence: state['retrievalEvidence_docs'] as RetrievalEvidence | undefined,
    events,
  };
}

/** A corpus of N passages of a known length, so a character budget is arithmetic. */
async function corpusOf(count: number, chars: number): Promise<InMemoryStore> {
  const store = new InMemoryStore();
  const embedder = mockEmbedder();
  await indexDocuments(
    store,
    embedder,
    Array.from({ length: count }, (_, i) => ({
      id: `doc.md#${i}`,
      content: `refunds ${'x'.repeat(chars)}`.slice(0, chars),
      metadata: { source: 'doc.md' },
    })),
    { embedderId: embedder.id },
  );
  return store;
}

// ─── Unit — the passage accessor, in isolation ─────────────────────

describe('chunkText — unit', () => {
  it('reads a chat message and an indexed document off `content`', () => {
    expect(chunkText({ role: 'user', content: 'hello' })).toBe('hello');
    expect(chunkText({ id: 'a#0', content: 'a passage' })).toBe('a passage');
  });

  it('reads a rag-door Chunk off `text` — the empty-body bug', () => {
    expect(chunkText({ id: 'a.md#0', docUri: 'a.md', text: 'a passage' })).toBe('a passage');
  });

  it('`content` wins when a value carries both', () => {
    expect(chunkText({ content: 'first', text: 'second' })).toBe('first');
  });

  it('a value with neither has no passage, and says so with an empty string', () => {
    expect(chunkText({ id: 'a#0' })).toBe('');
    expect(chunkText(null)).toBe('');
    expect(chunkText('a bare string')).toBe('');
    expect(chunkText({ content: 42 })).toBe('');
  });
});

// ─── Boundary — where the character budget lands exactly ───────────

describe('maxChars — boundary', () => {
  it('a budget that fits every passage drops nothing and records the spend', async () => {
    const store = await corpusOf(3, 100);
    const r = await askAgainst(store, { maxChars: 1000 });
    expect(r.evidence?.admittedCount).toBe(3);
    expect(r.evidence?.maxChars).toBe(1000);
    expect(r.evidence?.charsUsed).toBe(300);
    expect(r.evidence?.candidates?.some((c) => c.reason === 'over-char-budget')).toBe(false);
  });

  it('a budget exactly the size of the admitted set is not an over-run', async () => {
    const store = await corpusOf(3, 100);
    const r = await askAgainst(store, { maxChars: 300 });
    expect(r.evidence?.admittedCount).toBe(3);
    expect(r.evidence?.charsUsed).toBe(300);
  });

  it('one character short drops exactly the tail passage, and names why', async () => {
    const store = await corpusOf(3, 100);
    const r = await askAgainst(store, { maxChars: 299 });
    expect(r.evidence?.admittedCount).toBe(2);
    expect(r.evidence?.charsUsed).toBe(200);
    const dropped = r.evidence?.candidates?.filter((c) => c.reason === 'over-char-budget') ?? [];
    expect(dropped).toHaveLength(1);
    expect(dropped[0]?.admitted).toBe(false);
  });

  it('a budget smaller than the best passage admits nothing — and says so per candidate', async () => {
    const store = await corpusOf(3, 100);
    const r = await askAgainst(store, { maxChars: 10 });
    expect(r.evidence?.admittedCount).toBe(0);
    expect(r.evidence?.charsUsed).toBe(0);
    expect(r.evidence?.candidates?.every((c) => c.reason === 'over-char-budget')).toBe(true);
    // Nothing half-injected: an empty retrieval, readable in the record.
    expect(r.systemPrompt).toBe('');
  });

  it('no maxChars means no size bound at all — the default is unchanged', async () => {
    const store = await corpusOf(3, 100);
    const r = await askAgainst(store);
    expect(r.evidence?.admittedCount).toBe(3);
    expect(r.evidence?.maxChars).toBeUndefined();
    expect(r.evidence?.charsUsed).toBeUndefined();
  });

  it('charsUsed and admittedCount never disagree, even after the token picker drops one', async () => {
    // The record is written by the retriever and revised by the picker. If
    // the picker drops an entry for TOKENS, a charsUsed still counting that
    // entry's passage would be a record contradicting its own count.
    const store = await corpusOf(3, 100);
    const r = await askAgainst(store, { maxChars: 1000 });
    const admitted = r.evidence?.candidates?.filter((c) => c.admitted) ?? [];
    expect(r.evidence?.charsUsed).toBe(admitted.length * 100);
    expect(r.evidence?.admittedCount).toBe(admitted.length);
  });
});

// ─── Scenario — the field report, start to finish ──────────────────

describe('the corpus renders its passages — scenario', () => {
  it('THE FINDING: an indexCorpus chunk reaches the prompt WITH its text', async () => {
    const store = new InMemoryStore();
    const embedder = mockEmbedder();
    await indexCorpus({ source: { text: REFUNDS, uri: 'refunds.md' }, store, embedder });

    const r = await askAgainst(store, { embedderId: embedder.id });
    // The citation was always right. The passage is what was missing.
    expect(r.systemPrompt).toMatch(/<source id="refunds\.md#\d+"/);
    expect(r.systemPrompt).toContain('Refunds are processed within 3 business days');
    // No empty block anywhere: every <source> has a body.
    expect(r.systemPrompt).not.toMatch(/<source[^>]*>\n\n<\/source>/);
  });

  it('a hand-built entry spelling its passage `text` renders too', async () => {
    const store = new InMemoryStore();
    const embedder = mockEmbedder();
    await indexDocuments(
      store,
      embedder,
      [
        {
          id: 'notes.md#0',
          text: 'Refunds land in 3 business days.',
          metadata: { source: 'notes.md' },
        },
      ],
      { embedderId: embedder.id },
    );
    const r = await askAgainst(store, { embedderId: embedder.id });
    expect(r.systemPrompt).toContain('Refunds land in 3 business days.');
  });

  it('the attachment event summarises the passage instead of an empty string', async () => {
    const store = new InMemoryStore();
    const embedder = mockEmbedder();
    await indexCorpus({ source: { text: REFUNDS, uri: 'refunds.md' }, store, embedder });
    const r = await askAgainst(store, { embedderId: embedder.id });
    const attached = r.events.filter((e) => e.type === 'agentfootprint.memory.attached');
    expect(attached.length).toBeGreaterThan(0);
    expect(attached.every((e) => String(e.payload['contentSummary']).length > 0)).toBe(true);
  });
});

// ─── Property — the budget can never be exceeded ───────────────────

describe('maxChars — property', () => {
  it('across many budgets, the admitted passages never exceed the budget', async () => {
    const store = await corpusOf(5, 80);
    for (const budget of [1, 79, 80, 81, 159, 160, 240, 400, 401, 10_000]) {
      const r = await askAgainst(store, { maxChars: budget });
      const used = r.evidence?.charsUsed ?? 0;
      expect(used).toBeLessThanOrEqual(budget);
      // And the record adds up: admitted × passage size === charsUsed.
      expect(used).toBe((r.evidence?.admittedCount ?? 0) * 80);
    }
  });

  it('a bigger budget never admits FEWER passages — monotone in the budget', async () => {
    const store = await corpusOf(5, 80);
    let previous = -1;
    for (const budget of [40, 80, 160, 240, 320, 400, 480]) {
      const r = await askAgainst(store, { maxChars: budget });
      const admitted = r.evidence?.admittedCount ?? 0;
      expect(admitted).toBeGreaterThanOrEqual(previous);
      previous = admitted;
    }
  });
});

// ─── Security — a refusal never quotes the corpus ──────────────────

describe('refusals name the problem, never the content — security', () => {
  it('the no-passage refusal names ids and never the documents around it', async () => {
    const secret = 'PATIENT SSN 123-45-6789';
    const refused = indexDocuments(new InMemoryStore(), mockEmbedder(), [
      { id: 'ok#0', content: secret },
      { id: 'broken#0', content: '' },
    ]);
    await expect(refused).rejects.toThrow(/broken#0/);
    const message = await refused.then(
      () => '',
      (err: unknown) => String(err),
    );
    expect(message).not.toContain(secret);
  });
});

// ─── Refusal — the three things now refused ────────────────────────

describe('refusals', () => {
  it('a document with neither content nor text is refused BEFORE anything is embedded', async () => {
    const embedder = mockEmbedder();
    let calls = 0;
    const counting = {
      ...embedder,
      embed: async (input: { text: string }) => {
        calls += 1;
        return embedder.embed(input);
      },
      embedBatch: async (input: { texts: readonly string[] }) => {
        calls += 1;
        return embedder.embedBatch?.(input) ?? [];
      },
    };
    await expect(
      indexDocuments(
        new InMemoryStore(),
        counting as never,
        [
          { id: 'a#0', content: 'fine' },
          { id: 'b#0', metadata: { source: 'b.md' } },
        ] as never,
      ),
    ).rejects.toThrow(/carry no passage/);
    expect(calls).toBe(0);
  });

  it('the refusal teaches: it names the keys that ARE read', async () => {
    await expect(
      indexDocuments(new InMemoryStore(), mockEmbedder(), [{ id: 'b#0' }] as never),
    ).rejects.toThrow(/`content` nor `text`/);
  });

  it('a whitespace-only passage is an absent one', async () => {
    await expect(
      indexDocuments(new InMemoryStore(), mockEmbedder(), [{ id: 'b#0', content: '   \n ' }]),
    ).rejects.toThrow(/carry no passage/);
  });

  it('indexCorpus refuses a store that declares it cannot serve vectors back', async () => {
    const store = new AgentCoreStore({ memoryId: 'mem-1', _client: {} as never });
    const message = await indexCorpus({
      source: { text: REFUNDS, uri: 'a.md' },
      store,
      embedder: mockEmbedder(),
    }).then(
      () => '',
      (err: unknown) => String(err),
    );
    expect(message).toMatch(/AgentCoreStore/);
    // This store HAS a search(); the message says what it ranks instead.
    expect(message).toMatch(/ranks on the SERVER's side/);
  });

  it('RedisStore too — the refusal moves to the call that starts the spending', async () => {
    const store = new RedisStore({ _client: {} as never });
    const message = await indexCorpus({
      source: { text: REFUNDS, uri: 'a.md' },
      store,
      embedder: mockEmbedder(),
    }).then(
      () => '',
      (err: unknown) => String(err),
    );
    expect(message).toMatch(/RedisStore/);
    // ...and this one has NO search() at all, so the message must not claim
    // a server-side ranking it does not do. A refusal that describes the
    // wrong failure teaches the wrong fix.
    expect(message).toMatch(/no search\(\) at all/);
    expect(message).not.toMatch(/ranks on the SERVER's side/);
    // defineRAG always refused it — but only after the whole corpus had
    // been embedded and billed.
    expect(() => defineRAG({ id: 'd', store, embedder: mockEmbedder() })).toThrow(
      /must implement search/,
    );
  });

  it('...and says what to use instead, rather than only that it refused', async () => {
    const store = new AgentCoreStore({ memoryId: 'mem-1', _client: {} as never });
    const message = await indexCorpus({
      source: { text: REFUNDS, uri: 'a.md' },
      store,
      embedder: mockEmbedder(),
    }).then(
      () => '',
      (err: unknown) => String(err),
    );
    expect(message).toMatch(/sqliteVectorStore/);
    expect(message).toMatch(/report success and retrieve nothing/);
  });

  it('buildIndexChart refuses it too — no chart that is guaranteed to lie', async () => {
    const { buildIndexChart } = await import('../../../src/doors/rag.js');
    const store = new AgentCoreStore({ memoryId: 'mem-1', _client: {} as never });
    expect(() =>
      buildIndexChart({ source: { text: REFUNDS, uri: 'a.md' }, store, embedder: mockEmbedder() }),
    ).toThrow(/cannot serve vectors back/);
  });

  it('indexFolder refuses it too, naming the call the reader wrote', async () => {
    const store = new AgentCoreStore({ memoryId: 'mem-1', _client: {} as never });
    await expect(indexFolder('./docs', { to: store, embedder: mockEmbedder() })).rejects.toThrow(
      /indexFolder/,
    );
  });

  it('indexDocuments refuses it before embedding a single document', async () => {
    const store = new AgentCoreStore({ memoryId: 'mem-1', _client: {} as never });
    await expect(
      indexDocuments(store, mockEmbedder(), [{ id: 'a#0', content: 'text' }]),
    ).rejects.toThrow(/indexDocuments: `AgentCoreStore`/);
  });

  it('a store that declares NOTHING is unchanged — absence is not a false', async () => {
    // The compat clause: every third-party adapter written before 8.19.0.
    const undeclared = new InMemoryStore() as MemoryStore & { supportsVectorSearch?: boolean };
    delete (undeclared as { supportsVectorSearch?: boolean }).supportsVectorSearch;
    const plain = Object.create(
      Object.getPrototypeOf(undeclared) as object,
      Object.getOwnPropertyDescriptors(undeclared),
    ) as MemoryStore;
    Object.defineProperty(plain, 'supportsVectorSearch', { value: undefined });
    const report = await indexCorpus({
      source: { text: REFUNDS, uri: 'a.md' },
      store: plain,
      embedder: mockEmbedder(),
    });
    expect(report.embedded).toBeGreaterThan(0);
  });

  it('maxChars must be a real budget', () => {
    const store = new InMemoryStore();
    const embedder = mockEmbedder();
    expect(() => defineRAG({ id: 'd', store, embedder, maxChars: 0 })).toThrow(/positive number/);
    expect(() => defineRAG({ id: 'd', store, embedder, maxChars: -5 })).toThrow(/positive number/);
    expect(() => defineRAG({ id: 'd', store, embedder, maxChars: Number.NaN })).toThrow(
      /positive number/,
    );
  });
});

// ─── Integration — a folder, a budget, and one honest prompt ───────

describe('integration', () => {
  it('index a folder, bound the passages, and the record explains the prompt', async () => {
    const store = new InMemoryStore();
    const embedder = mockEmbedder();
    await indexCorpus({ source: { text: REFUNDS, uri: 'refunds.md' }, store, embedder });

    const generous = await askAgainst(store, { embedderId: embedder.id, maxChars: 10_000 });
    const tight = await askAgainst(store, { embedderId: embedder.id, maxChars: 120 });

    // The prompt really got shorter — this is the point of the budget.
    expect(tight.systemPrompt.length).toBeLessThan(generous.systemPrompt.length);
    // And the drop is on the record rather than only in the byte count.
    const retrieved = tight.events.find((e) => e.type === 'agentfootprint.memory.retrieved');
    expect(retrieved?.payload['maxChars']).toBe(120);
    expect(retrieved?.payload['charsUsed']).toBeLessThanOrEqual(120);
    const candidates = retrieved?.payload['candidates'] as { reason?: string }[];
    expect(candidates.some((c) => c.reason === 'over-char-budget')).toBe(true);
    // Whatever survived is a WHOLE passage — the budget drops, never truncates.
    for (const block of tight.systemPrompt.matchAll(/<source[^>]*>\n([\s\S]*?)\n<\/source>/g)) {
      expect(block[1]?.length).toBeGreaterThan(0);
      expect(REFUNDS).toContain(block[1] as string);
    }
  });

  it('the whole point, end to end: a folder of docs answers with a passage the model can quote', async () => {
    const store = new InMemoryStore();
    const embedder = mockEmbedder();
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    await indexCorpus({ source: { text: REFUNDS, uri: 'refunds.md' }, store, embedder });
    const r = await askAgainst(store, { embedderId: embedder.id, topK: 1, maxChars: 4000 });
    warn.mockRestore();
    const admitted = r.evidence?.candidates?.filter((c) => c.admitted) ?? [];
    expect(admitted).toHaveLength(1);
    // The citation and the passage agree: the id points at the document the
    // text really came from, and the text is really in it.
    const id = admitted[0]?.id ?? '';
    expect(id.startsWith('refunds.md#')).toBe(true);
    const body = /<source[^>]*>\n([\s\S]*?)\n<\/source>/.exec(r.systemPrompt)?.[1] ?? '';
    expect(body.length).toBeGreaterThan(0);
    expect(REFUNDS).toContain(body);
  });
});
