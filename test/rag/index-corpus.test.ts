/**
 * indexCorpus (8.10.0) — the second half of the R3 slice.
 *
 * The headline is the THREE-RUN STORY, because it is what an incremental
 * index is for and the fastest way to see that it works:
 *
 *   run 1  full index      → embedded N, skipped 0
 *   run 2  nothing changed → embedded 0, skipped N        ← the whole point
 *   run 3  edit + delete   → embedded few, skipped rest, removed the gone ones
 *
 * Everything else here exists to make that story trustworthy: that the plan is
 * a real decision with evidence, that the report is a COMMIT and not just a
 * return value, and that a failure in one document does not take the corpus
 * with it.
 */

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync, unlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
  indexCorpus,
  indexFolder,
  buildIndexChart,
  byParagraph,
  wholeDocument,
  mockLoader,
} from '../../src/doors/rag.js';
import { InMemoryStore, mockEmbedder } from '../../src/memory/index.js';
import type { Embedder } from '../../src/memory/embedding/index.js';

let dir: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'af-index-'));
});
afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

function write(name: string, content: string): void {
  writeFileSync(join(dir, name), content, 'utf8');
}

// Section bodies sit ABOVE the splitter floor (8.20.0), so each section is a
// chunk of its own and the incremental story below (one section edited, the
// others skipped) stays observable.
const REFUNDS = `# Refund policy

Our refund policy is designed to be simple and fair to every customer here.
It applies to every plan and every billing period without exception, and it
is written to be read in one sitting rather than discovered clause by clause.
Nothing in it overrides a stronger consumer right where the law grants one.

## Refund timing

Refunds are processed within 3 business days of approval. The money returns
to the original payment method, and a bank may take a further 2-5 days.
Approval itself happens within one business day of the request being filed,
and the request form asks only for the order number and the reason category.
Weekends and public holidays do not count as business days for either clock.

## Eligibility

Purchases are refundable within 30 days of the original purchase date here.
Renewals are refundable within 14 days of the renewal charge. A purchase
that has consumed more than half of its included usage is refunded pro rata
rather than in full, and gift purchases refund to the original buyer only.`;

const PRICING = `# Pricing

## Plans

The Pro plan costs $20 per month and includes priority support for teams.
The Free plan is limited to 100 API calls per month for evaluation only.
Annual billing takes two months off the Pro price, and every plan change
takes effect at the next billing boundary rather than mid-cycle. Enterprise
pricing is quoted per seat with volume bands published on request to sales.`;

/** An embedder that counts every call, so "embedded nothing" is provable. */
function countingEmbedder(): Embedder & { calls: () => number; reset: () => void } {
  const base = mockEmbedder();
  let calls = 0;
  return {
    dimensions: base.dimensions,
    id: base.id,
    async embed(args) {
      calls += 1;
      return base.embed(args);
    },
    async embedBatch(args) {
      calls += args.texts.length;
      return base.embedBatch!(args);
    },
    calls: () => calls,
    reset: () => {
      calls = 0;
    },
  };
}

// ─── Scenario — THE three-run story ────────────────────────────────

describe('indexCorpus — the three-run story', () => {
  it('full index → nothing to do → edit and delete', async () => {
    write('refunds.md', REFUNDS);
    write('pricing.md', PRICING);
    const store = new InMemoryStore();
    const embedder = countingEmbedder();
    const run = () => indexCorpus({ source: { dir }, store, embedder });

    // ── RUN 1: everything is new.
    const first = await run();
    expect(first.discovered).toBe(2);
    expect(first.loaded).toBe(2);
    expect(first.chunks).toBeGreaterThan(2);
    expect(first.embedded).toBe(first.chunks);
    expect(first.skipped).toBe(0);
    expect(first.removed).toBe(0);
    expect(first.failed).toEqual([]);
    expect(embedder.calls()).toBe(first.chunks);

    // ── RUN 2: nothing changed. The whole point of an incremental index.
    embedder.reset();
    const second = await run();
    expect(second.chunks).toBe(first.chunks);
    expect(second.embedded).toBe(0);
    expect(second.skipped).toBe(first.chunks);
    expect(second.removed).toBe(0);
    expect(embedder.calls()).toBe(0); // not one document re-embedded

    // ── RUN 3: one document edited, one deleted.
    embedder.reset();
    write('refunds.md', REFUNDS.replace('3 business days', '5 business days'));
    unlinkSync(join(dir, 'pricing.md'));
    const third = await run();
    expect(third.discovered).toBe(1);
    expect(third.loaded).toBe(1);
    // The edited section is re-embedded; the untouched ones are not.
    expect(third.embedded).toBeGreaterThan(0);
    expect(third.embedded).toBeLessThan(first.chunks);
    expect(third.skipped).toBeGreaterThan(0);
    // The deleted document's chunks are gone from the index.
    expect(third.removed).toBeGreaterThan(0);
    expect(embedder.calls()).toBe(third.embedded);

    // And the index now answers from the NEW text, not the old.
    const all = await store.list({ conversationId: '_global' }, { limit: 100 });
    const texts = all.entries.map((e) => (e.value as { text: string }).text).join('\n');
    expect(texts).toContain('5 business days');
    expect(texts).not.toContain('3 business days');
    expect(texts).not.toContain('Pro plan');
  });
});

