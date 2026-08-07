/**
 * 10 — A corpus in a file: embed it once, not once per restart.
 *
 * `InMemoryStore` is a `Map`. Its cost is the one nobody notices until the
 * bill arrives: restart the process and the whole corpus is re-embedded.
 * `sqliteVectorStore` is the same `MemoryStore` port backed by one SQLite
 * file — zero dependencies (`node:sqlite` is inside Node), exact cosine
 * search, and the vectors still there on the next boot.
 *
 *   1. Open the index (creates the file and its directory on first run).
 *   2. Index only what is not already indexed — the second run embeds nothing.
 *   3. Warm the matrix at boot, so the first user question does not pay for it.
 *   4. Retrieve with `defineRAG`, exactly as against any other store.
 *
 * This example runs the whole thing TWICE against one file, so the second
 * pass prints what a restart actually costs: one embedding for the question,
 * and none for the corpus.
 *
 * Needs Node 22.5+ (`node:sqlite`). On Node 20 the store refuses by name and
 * says what to do — it never silently falls back to memory, because an index
 * that forgot every document looks exactly like a corpus that was never built.
 */

import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { Agent, defineRAG, indexDocuments, type LLMProvider } from '../../src/index.js';
import { sqliteVectorStore, mockEmbedder } from '../../src/doors/memory.js';
import { mock } from '../../src/doors/providers.js';
import { isCliEntry, printResult, type ExampleMeta } from '../helpers/cli.js';

export const meta: ExampleMeta = {
  id: 'memory/10-durable-vector-index',
  title: 'Durable vector index — embed the corpus once, ever',
  group: 'memory',
  description:
    'sqliteVectorStore keeps the corpus in one file, so a restart re-embeds ' +
    'nothing. Exact cosine search, zero dependencies, and a refusal when a ' +
    'second embedder tries to enter the same index.',
  defaultInput: 'How long do refunds take?',
  providerSlots: ['default'],
  tags: ['memory', 'rag', 'retrieval', 'sqlite', 'durable'],
};

const DOCS = [
  {
    id: 'refunds.md#0',
    content: 'Refunds are processed within 3 business days of approval.',
    metadata: { source: 'refunds.md', heading: 'Refund timing' },
  },
  {
    id: 'pricing.md#0',
    content: 'The Pro plan costs $20 per month and includes priority support.',
    metadata: { source: 'pricing.md' },
  },
  {
    id: 'security.md#0',
    content: 'All data is encrypted at rest using AES-256.',
    metadata: { source: 'security.md' },
  },
];

export async function run(input: string, provider?: LLMProvider): Promise<string> {
  const dir = mkdtempSync(join(tmpdir(), 'af-corpus-'));
  const file = join(dir, 'corpus.db');
  const lines: string[] = [];

  try {
    // Two passes over ONE file. The second is what a restart looks like.
    for (const pass of [1, 2]) {
      // #region open-and-index
      const store = sqliteVectorStore({ file });
      const embedder = mockEmbedder();

      // Index only what is missing. On the second boot every document is
      // already there, so this embeds nothing at all — the whole point of a
      // file. (R3 turns this into one call over a folder; today it is a
      // `get()` per id, which is exactly what it looks like.)
      const missing = [];
      for (const doc of DOCS) {
        if ((await store.get({ conversationId: '_global' }, doc.id)) === null) missing.push(doc);
      }
      let embedded = 0;
      if (missing.length > 0) {
        embedded = await indexDocuments(store, embedder, missing, {
          // The embedder names its own space; the store fingerprints the
          // namespace with it and refuses a different one later.
          embedderId: embedder.id,
          onEmbedding: (e) => lines.push(`  index-time: embedded ${e.count} documents`),
        });
      }

      // Pay the hydration cost at boot rather than on the first question.
      const warmed = await store.warm({ conversationId: '_global' });
      // #endregion open-and-index

      lines.push(
        `pass ${pass}: embedded ${embedded} documents, warmed ${warmed.count} vectors ` +
          `(journal=${store.journalMode}, fingerprint=${String(
            store.fingerprintOf({ conversationId: '_global' }),
          )})`,
      );

      const agent = Agent.create({
        provider: provider ?? mock({ reply: 'Refunds are processed within 3 business days.' }),
        model: 'mock',
        maxIterations: 1,
      })
        .system('You answer support questions using the retrieved passages. Cite the source id.')
        .rag(defineRAG({ id: 'product-docs', store, embedder, embedderId: embedder.id, threshold: 0.5 }))
        .build();

      agent.on('agentfootprint.embedding.generated', (e) => {
        if (e.payload.inputKind === 'query') lines.push(`  query-time: 1 embedding`);
      });

      const result = await agent.run({ message: input });
      if (typeof result !== 'string') throw new Error('Agent paused unexpectedly.');
      if (pass === 2) {
        lines.push(`\nanswer: ${result}`);
        return lines.join('\n');
      }
      // Close the file, exactly as a process exit would.
      store.close();
    }
    throw new Error('unreachable');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

if (isCliEntry(import.meta.url)) {
  run(meta.defaultInput ?? '').then(printResult).catch(console.error);
}
