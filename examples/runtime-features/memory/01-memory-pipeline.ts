/**
 * Memory pipeline — built ONCE at application startup, used by many
 * agents. Different sessions identified by `identity.conversationId`
 * stay isolated from each other.
 */

import { Agent, mock } from 'agentfootprint';
import { defaultPipeline, InMemoryStore } from 'agentfootprint/memory';
import type { LLMProvider } from 'agentfootprint';
import { isCliEntry, printResult, type ExampleMeta } from '../../helpers/cli';

export const meta: ExampleMeta = {
  id: 'runtime-features/memory/01-memory-pipeline',
  title: 'MemoryPipeline — shared across sessions',
  group: 'runtime-features',
  description: 'One pipeline + store at startup; per-run identity isolates sessions.',
  defaultInput: '',
  providerSlots: ['default'],
  tags: ['memory', 'pipeline', 'multi-session'],
};

export async function run(_input: string, _provider?: LLMProvider) {
  const store = new InMemoryStore();
  const pipeline = defaultPipeline({ store });

  const turn1 = Agent.create({ provider: mock([{ content: 'Nice to meet you, Alice!' }]) })
    .system('You remember what the user tells you.')
    .memoryPipeline(pipeline)
    .build();

  const r1 = await turn1.run('My name is Alice and I live in San Francisco.', {
    identity: { conversationId: 'alice-chat' },
  });

  const turn2 = Agent.create({ provider: mock([{ content: 'You live in San Francisco, Alice.' }]) })
    .system('You remember what the user tells you.')
    .memoryPipeline(pipeline)
    .build();

  const r2 = await turn2.run('Where do I live?', {
    identity: { conversationId: 'alice-chat' },
    turnNumber: 2,
  });

  const turn3 = Agent.create({ provider: mock([{ content: "I don't know yet." }]) })
    .system('You remember what the user tells you.')
    .memoryPipeline(pipeline)
    .build();

  const r3 = await turn3.run('Where do I live?', {
    identity: { conversationId: 'bob-chat' },
  });

  const aliceEntries = await store.list({ conversationId: 'alice-chat' });
  const bobEntries = await store.list({ conversationId: 'bob-chat' });

  return {
    alice: { turn1: r1.content, turn2: r2.content, entries: aliceEntries.entries.length },
    bob: { turn1: r3.content, entries: bobEntries.entries.length },
  };
}

if (isCliEntry(import.meta.url)) {
  run(meta.defaultInput as string)
    .then(printResult)
    .catch((e) => {
      console.error(e);
      process.exit(1);
    });
}