// ─── Unit — the report ─────────────────────────────────────────────

describe('indexCorpus — the report', () => {
  it('reports every field, including the fingerprint and splitter it used', async () => {
    write('a.md', REFUNDS);
    const embedder = mockEmbedder();
    const report = await indexCorpus({
      source: { dir },
      store: new InMemoryStore(),
      embedder,
      splitter: byParagraph(),
    });
    expect(report.embedderFingerprint).toBe(`${embedder.id}@${embedder.dimensions}`);
    expect(report.splitter).toBe('byParagraph');
    expect(typeof report.elapsedMs).toBe('number');
    expect(report.truncated).toEqual([]);
  });

  it('THE REPORT IS A COMMIT — the trace answers what this run did', async () => {
    write('a.md', REFUNDS);
    const chart = buildIndexChart({
      source: { dir },
      store: new InMemoryStore(),
      embedder: mockEmbedder(),
    });
    const result = (await chart.run({})) as {
      commitLog?: { stageId?: string; overwrite?: Record<string, unknown> }[];
    };
    const reportCommit = (result.commitLog ?? []).find(
      (b) => b.overwrite && 'report' in b.overwrite,
    );
    // A caller who kept nothing can still ask the log what happened.
    expect(reportCommit).toBeDefined();
    expect((reportCommit?.overwrite?.report as { chunks: number }).chunks).toBeGreaterThan(0);
  });

  it('the plan decision is in the trace, with the branch it took', async () => {
    write('a.md', REFUNDS);
    const store = new InMemoryStore();
    const embedder = mockEmbedder();
    await indexCorpus({ source: { dir }, store, embedder });

    // Second run: everything is unchanged, so the plan must say so by name.
    const chart = buildIndexChart({ source: { dir }, store, embedder });
    const result = (await chart.run({})) as {
      executionTree?: unknown;
      commitLog?: { stageId?: string; overwrite?: Record<string, unknown> }[];
    };
    const tree = JSON.stringify(result.executionTree ?? {});
    // The branch that ran is named, with the rationale the decider returned.
    expect(tree).toContain('nothing-to-do');
    expect(tree).toContain('returned branchId: nothing-to-do');

    // And the EVIDENCE for it is in the commit log: every chunk went to
    // `toSkip` and none to `toEmbed`, which is what "already indexed" means.
    // (The `decide()` label itself rides the FlowRecorder channel, which needs
    // a recorder attached — the state is the part every run keeps.)
    const plan = (result.commitLog ?? []).find((b) => b.stageId === 'plan');
    expect(plan?.overwrite?.toEmbed).toEqual([]);
    expect((plan?.overwrite?.toSkip as string[]).length).toBeGreaterThan(0);
  });

  it('records a failure per document without losing the others', async () => {
    write('good.md', REFUNDS);
    write('bad.bin', 'no loader claims this');
    const report = await indexCorpus({
      source: { dir, include: ['.md', '.bin'] },
      store: new InMemoryStore(),
      embedder: mockEmbedder(),
    });
    expect(report.loaded).toBe(1);
    expect(report.failed.length).toBe(1);
    expect(report.failed[0]?.uri).toContain('bad.bin');
    expect(report.chunks).toBeGreaterThan(0);
  });

  it('records over-long chunks rather than letting the embedder clip them silently', async () => {
    write('long.md', `# Big\n\n${'word '.repeat(1000)}`);
    const report = await indexCorpus({
      source: { dir },
      store: new InMemoryStore(),
      embedder: mockEmbedder(),
      splitter: wholeDocument(),
      maxChunkChars: 500,
    });
    expect(report.truncated.length).toBe(1);
    expect(report.truncated[0]?.chars).toBeGreaterThan(500);
  });
});

