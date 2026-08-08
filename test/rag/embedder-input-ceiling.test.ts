/**
 * The embedder's input ceiling (9.1.0) — the end of silent partial embedding.
 *
 * THE BUG, as it was measured in a production field report: `indexCorpus`
 * defaulted its `maxChunkChars` to 2,000 (the on-device `localEmbedder` cliff)
 * whatever embedder it was handed, while the splitter was told
 * `byHeading({ maxChars: 2500 })`. Six of twenty-six chunks were therefore
 * embedded CLIPPED — indexed by their opening, served whole as the passage —
 * against an embedder that reads sixteen times as much. Retrieval could not
 * find wording plainly visible in the `<source>` block the model was shown,
 * and nothing anywhere said so.
 *
 * Two fixes, both tested here:
 *   1. the ceiling is DECLARED by the embedder (`maxInputChars`) and read in
 *      preference to the indexer's default — an explicit `maxChunkChars` still
 *      wins, and an embedder that declares nothing behaves exactly as before;
 *   2. what was clipped is SAID OUT LOUD, once, with the count and the fix —
 *      an invisible failure is indistinguishable from success.
 *
 * Vendor-free: every embedder here is the mock or a hand-built one. Nothing
 * downloads, no key is read, no network is touched.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';

import { indexCorpus, wholeDocument } from '../../src/doors/rag.js';
import { indexDocuments } from '../../src/index.js';
import { InMemoryStore, mockEmbedder } from '../../src/memory/index.js';
import type { Embedder } from '../../src/memory/embedding/index.js';

afterEach(() => vi.restoreAllMocks());

/**
 * A mock-backed embedder that declares (or deliberately omits) a ceiling.
 * Built by hand rather than spread from `mockEmbedder()` because the ABSENCE
 * of the field is one of the cases under test, and `mockEmbedder` declares one.
 */
function embedderDeclaring(maxInputChars?: number): Embedder {
  const base = mockEmbedder();
  return {
    dimensions: base.dimensions,
    id: 'test-embedder',
    ...(maxInputChars !== undefined && { maxInputChars }),
    embed: (args) => base.embed(args),
    embedBatch: async ({ texts }) => Promise.all(texts.map((text) => base.embed({ text }))),
  };
}

/** One document of exactly `chars` characters, as one chunk (`wholeDocument`). */
function textOf(chars: number): string {
  return 'a'.repeat(chars);
}

async function indexOne(
  chars: number,
  embedder: Embedder,
  maxChunkChars?: number,
): Promise<Awaited<ReturnType<typeof indexCorpus>>> {
  return indexCorpus({
    source: { text: textOf(chars), uri: 'inline.md' },
    store: new InMemoryStore(),
    embedder,
    splitter: wholeDocument(),
    ...(maxChunkChars !== undefined && { maxChunkChars }),
  });
}

// ─── Unit — which number wins ──────────────────────────────────────

describe('the input ceiling — where the number comes from', () => {
  it("THE FIX: the embedder's declared ceiling beats the indexer's default", async () => {
    // 2,500 characters — over the old 2,000 default, well inside an embedder
    // that says it reads 8,000. Before 9.1.0 this was reported (and treated)
    // as clipped by an embedder that would have read it whole.
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const report = await indexOne(2500, embedderDeclaring(8000));
    expect(report.truncated).toEqual([]);
    expect(report.truncatedCount).toBe(0);
    expect(warn).not.toHaveBeenCalled();
  });

  it('an explicit maxChunkChars beats the declared ceiling — the caller may know better', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const report = await indexOne(2500, embedderDeclaring(8000), 500);
    expect(report.truncatedCount).toBe(1);
    expect(report.truncated[0]?.chars).toBe(2500);
    // The message names WHOSE number it is, so the reader knows which knob is
    // theirs: here, their own.
    expect(warn.mock.calls[0]?.[0]).toContain('the maxChunkChars you passed');
  });

  it('an embedder that declares nothing gets exactly the old behaviour — the 2,000 default', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const under = await indexOne(1900, embedderDeclaring());
    expect(under.truncatedCount).toBe(0);
    const over = await indexOne(2100, embedderDeclaring());
    expect(over.truncatedCount).toBe(1);
  });

  it('a nonsense ceiling is ignored rather than obeyed', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    // 0 cannot describe a real ceiling; obeying it would mark every chunk in
    // the corpus truncated on the strength of a typo. Both levels fall
    // through to the default.
    const explicitZero = await indexOne(1500, embedderDeclaring(8000), 0);
    expect(explicitZero.truncatedCount).toBe(0);
    const declaredZero = await indexOne(2100, embedderDeclaring(0));
    expect(declaredZero.truncatedCount).toBe(1);
  });
});

