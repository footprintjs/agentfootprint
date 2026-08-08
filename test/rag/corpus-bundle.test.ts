/**
 * Corpus as a build artifact (8.20.0) — R7 of the second production RAG
 * field report.
 *
 * Seven patterns, in the house order:
 *   unit · boundary · scenario · property · security · refusal · integration
 *
 * The deployment shape: an immutable/serverless runtime has no durable disk
 * and no embedding credentials; the build machine has both. So the corpus is
 * an artifact of the build — `exportCorpus(store)` → plain JSON →
 * `staticVectorStore(bundle)` at runtime, read-only, refusing the wrong
 * embedder AT LOAD instead of retrieving nothing at the first question.
 */

import { describe, expect, it } from 'vitest';

import {
  exportCorpus,
  importCorpus,
  staticVectorStore,
  indexCorpus,
  CORPUS_BUNDLE_FORMAT,
  type CorpusBundle,
} from '../../src/doors/rag.js';
import { InMemoryStore, mockEmbedder } from '../../src/doors/memory.js';
import { indexDocuments, defineRAG } from '../../src/index.js';
import { chunkProvenance, chunkText } from '../../src/memory/retrieval/provenance.js';

const GLOBAL = { conversationId: '_global' };

/** Build a small real corpus and export it. */
async function exportedBundle(): Promise<{
  bundle: CorpusBundle;
  embedder: ReturnType<typeof mockEmbedder>;
}> {
  const store = new InMemoryStore();
  const embedder = mockEmbedder();
  await indexDocuments(store, embedder, [
    {
      id: 'refunds.md#0',
      content: 'Refunds are processed within three business days of approval.',
      metadata: { source: 'refunds.md', heading: 'Refund timing' },
    },
    {
      id: 'pricing.md#0',
      content: 'The Pro plan costs twenty dollars per month including support.',
      metadata: { source: 'pricing.md' },
    },
  ]);
  return { bundle: await exportCorpus(store), embedder };
}

// ─── Unit ──────────────────────────────────────────────────────────

describe('exportCorpus — unit', () => {
  it('exports every entry with id, text, vector and flattened metadata', async () => {
    const { bundle, embedder } = await exportedBundle();
    expect(bundle.format).toBe(CORPUS_BUNDLE_FORMAT);
    expect(bundle.embedder.dimensions).toBe(embedder.dimensions);
    expect(bundle.embedder.id).toBe(embedder.id);
    expect(bundle.namespace).toContain('_global');
    expect(bundle.entries.length).toBe(2);
    const refunds = bundle.entries.find((e) => e.id === 'refunds.md#0');
    expect(refunds?.text).toContain('three business days');
    expect(refunds?.vector.length).toBe(embedder.dimensions);
    expect(refunds?.metadata?.source).toBe('refunds.md');
    expect(refunds?.metadata?.heading).toBe('Refund timing');
  });

  it('the bundle is plain JSON — a stringify/parse round-trip is lossless', async () => {
    const { bundle } = await exportedBundle();
    const revived = JSON.parse(JSON.stringify(bundle)) as CorpusBundle;
    expect(revived).toEqual(bundle);
    // And the revived copy is servable.
    expect(() => staticVectorStore(revived)).not.toThrow();
  });

  it('staticVectorStore serves get, list and search over the bundle', async () => {
    const { bundle, embedder } = await exportedBundle();
    const store = staticVectorStore(bundle, embedder);

    const entry = await store.get(GLOBAL, 'refunds.md#0');
    expect(entry?.embeddingModel).toBe(bundle.embedder.id);

    const listed = await store.list(GLOBAL);
    expect(listed.entries.length).toBe(2);

    const query = await embedder.embed({ text: 'refund timing' });
    const results = await store.search!(GLOBAL, query, { k: 2 });
    expect(results.length).toBe(2);
    expect(results[0]!.score).toBeGreaterThanOrEqual(results[1]!.score);
  });

  it('declares supportsVectorSearch: true — it ranks the vectors it carries', async () => {
    const { bundle } = await exportedBundle();
    expect(staticVectorStore(bundle).supportsVectorSearch).toBe(true);
  });
});

