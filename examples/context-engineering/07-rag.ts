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
 *   5. Ask a question — relevant docs are injected as user-role
 *      messages before the LLM call.
 */

import {
  Agent, defineRAG, indexDocuments,
  InMemoryStore, mockEmbedder, mock,
  type LLMProvider,
} from '../../src/index.js';
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
    asRole: 'user',    // chunks land as user-role context (RAG default)
  });

  const agent = Agent.create({
    provider: provider ?? mock({ reply: 'Refunds are processed within 3 business days.' }),
    model: 'mock',
    maxIterations: 1,
  })
    .system('You answer support questions using the retrieved docs.')
    .rag(docs)
    .build();
  // #endregion define-and-attach

  // Identity is shared with the corpus indexing default ('_global').
  const result = await agent.run({
    message: input,
    identity: { conversationId: '_global' },
  });
  if (typeof result !== 'string') throw new Error('Agent paused unexpectedly.');
  return result;
}

if (isCliEntry(import.meta.url)) {
  run(meta.defaultInput ?? '').then(printResult).catch(console.error);
}
