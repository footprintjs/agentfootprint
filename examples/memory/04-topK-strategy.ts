/**
 * 04 — Top-K strategy: semantic retrieval via embeddings.
 *
 * Where Window/Summarize use recency, Top-K uses RELEVANCE: embed the
 * user's question, find the most semantically similar past entries by
 * cosine similarity, inject those.
 *
 * Strict threshold: when no entry meets `threshold`, return EMPTY.
 * Garbage past context is worse than no context.
 */

import {
  Agent,
  defineMemory,
  MEMORY_TYPES,
  MEMORY_STRATEGIES,
  InMemoryStore,
  mockEmbedder,
  mock,
  type LLMProvider,
} from '../../src/index.js';
import { isCliEntry, printResult, type ExampleMeta } from '../helpers/cli.js';

export const meta: ExampleMeta = {
  id: 'memory/04-topK-strategy',
  title: 'Top-K strategy — semantic retrieval (relevance, not recency)',
  group: 'memory',
  description:
    'Vector retrieval: embed the user query, return top-K cosine-similar ' +
    'past entries. Strict threshold means "no match → no injection" — no ' +
    'fallback that pollutes context.',
  defaultInput: 'Tell me about the refund policy you mentioned.',
  providerSlots: ['default'],
  tags: ['memory', 'semantic', 'topK', 'embeddings', 'relevance'],
};

export async function run(input: string, provider?: LLMProvider): Promise<string> {
  const embedder = mockEmbedder();
  // InMemoryStore needs the embedder for its built-in cosine search;
  // production stores (Pinecone, pgvector, Qdrant) plug in here without
  // changing the example.
  const store = new InMemoryStore();

  const memory = defineMemory({
    id: 'semantic-recall',
    type: MEMORY_TYPES.SEMANTIC,
    strategy: {
      kind: MEMORY_STRATEGIES.TOP_K,
      topK: 3,           // up to 3 most-relevant entries
      threshold: 0.6,    // strict: drop matches below 0.6 cosine
      embedder,
    },
    store,
  });

  const agent = Agent.create({
    provider: provider ?? mock({ reply: 'Refunds are processed within 3 business days.' }),
    model: 'mock',
    maxIterations: 1,
  })
    .system('You answer using semantically relevant context from prior conversations.')
    .memory(memory)
    .build();

  const identity = { conversationId: 'semantic-demo' };
  // Pre-populate with diverse turns; later, only the relevant one
  // surfaces via cosine similarity.
  await agent.run({ message: 'My refund policy lets me return items within 30 days.', identity });
  await agent.run({ message: 'My favorite color is blue.', identity });
  await agent.run({ message: 'I prefer email over phone calls.', identity });

  const result = await agent.run({ message: input, identity });
  if (typeof result !== 'string') throw new Error('Agent paused unexpectedly.');
  return result;
}

if (isCliEntry(import.meta.url)) {
  run(meta.defaultInput ?? '').then(printResult).catch(console.error);
}