// ─── Boundary ──────────────────────────────────────────────────────

describe('corpus bundle — boundary', () => {
  it('list paginates with a cursor', async () => {
    const { bundle } = await exportedBundle();
    const store = staticVectorStore(bundle);
    const page1 = await store.list(GLOBAL, { limit: 1 });
    expect(page1.entries.length).toBe(1);
    expect(page1.cursor).toBeDefined();
    const page2 = await store.list(GLOBAL, { limit: 5, cursor: page1.cursor });
    expect(page2.entries.length).toBe(1);
    expect(page2.cursor).toBeUndefined();
  });

  it('a different namespace reads as empty — tenant isolation, loud upstream via corpusEmpty', async () => {
    const { bundle, embedder } = await exportedBundle();
    const store = staticVectorStore(bundle);
    const other = { conversationId: 'someone-else' };
    expect(await store.get(other, 'refunds.md#0')).toBeNull();
    expect((await store.list(other)).entries.length).toBe(0);
    const query = await embedder.embed({ text: 'refunds' });
    expect((await store.search!(other, query)).length).toBe(0);
  });

  it('seen() is false and getFeedback() is null — read-side calls never throw', async () => {
    const { bundle } = await exportedBundle();
    const store = staticVectorStore(bundle);
    expect(await store.seen(GLOBAL, 'sig')).toBe(false);
    expect(await store.getFeedback(GLOBAL, 'refunds.md#0')).toBeNull();
  });
});

// ─── Scenario — build machine to serverless runtime ────────────────

describe('corpus bundle — scenario', () => {
  it('indexCorpus → exportCorpus → staticVectorStore serves the same ranking as the source store', async () => {
    const buildStore = new InMemoryStore();
    const embedder = mockEmbedder();
    await indexCorpus({
      source: {
        text:
          `# Refunds\n\nRefunds are processed within three business days of the approval ` +
          `being granted, and the money returns to the original payment method used at ` +
          `purchase. A bank may take a further two to five days to post the credit to the ` +
          `account statement, which is outside our control entirely.\n\n# Pricing\n\nThe ` +
          `Pro plan costs twenty dollars per month and includes priority support for every ` +
          `team seat. The Free plan is limited to one hundred calls per month and exists ` +
          `for evaluation purposes only, without a service-level agreement attached.`,
        uri: 'docs.md',
      },
      store: buildStore,
      embedder,
    });

    const bundle = await exportCorpus(buildStore);
    const runtimeStore = staticVectorStore(JSON.parse(JSON.stringify(bundle)), embedder);

    const query = await embedder.embed({ text: 'how long do refunds take' });
    const fromBuild = await buildStore.search!(GLOBAL, query, { k: 3 });
    const fromBundle = await runtimeStore.search!(GLOBAL, query, { k: 3 });

    expect(fromBundle.map((r) => r.entry.id)).toEqual(fromBuild.map((r) => r.entry.id));
    fromBundle.forEach((r, i) => {
      expect(r.score).toBeCloseTo(fromBuild[i]!.score, 10);
    });
  });

  it('served entries are in the exact shape the retrieval formatter reads', async () => {
    const buildStore = new InMemoryStore();
    const embedder = mockEmbedder();
    await indexCorpus({
      source: {
        text: `# Refund timing\n\n${'Refunds are processed within three business days. '.repeat(
          8,
        )}`,
        uri: 'refunds.md',
      },
      store: buildStore,
      embedder,
    });
    const store = staticVectorStore(await exportCorpus(buildStore), embedder);
    const query = await embedder.embed({ text: 'refunds' });
    const [hit] = await store.search!(GLOBAL, query, { k: 1 });

    // The R1 lesson: the passage must come back through the SAME accessor the
    // formatter uses, and the provenance must still name its coordinates.
    expect(chunkText(hit!.entry.value)).toContain('three business days');
    const provenance = chunkProvenance(hit!.entry.value);
    expect(provenance.docUri).toBe('refunds.md');
    expect(provenance.heading).toBe('Refund timing');
  });

  it('defineRAG accepts a static store — the runtime wiring type-checks and builds', async () => {
    const { bundle, embedder } = await exportedBundle();
    const store = staticVectorStore(bundle, embedder);
    expect(() =>
      defineRAG({ id: 'docs', store, embedder, embedderId: bundle.embedder.id }),
    ).not.toThrow();
  });
});

