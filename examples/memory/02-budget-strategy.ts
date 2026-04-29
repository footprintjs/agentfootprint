/**
 * 02 — Budget strategy: pick by token budget instead of entry count.
 *
 * Where Window caps by NUMBER of entries, Budget caps by TOTAL TOKENS.
 * Pairs a budget decider with skip-empty / skip-no-budget branches so
 * the narrative records WHY memory was (or wasn't) injected.
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
  id: 'memory/02-budget-strategy',
  title: 'Budget strategy — fit-to-tokens (decider-based)',
  group: 'memory',
  description:
    'Token-aware memory selection. Picks the most-recent entries that ' +
    'fit within reserveTokens budget; skips injection entirely below ' +
    'minimumTokens. Decider records the choice in narrative.',
  defaultInput: 'Summarize what we discussed.',
  providerSlots: ['default'],
  tags: ['memory', 'episodic', 'budget', 'decider', 'token-aware'],
};

export async function run(input: string, provider?: LLMProvider): Promise<string> {
  const store = new InMemoryStore();

  const memory = defineMemory({
    id: 'budgeted',
    type: MEMORY_TYPES.EPISODIC,
    strategy: {
      kind: MEMORY_STRATEGIES.BUDGET,
      reserveTokens: 512,   // reserve for prompt headers + new user message
      minimumTokens: 100,   // skip injection below this floor
      maxEntries: 20,       // hard cap (lost-in-the-middle defense)
    },
    store,
  });

  const agent = Agent.create({
    provider: provider ?? mock({ reply: 'We talked about your account.' }),
    model: 'mock',
    maxIterations: 1,
  })
    .system('You are a helpful assistant.')
    .memory(memory)
    .build();

  const identity = { conversationId: 'budget-demo' };
  await agent.run({ message: 'I want to update my billing info.', identity });
  await agent.run({ message: 'And my email address too.', identity });
  const result = await agent.run({ message: input, identity });
  if (typeof result !== 'string') throw new Error('Agent paused unexpectedly.');
  return result;
}

if (isCliEntry(import.meta.url)) {
  run(meta.defaultInput ?? '').then(printResult).catch(console.error);
}
