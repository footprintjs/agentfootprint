/**
 * 07 — RAG: retrieval-augmented generation as a context-engineering flavor.
 *
 * `defineRAG` + `indexDocuments` — one factory, one seeding helper.
 * Composes over the memory subsystem (semantic + top-K + strict
 * threshold). No new engine code.
 *
 *   1. Build a vector-capable store + embedder.
 *   2. Seed the store with documents (`indexDocuments`).
 *   3. Define the retriever (`defineRAG`).
 *   4. Wire to agent (`agent.rag(...)`).
 *   5. Ask a question — the matching passages are injected into the
 *      SYSTEM-PROMPT slot as citable `<source>` blocks.
 *
 * Note what this example does NOT do: pass an identity. A corpus lives in
 * its own namespace (`corpus`, defaulting to the same `'_global'` that
 * `indexDocuments` writes to), so the two sides meet with no argument on
 * either. Before 8.8.0 this example had to pass
 * `identity: { conversationId: '_global' }` by hand, and anyone who copied
 * the shorter snippet from the README retrieved nothing at all, silently.
 */

import { Agent, defineRAG, indexDocuments, type LLMProvider } from '../../src/index.js'
import { InMemoryStore, mockEmbedder } from '../../src/doors/memory.js'
import { mock } from '../../src/doors/providers.js';
import { isCliEntry, printResult, type ExampleMeta } from '../helpers/cli.js';

export const meta: ExampleMeta = {
  id: 'context-engineering/07-rag',
  title: 'RAG — retrieval-augmented generation',
  group: 'context-engineering',
  description:
    'Embed user query, retrieve top-K documents, inject as user-role ' +
    'messages. Strict threshold means "no fallback" when nothing matches.',
  defaultInput: 'How long do refunds take?',
  providerSlots: ['default'],
  tags: ['context-engineering', 'rag', 'retrieval', 'semantic'],
};

export async function run(input: string, provider?: LLMProvider): Promise<string> {
  const embedder = mockEmbedder();
  const store = new InMemoryStore();

  // Seed the corpus once at startup. In production: index docs from
  // a CMS / file dump / scraper, then persist to pgvector / Pinecone.
  await indexDocuments(store, embedder, [
    {
      id: 'refunds',
      content: 'Refunds are processed within 3 business days. Original payment method is credited.',
      metadata: { topic: 'billing' },
    },
    {
      id: 'pricing',
      content: 'The Pro plan costs $20 per month and includes priority support.',
      metadata: { topic: 'plans' },
    },
    {
      id: 'free-tier',
      content: 'The Free plan is limited to 100 API calls per month.',
      metadata: { topic: 'plans' },
    },
  ]);

  // #region define-and-attach
  const docs = defineRAG({
    id: 'product-docs',
    description: 'Product documentation chunks',
    store,
    embedder,
    topK: 2,           // up to 2 most-relevant docs per query
    threshold: 0.5,    // strict — drop weak matches
  });
  // Matches land in the SYSTEM-PROMPT slot as one system message carrying
  // every chunk as a `<source id=… doc=… score=…>` block the model can
  // cite. (`asRole` was removed in 7.20.0 — it was never read, so it
  // described a placement that never happened.)

  const agent = Agent.create({
    provider: provider ?? mock({ reply: 'Refunds are processed within 3 business days.' }),
    model: 'mock',
    maxIterations: 1,
  })
    .system('You answer support questions using the retrieved docs.')
    .rag(docs)
    .build();
  // #endregion define-and-attach

  // No identity needed: the retriever declares its own corpus namespace,
  // and it defaults to the one `indexDocuments` wrote to.
  const result = await agent.run({ message: input });
  if (typeof result !== 'string') throw new Error('Agent paused unexpectedly.');
  return result;
}

if (isCliEntry(import.meta.url)) {
  run(meta.defaultInput ?? '').then(printResult).catch(console.error);
}