// ─── Property ──────────────────────────────────────────────────────

describe('corpus bundle — property', () => {
  it('export → import → export is stable (same entries, same space)', async () => {
    const { bundle } = await exportedBundle();
    const target = new InMemoryStore();
    const written = await importCorpus(target, bundle);
    expect(written).toBe(bundle.entries.length);

    const again = await exportCorpus(target);
    expect(again.embedder).toEqual(bundle.embedder);
    expect(again.namespace).toBe(bundle.namespace);
    const byId = (b: CorpusBundle) =>
      [...b.entries]
        .sort((x, y) => x.id.localeCompare(y.id))
        .map((e) => ({
          id: e.id,
          text: e.text,
          vector: e.vector,
        }));
    expect(byId(again)).toEqual(byId(bundle));
  });
});

// ─── Security ──────────────────────────────────────────────────────

describe('corpus bundle — security', () => {
  it('write refusals never leak stored content — they teach the fix instead', async () => {
    const { bundle } = await exportedBundle();
    const store = staticVectorStore(bundle);
    const entry = (await store.get(GLOBAL, 'refunds.md#0'))!;
    try {
      await store.put(GLOBAL, entry);
      expect.unreachable('put must refuse');
    } catch (err) {
      const message = (err as Error).message;
      expect(message).toContain('read-only');
      expect(message).toContain('importCorpus');
      expect(message).not.toContain('three business days');
    }
  });
});

// ─── Refusal ───────────────────────────────────────────────────────