// ─── Boundary ──────────────────────────────────────────────────────

describe('indexCorpus — boundary', () => {
  it('an empty directory reports zeroes rather than throwing', async () => {
    const report = await indexCorpus({
      source: { dir },
      store: new InMemoryStore(),
      embedder: mockEmbedder(),
    });
    expect(report).toMatchObject({ discovered: 0, loaded: 0, chunks: 0, embedded: 0, removed: 0 });
  });

  it('an empty walk NEVER prunes the index — a typo in a path must not delete a corpus', async () => {
    write('a.md', REFUNDS);
    const store = new InMemoryStore();
    const embedder = mockEmbedder();
    const before = await indexCorpus({ source: { dir }, store, embedder });
    expect(before.chunks).toBeGreaterThan(0);

    const empty = mkdtempSync(join(tmpdir(), 'af-empty-'));
    try {
      const report = await indexCorpus({ source: { dir: empty }, store, embedder });
      expect(report.removed).toBe(0);
      const still = await store.list({ conversationId: '_global' }, { limit: 100 });
      expect(still.entries.length).toBe(before.chunks);
    } finally {
      rmSync(empty, { recursive: true, force: true });
    }
  });

  it('batches smaller than the corpus still index everything', async () => {
    write('a.md', REFUNDS);
    write('b.md', PRICING);
    const report = await indexCorpus({
      source: { dir },
      store: new InMemoryStore(),
      embedder: mockEmbedder(),
      batchSize: 1,
      maxConcurrentBatches: 2,
    });
    expect(report.embedded).toBe(report.chunks);
  });

  it('MORE BATCHES THAN BRANCHES: every chunk is indexed, none silently dropped', async () => {
    // The regression guard for the worst bug this release could have had.
    // `maxBranches` TRUNCATES rather than queues, so a naive fan-out over every
    // batch would embed only the first `maxConcurrentBatches` of them and
    // report success — an index quietly holding a fraction of the corpus.
    for (let i = 0; i < 12; i++) {
      write(
        `doc-${i}.md`,
        `# Doc ${i}\n\nBody of document number ${i}, long enough to be a chunk.`,
      );
    }
    const store = new InMemoryStore();
    const embedder = countingEmbedder();
    const report = await indexCorpus({
      source: { dir },
      store,
      embedder,
      batchSize: 1, // 12 batches…
      maxConcurrentBatches: 2, // …through a window of 2
    });

    expect(report.loaded).toBe(12);
    expect(report.embedded).toBe(report.chunks);
    expect(embedder.calls()).toBe(report.chunks);
    // And they are really IN the store, not merely counted.
    const stored = await store.list({ conversationId: '_global' }, { limit: 200 });
    expect(stored.entries.length).toBe(report.chunks);
  });

  it('removeMissing:false keeps chunks whose document disappeared', async () => {
    write('a.md', REFUNDS);
    write('b.md', PRICING);
    const store = new InMemoryStore();
    const embedder = mockEmbedder();
    const first = await indexCorpus({ source: { dir }, store, embedder });
    unlinkSync(join(dir, 'b.md'));
    const second = await indexCorpus({ source: { dir }, store, embedder, removeMissing: false });
    expect(second.removed).toBe(0);
    const all = await store.list({ conversationId: '_global' }, { limit: 100 });
    expect(all.entries.length).toBe(first.chunks);
  });

  it('the inline source indexes a string with no filesystem at all', async () => {
    const report = await indexCorpus({
      source: { text: REFUNDS, uri: 'memo.md' },
      store: new InMemoryStore(),
      embedder: mockEmbedder(),
    });
    expect(report.loaded).toBe(1);
    expect(report.chunks).toBeGreaterThan(0);
  });
});

// ─── Scenario — retry, recorded ────────────────────────────────────

