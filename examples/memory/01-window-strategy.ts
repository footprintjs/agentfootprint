/**
 * 01 — Window strategy: short-term sliding window memory.
 *
 * The 90% case for "remember the last N turns of conversation."
 * Pure rule-based, no LLM calls, no embeddings. Cheapest and simplest
 * memory strategy.
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
  id: 'memory/01-window-strategy',
  title: 'Window strategy — last N turns (short-term, rule-based)',
  group: 'memory',
  description:
    'Sliding window over recent conversation. Cheap (no LLM, no embeddings) ' +
    'and works for short-to-medium chats. Switch to summarize/topK when ' +
    'conversations grow past the window.',
  defaultInput: 'What did I just say?',
  providerSlots: ['default'],
  tags: ['memory', 'episodic', 'window', 'short-term', 'rule-based'],
};

export async function run(input: string, provider?: LLMProvider): Promise<string> {
  const store = new InMemoryStore();

  const memory = defineMemory({
    id: 'last-10',
    description: 'Keep the last 10 turns of conversation.',
    type: MEMORY_TYPES.EPISODIC,
    strategy: { kind: MEMORY_STRATEGIES.WINDOW, size: 10 },
    store,
  });

  const agent = Agent.create({
    provider: provider ?? mock({ reply: "You just asked about your previous message." }),
    model: 'mock',
    maxIterations: 1,
  })
    .system('You are a helpful assistant that remembers the last 10 turns.')
    .memory(memory)
    .build();

  // First turn — populates the store.
  const identity = { conversationId: 'window-demo' };
  await agent.run({ message: 'My name is Alice.', identity });

  // Second turn — the agent's memory subflow loads the stored window
  // before the LLM call, so the LLM sees prior turns as context.
  const result = await agent.run({ message: input, identity });
  if (typeof result !== 'string') throw new Error('Agent paused unexpectedly.');
  return result;
}

if (isCliEntry(import.meta.url)) {
  run(meta.defaultInput ?? '').then(printResult).catch(console.error);
}