describe('corpus bundle — refusal', () => {
  it('every write method refuses teachingly', async () => {
    const { bundle } = await exportedBundle();
    const store = staticVectorStore(bundle);
    const entry = {
      id: 'x',
      value: {},
      version: 1,
      createdAt: 0,
      updatedAt: 0,
      lastAccessedAt: 0,
      accessCount: 0,
    };
    await expect(store.put(GLOBAL, entry)).rejects.toThrow(/read-only/);
    await expect(store.putMany(GLOBAL, [entry])).rejects.toThrow(/read-only/);
    await expect(store.putIfVersion(GLOBAL, entry, 0)).rejects.toThrow(/read-only/);
    await expect(store.delete(GLOBAL, 'x')).rejects.toThrow(/read-only/);
    await expect(store.forget(GLOBAL)).rejects.toThrow(/read-only/);
    await expect(store.feedback(GLOBAL, 'x', 1)).rejects.toThrow(/read-only/);
    await expect(store.recordSignature(GLOBAL, 'sig')).rejects.toThrow(/read-only/);
  });

  it('load-time fingerprint: dimensions always decide', async () => {
    const { bundle } = await exportedBundle();
    expect(() => staticVectorStore(bundle, { id: bundle.embedder.id, dimensions: 9999 })).toThrow(
      /different lengths|dimensions/,
    );
  });

  it('load-time fingerprint: ids decide only when both sides named themselves', async () => {
    const { bundle } = await exportedBundle();
    // Named vs named, different → refused.
    expect(() =>
      staticVectorStore(bundle, { id: 'other-embedder', dimensions: bundle.embedder.dimensions }),
    ).toThrow(/other-embedder/);
    // Anonymous runtime embedder → dimensions alone decide, and they match.
    expect(() =>
      staticVectorStore(bundle, { dimensions: bundle.embedder.dimensions }),
    ).not.toThrow();
  });

  it('search refuses a wrong-space query instead of ranking to an empty page', async () => {
    const { bundle } = await exportedBundle();
    const store = staticVectorStore(bundle);
    await expect(store.search!(GLOBAL, [1, 2, 3])).rejects.toThrow(/dimensions/);
    const query = new Array(bundle.embedder.dimensions).fill(0.1);
    await expect(store.search!(GLOBAL, query, { embedderId: 'swapped-embedder' })).rejects.toThrow(
      /swapped-embedder/,
    );
  });

  it('exportCorpus refuses an empty namespace, naming the identity-mismatch cause', async () => {
    await expect(exportCorpus(new InMemoryStore())).rejects.toThrow(/identity mismatch/);
  });

  it('exportCorpus refuses entries with no vector, naming them', async () => {
    const store = new InMemoryStore();
    await store.put(GLOBAL, {
      id: 'bare',
      value: { content: 'a passage without a vector' },
      version: 1,
      createdAt: 1,
      updatedAt: 1,
      lastAccessedAt: 1,
      accessCount: 0,
    });
    await expect(exportCorpus(store)).rejects.toThrow(/bare/);
  });

  it('exportCorpus refuses a namespace that mixes embedding spaces', async () => {
    const store = new InMemoryStore();
    const base = { version: 1, createdAt: 1, updatedAt: 1, lastAccessedAt: 1, accessCount: 0 };
    await store.put(GLOBAL, {
      ...base,
      id: 'a',
      value: { content: 'passage a' },
      embedding: [1, 0],
      embeddingModel: 'embedder-one',
    });
    await store.put(GLOBAL, {
      ...base,
      id: 'b',
      value: { content: 'passage b' },
      embedding: [0, 1],
      embeddingModel: 'embedder-two',
    });
    await expect(exportCorpus(store)).rejects.toThrow(/embedding spaces/);
  });

  it('a malformed bundle is refused by name — format, embedder, entries', () => {
    expect(() => staticVectorStore(null as never)).toThrow(/bundle/);
    expect(() => staticVectorStore({ format: 'something-else' } as never)).toThrow(
      /not a corpus bundle/,
    );
    expect(() =>
      staticVectorStore({
        format: CORPUS_BUNDLE_FORMAT,
        embedder: { id: 'e', dimensions: 2 },
        namespace: 'ns',
        exportedAt: 1,
        entries: [{ id: 'a', text: 'passage', vector: [1] }],
      } as never),
    ).toThrow(/2 dimensions/);
    expect(() =>
      staticVectorStore({
        format: CORPUS_BUNDLE_FORMAT,
        embedder: { id: 'e', dimensions: 2 },
        namespace: 'ns',
        exportedAt: 1,
        entries: [{ id: 'a', text: '   ', vector: [1, 0] }],
      } as never),
    ).toThrow(/no passage/);
  });

  it('importCorpus refuses a store that cannot serve vectors back', async () => {
    const { bundle } = await exportedBundle();
    // The capability bit is read BEFORE any method — a stub suffices.
    const serverSide = { supportsVectorSearch: false } as unknown as InMemoryStore;
    await expect(importCorpus(serverSide, bundle)).rejects.toThrow(/serve vectors/);
  });
});

// ─── Integration ───────────────────────────────────────────────────

describe('corpus bundle — integration', () => {
  it('importCorpus seeds a writable store that retrieval then reads normally', async () => {
    const { bundle, embedder } = await exportedBundle();
    const store = new InMemoryStore();
    await importCorpus(store, bundle);

    // Query with the passage's own text — cosine 1.0 against itself, so the
    // ranking is deterministic whatever the mock embedder's geometry.
    const query = await embedder.embed({
      text: 'Refunds are processed within three business days of approval.',
    });
    const results = await store.search!(GLOBAL, query, { k: 1 });
    expect(results.length).toBe(1);
    expect(chunkText(results[0]!.entry.value)).toContain('three business days');
    expect(chunkProvenance(results[0]!.entry.value).docUri).toBe('refunds.md');
  });
});
