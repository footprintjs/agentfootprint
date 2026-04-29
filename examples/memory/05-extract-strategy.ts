/**
 * 05 — Extract strategy: LLM distills structured facts/beats on write.
 *
 * The smart-write counterpart to Top-K's smart-read. Extracts structured
 * data (facts, narrative beats) from conversation turns at write time.
 * Read side then recalls those structured shapes (not raw messages),
 * giving more compact + reliable context.
 *
 * Pattern variant: 'pattern' (free, regex heuristics) or 'llm' (paid).
 */

import {
  Agent,
  defineMemory,
  MEMORY_TYPES,
  MEMORY_STRATEGIES,
  InMemoryStore,
  mock,
  type LLMProvider,
} from '../../src/index.js';
import { isCliEntry, printResult, type ExampleMeta } from '../helpers/cli.js';

export const meta: ExampleMeta = {
  id: 'memory/05-extract-strategy',
  title: 'Extract strategy — LLM distills facts/beats on write',
  group: 'memory',
  description:
    'Smart-write: an extractor (pattern-based or LLM-backed) pulls ' +
    'structured facts from each turn at write time. Read side loads ' +
    'top facts/beats — more compact + dedupe-friendly than raw messages.',
  defaultInput: 'What do you know about me?',
  providerSlots: ['default'],
  tags: ['memory', 'semantic', 'extract', 'facts', 'smart-write'],
};

export async function run(input: string, provider?: LLMProvider): Promise<string> {
  const store = new InMemoryStore();

  // Pattern extractor — regex heuristics, zero LLM cost. Swap to
  // 'llm' + an `llm: anthropic('claude-haiku-4-5')` for richer extraction.
  const memory = defineMemory({
    id: 'user-facts',
    type: MEMORY_TYPES.SEMANTIC,
    strategy: {
      kind: MEMORY_STRATEGIES.EXTRACT,
      extractor: 'pattern',
      minConfidence: 0.7,   // discard low-confidence extractions
      maxPerTurn: 5,        // cap to prevent fact explosion
    },
    store,
  });

  const agent = Agent.create({
    provider: provider ?? mock({ reply: "I know your name is Alice and you're on the Pro plan." }),
    model: 'mock',
    maxIterations: 1,
  })
    .system('You are a helpful assistant who learns facts about the user.')
    .memory(memory)
    .build();

  const identity = { conversationId: 'extract-demo' };
  await agent.run({ message: 'My name is Alice and I work at Acme.', identity });
  await agent.run({ message: 'I just upgraded to the Pro plan.', identity });
  const result = await agent.run({ message: input, identity });
  if (typeof result !== 'string') throw new Error('Agent paused unexpectedly.');
  return result;
}

if (isCliEntry(import.meta.url)) {
  run(meta.defaultInput ?? '').then(printResult).catch(console.error);
}
