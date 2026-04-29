/**
 * 07 — Hybrid: compose multiple memory types and strategies on one agent.
 *
 * The "auto" preset of memory: layer recent conversation, semantic
 * facts, narrative beats, and causal snapshots — each as its own
 * `.memory()` registration. Per-id scope keys keep them collision-free.
 *
 * For reading order, registration order = injection order. For most
 * use cases register from MOST-recent (window) to MOST-relevant (causal).
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
  id: 'memory/07-hybrid-auto',
  title: 'Hybrid — compose recent + facts + causal snapshots',
  group: 'memory',
  description:
    'Stack multiple memory types on one agent: short-term window, ' +
    'semantic facts, and causal snapshots — each its own `.memory()` ' +
    'registration with isolated scope keys.',
  defaultInput: 'What do you know about my recent loan application?',
  providerSlots: ['default'],
  tags: ['memory', 'hybrid', 'composed', 'production-ready'],
};

export async function run(input: string, provider?: LLMProvider): Promise<string> {
  const embedder = mockEmbedder();

  // Each memory uses its OWN store. Production: pair with different
  // backends (Redis for hot recent, Postgres for facts, S3+pgvector
  // for causal — each peer-dep adapter slots in).
  const recentStore = new InMemoryStore();
  const factsStore = new InMemoryStore();
  const causalStore = new InMemoryStore();

  // 1. Short-term: last 10 turns (cheap, fast)
  const recent = defineMemory({
    id: 'recent',
    type: MEMORY_TYPES.EPISODIC,
    strategy: { kind: MEMORY_STRATEGIES.WINDOW, size: 10 },
    store: recentStore,
  });

  // 2. Semantic facts: pattern-extracted, recency-loaded
  const facts = defineMemory({
    id: 'facts',
    type: MEMORY_TYPES.SEMANTIC,
    strategy: {
      kind: MEMORY_STRATEGIES.EXTRACT,
      extractor: 'pattern',
      maxPerTurn: 5,
    },
    store: factsStore,
  });

  // 3. Causal: snapshots of past runs, retrieved by semantic match
  const causal = defineMemory({
    id: 'causal',
    type: MEMORY_TYPES.CAUSAL,
    strategy: {
      kind: MEMORY_STRATEGIES.TOP_K,
      topK: 1,
      threshold: 0.5,
      embedder,
    },
    store: causalStore,
  });

  const agent = Agent.create({
    provider: provider ?? mock({ reply: 'Your loan #42 was rejected; you mentioned upgrading to Pro.' }),
    model: 'mock',
    maxIterations: 1,
  })
    .system('You are a comprehensive assistant with multiple memory types.')
    // Registration order = injection order in the system prompt slot.
    .memory(recent)
    .memory(facts)
    .memory(causal)
    .build();

  const identity = { conversationId: 'hybrid-demo' };
  await agent.run({ message: 'My name is Alice and I just upgraded to Pro.', identity });
  await agent.run({ message: 'Should I approve loan #42? creditScore=580', identity });
  const result = await agent.run({ message: input, identity });
  if (typeof result !== 'string') throw new Error('Agent paused unexpectedly.');
  return result;
}

if (isCliEntry(import.meta.url)) {
  run(meta.defaultInput ?? '').then(printResult).catch(console.error);
}