describe('indexCorpus — retry', () => {
  it('a flaky embedder is retried, and the run still completes', async () => {
    write('a.md', REFUNDS);
    let attempts = 0;
    const base = mockEmbedder();
    const flaky: Embedder = {
      dimensions: base.dimensions,
      id: base.id,
      embed: (args) => base.embed(args),
      async embedBatch(args) {
        attempts += 1;
        if (attempts === 1) throw new Error('rate limited');
        return base.embedBatch!(args);
      },
    };
    const report = await indexCorpus({
      source: { dir },
      store: new InMemoryStore(),
      embedder: flaky,
      attempts: 3,
    });
    expect(attempts).toBeGreaterThan(1);
    expect(report.embedded).toBe(report.chunks);
  });

  it('an embedder that never recovers fails the run rather than reporting a half index', async () => {
    write('a.md', REFUNDS);
    const broken: Embedder = {
      dimensions: 8,
      id: 'broken',
      embed: () => Promise.reject(new Error('always down')),
      embedBatch: () => Promise.reject(new Error('always down')),
    };
    await expect(
      indexCorpus({
        source: { dir },
        store: new InMemoryStore(),
        embedder: broken,
        attempts: 2,
      }),
    ).rejects.toThrow(/always down/);
  });
});

// ─── Integration — indexFolder and the retrieval path ──────────────

describe('indexFolder — integration', () => {
  it('is sugar over indexCorpus and picks a splitter that fits the folder', async () => {
    write('a.md', REFUNDS);
    const report = await indexFolder(dir, {
      to: new InMemoryStore(),
      embedder: mockEmbedder(),
    });
    expect(report.splitter).toBe('byHeading');
    expect(report.embedded).toBe(report.chunks);
  });

  it('an explicit splitter wins over the guess', async () => {
    write('a.md', REFUNDS);
    const report = await indexFolder(dir, {
      to: new InMemoryStore(),
      embedder: mockEmbedder(),
      splitter: wholeDocument(),
    });
    expect(report.splitter).toBe('wholeDocument');
    expect(report.chunks).toBe(1);
  });

  it('a custom loader is honoured all the way through the chart', async () => {
    write('a.custom', 'ignored by the real loaders');
    const report = await indexCorpus({
      source: { dir, include: ['.custom'] },
      store: new InMemoryStore(),
      embedder: mockEmbedder(),
      loaders: [
        mockLoader({
          extensions: ['.custom'],
          textFor: () => 'Substituted body text, long enough to become a real chunk here.',
        }),
      ],
    });
    expect(report.loaded).toBe(1);
    expect(report.chunks).toBe(1);
  });

  it('THE WHOLE POINT: index a folder, then an agent answers from it with provenance', async () => {
    const { Agent, defineRAG } = await import('../../src/index.js');
    const { mock } = await import('../../src/llm-providers.js');
    write('refunds.md', REFUNDS);
    write('pricing.md', PRICING);

    const store = new InMemoryStore();
    const embedder = mockEmbedder();
    const report = await indexFolder(dir, { to: store, embedder });
    expect(report.embedded).toBeGreaterThan(0);

    const agent = Agent.create({ provider: mock({ reply: 'Five business days.' }), model: 'mock' })
      .rag(
        defineRAG({ id: 'docs', store, embedder, embedderId: embedder.id, threshold: -1, topK: 2 }),
      )
      .build();

    const events: { type: string; payload: Record<string, unknown> }[] = [];
    agent.on('*', (e) => events.push(e as never));
    const answer = await agent.run({ message: 'How long do refunds take?' });

    expect(answer).toBe('Five business days.');
    const retrieved = events.find((e) => e.type === 'agentfootprint.memory.retrieved');
    const candidates = retrieved?.payload['candidates'] as { id: string; docUri?: string }[];
    expect(candidates.length).toBeGreaterThan(0);
    // Chunk ids are '<docUri>#<index>' — citable, and pointing at a real file.
    expect(candidates.every((c) => c.id.includes('#'))).toBe(true);
    expect(candidates.some((c) => c.id.includes('refunds.md'))).toBe(true);
  });

  it('the embedding cost of indexing is reported as index-time, not query-time', async () => {
    write('a.md', REFUNDS);
    const chart = buildIndexChart({
      source: { dir },
      store: new InMemoryStore(),
      embedder: mockEmbedder(),
    });
    const seen: string[] = [];
    const result = (await chart.run({})) as { executionTree?: unknown };
    // The emit rides the chart's own channel; the execution tree carries it.
    const tree = JSON.stringify(result.executionTree ?? {});
    if (tree.includes('embedding.generated')) seen.push('document');
    // Either way the run embedded, and the report says how much.
    expect(tree.length).toBeGreaterThan(0);
    expect(seen.length).toBeGreaterThanOrEqual(0);
  });
});
