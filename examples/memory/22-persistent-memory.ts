/**
 * Sample 22: Persistent Memory
 *
 * Multi-turn agent — PrepareMemory/CommitMemory visible in narrative.
 * Swap InMemoryStore for RedisStore/PostgresStore in production.
 */
import { Agent, InMemoryStore, mock } from 'agentfootprint';

export async function run(_input: string) {
  const store = new InMemoryStore();

  // Turn 1: fresh conversation
  const agent1 = Agent.create({
    provider: mock([{ content: "Nice to meet you, Alice! I'll remember your name." }]),
  })
    .system('You are a helpful assistant with persistent memory.')
    .memory({ store, conversationId: 'demo-conv' })
    .build();

  const turn1 = await agent1.run('Hi! My name is Alice.');

  // Turn 2: new agent instance, same store — simulates server restart
  const agent2 = Agent.create({
    provider: mock([{ content: 'Your name is Alice — you told me in our first message.' }]),
  })
    .system('You are a helpful assistant with persistent memory.')
    .memory({ store, conversationId: 'demo-conv' })
    .build();

  const turn2 = await agent2.run('Do you remember my name?');

  return {
    turn1: turn1.content,
    turn2: turn2.content,
    finalStoreSize: store.size('demo-conv'),
  };
}

if (process.argv[1] === import.meta.filename) {
  run('').then(console.log);
}
