/**
 * 06 — Causal memory: store footprintjs snapshots for cross-run replay.
 *
 * THE differentiator. Persists `(query, finalContent)` snapshots of
 * past agent runs, embedded for retrieval. New questions match against
 * past queries via cosine similarity → inject the prior decision
 * evidence → LLM answers from EXACT past facts (zero hallucination).
 *
 * Bonus: the snapshot data shape doubles as SFT/DPO training data.
 * Every successful production run becomes a labeled trajectory.
 */

import {
  Agent,
  defineMemory,
  MEMORY_TYPES,
  MEMORY_STRATEGIES,
  SNAPSHOT_PROJECTIONS,
  InMemoryStore,
  mockEmbedder,
  mock,
  type LLMProvider,
} from '../../src/index.js';
import { isCliEntry, printResult, type ExampleMeta } from '../helpers/cli.js';

export const meta: ExampleMeta = {
  id: 'memory/06-causal-snapshot',
  title: 'Causal memory — store footprintjs snapshots, replay decisions',
  group: 'memory',
  description:
    'The differentiator: persist past run snapshots tagged with the ' +
    'original query, retrieve via cosine similarity, inject decision ' +
    'evidence so follow-up questions get EXACT past facts (zero hallucination).',
  defaultInput: 'Why was my application rejected last week?',
  providerSlots: ['default'],
  tags: ['memory', 'causal', 'snapshot', 'cross-run', 'differentiator'],
};

export async function run(input: string, provider?: LLMProvider): Promise<string> {
  const embedder = mockEmbedder();
  const store = new InMemoryStore();

  // #region define-causal
  const causal = defineMemory({
    id: 'causal',
    description: 'Store snapshots of past runs; replay decisions on follow-up.',
    type: MEMORY_TYPES.CAUSAL,
    strategy: {
      kind: MEMORY_STRATEGIES.TOP_K,
      topK: 1,           // single best-matching past run
      threshold: 0.5,    // strict — drop weak matches (no fallback)
      embedder,
    },
    store,
    projection: SNAPSHOT_PROJECTIONS.DECISIONS,  // inject decision evidence
  });
  // #endregion define-causal

  const agent = Agent.create({
    provider: provider ?? mock({ reply: 'Your application was rejected because creditScore (580) was below threshold (600).' }),
    model: 'mock',
    maxIterations: 1,
  })
    .system('You answer follow-up questions using past decision evidence, not reconstructed reasoning.')
    .memory(causal)
    .build();

  const identity = { conversationId: 'loan-applications' };

  // Turn 1 (e.g. last Monday): user submits a loan application.
  // The agent's reasoning + final decision get persisted.
  await agent.run({
    message: 'Should I approve loan #42? creditScore=580 dti=0.45',
    identity,
  });

  // Turn 2 (e.g. this Friday): user asks a follow-up about that
  // earlier decision. The causal memory loads the prior snapshot's
  // decision evidence into context. The LLM answers from EXACT past
  // facts, not from re-derivation.
  const result = await agent.run({ message: input, identity });
  if (typeof result !== 'string') throw new Error('Agent paused unexpectedly.');
  return result;
}

if (isCliEntry(import.meta.url)) {
  run(meta.defaultInput ?? '').then(printResult).catch(console.error);
}
