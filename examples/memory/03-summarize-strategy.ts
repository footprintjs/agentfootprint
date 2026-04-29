/**
 * 03 — Summarize strategy: LLM compresses older turns when conversation grows.
 *
 * The "Context Janitor" pattern from Ch 7 of AI Agents: The Definitive Guide.
 * Recent N turns stay raw; older turns are LLM-summarized into a paragraph
 * before injection. Pairs with a cheap summarizer model (haiku-class).
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
  id: 'memory/03-summarize-strategy',
  title: 'Summarize strategy — LLM compresses older turns',
  group: 'memory',
  description:
    'Long-conversation compaction: keep recent N turns raw, summarize ' +
    'older turns with a cheap LLM. Use when conversations grow past the ' +
    'comfortable window size.',
  defaultInput: 'What were the main topics we covered today?',
  providerSlots: ['default'],
  tags: ['memory', 'episodic', 'summarize', 'long-conversation', 'smart'],
};

export async function run(input: string, provider?: LLMProvider): Promise<string> {
  const store = new InMemoryStore();

  // Cheap summarizer model — typically a haiku-class LLM. Real
  // deployments pass `anthropic('claude-haiku-4-5')` or equivalent.
  const summarizer = mock({ reply: 'User discussed billing, email update, and refund.' });

  const memory = defineMemory({
    id: 'long-chat',
    type: MEMORY_TYPES.EPISODIC,
    strategy: {
      kind: MEMORY_STRATEGIES.SUMMARIZE,
      recent: 6,        // keep last 6 turns raw, summarize older
      llm: summarizer,  // dedicated cheap model for compression
    },
    store,
  });

  const agent = Agent.create({
    provider: provider ?? mock({ reply: 'We covered billing, email, and refund topics.' }),
    model: 'mock',
    maxIterations: 1,
  })
    .system('You are a helpful assistant who remembers long conversations.')
    .memory(memory)
    .build();

  const identity = { conversationId: 'long-chat-demo' };
  // Simulate a multi-turn conversation that exceeds the recent window.
  await agent.run({ message: 'I want to update my billing info.', identity });
  await agent.run({ message: 'And my email address too.', identity });
  await agent.run({ message: 'Can I get a refund for last month?', identity });
  const result = await agent.run({ message: input, identity });
  if (typeof result !== 'string') throw new Error('Agent paused unexpectedly.');
  return result;
}

if (isCliEntry(import.meta.url)) {
  run(meta.defaultInput ?? '').then(printResult).catch(console.error);
}