// ─── Scenario — the warning ────────────────────────────────────────

describe('indexCorpus — clipping is said out loud', () => {
  it('warns ONCE per run, naming the count, the ceiling in effect and the fix', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const store = new InMemoryStore();
    const embedder = embedderDeclaring(1000);
    // Three documents, all over the declared 1,000-character ceiling.
    for (const uri of ['a.md', 'b.md', 'c.md']) {
      await indexCorpus({
        source: { text: textOf(1500), uri },
        store,
        embedder,
        splitter: wholeDocument(),
      });
    }
    // One run, one line — not one per chunk, and not one per batch.
    expect(warn).toHaveBeenCalledTimes(3);

    const single = await indexCorpus({
      source: { text: `${textOf(1500)} tail`, uri: 'd.md' },
      store,
      embedder,
      splitter: wholeDocument(),
    });
    expect(single.truncatedCount).toBe(1);
    const message = String(warn.mock.calls.at(-1)?.[0]);
    expect(message).toContain('indexCorpus');
    expect(message).toContain('1 of 1');
    expect(message).toContain('1000-character');
    expect(message).toContain("'test-embedder'"); // whose ceiling it is
    expect(message).toContain('maxChunkChars'); // the knob
    expect(message).toContain('truncated'); // where the ids are
  });

  it('says nothing when nothing was clipped — a warning nobody can act on is noise', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const report = await indexOne(400, embedderDeclaring(8000));
    expect(report.embedded).toBe(1);
    expect(warn).not.toHaveBeenCalled();
  });

  it('truncatedCount is the length of the list, in the report AND in the commit log', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const report = await indexOne(3000, embedderDeclaring(1000));
    expect(report.truncatedCount).toBe(report.truncated.length);
    expect(report.truncatedCount).toBe(1);
  });
});

// ─── Unit — the other door that embeds a corpus ────────────────────

describe('indexDocuments — the same ceiling, the same warning', () => {
  it("reads the embedder's declared ceiling in preference to the default", async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const count = await indexDocuments(new InMemoryStore(), embedderDeclaring(8000), [
      { id: 'long', content: textOf(2500) },
    ]);
    expect(count).toBe(1);
    expect(warn).not.toHaveBeenCalled();
  });

  it('warns once, naming the count, when documents are longer than the ceiling', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    await indexDocuments(new InMemoryStore(), embedderDeclaring(1000), [
      { id: 'a', content: textOf(1500) },
      { id: 'b', content: textOf(1500) },
      { id: 'c', content: 'short enough' },
    ]);
    expect(warn).toHaveBeenCalledTimes(1);
    const message = String(warn.mock.calls[0]?.[0]);
    expect(message).toContain('indexDocuments');
    expect(message).toContain('2 of 3');
    // The fix has to be actionable AT THIS DOOR: it does not split, so it
    // never tells you to lower a splitter option you did not pass.
    expect(message).toContain('cut them into chunks before indexing');
    expect(message).not.toContain("splitter's maxChars");
  });

  it('an explicit maxChunkChars wins here too', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    await indexDocuments(
      new InMemoryStore(),
      embedderDeclaring(8000),
      [{ id: 'a', content: textOf(2500) }],
      { maxChunkChars: 1000 },
    );
    expect(warn).toHaveBeenCalledTimes(1);
    expect(String(warn.mock.calls[0]?.[0])).toContain('1 of 1');
  });
});
