/**
 * Agent remembers information across turns — the memory pipeline pattern.
 *
 * Pattern:
 *   1. Build a memory pipeline from a preset + in-memory store.
 *   2. Attach via `.memoryPipeline()` on the agent builder.
 *   3. Pass `identity` per run so the same agent can serve many sessions.
 *
 * Uses the `mock` adapter so the example runs with no network / keys.
 *
 * Run: npx tsx examples/memory/30-remember-across-turns.ts
 */

import { Agent, mock } from 'agentfootprint';
import { defaultPipeline, InMemoryStore } from 'agentfootprint/memory';

async function main() {
  // Shared store + pipeline — built ONCE at application startup.
  const store = new InMemoryStore();
  const pipeline = defaultPipeline({ store });

  // Turn 1 — user introduces themselves.
  const turn1 = Agent.create({
    provider: mock([{ content: 'Nice to meet you, Alice!' }]),
  })
    .system('You remember what the user tells you.')
    .memoryPipeline(pipeline)
    .build();

  const r1 = await turn1.run('My name is Alice and I live in San Francisco.', {
    identity: { conversationId: 'alice-chat' },
  });
  console.log('Turn 1:', r1.content);

  // Turn 2 — asks something that requires memory of turn 1.
  // A real LLM would answer using the injected memory; the mock here
  // just replays a canned response, but the prompt it received contained
  // Alice's info from the store (check the narrative to see).
  const turn2 = Agent.create({
    provider: mock([{ content: 'You live in San Francisco, Alice.' }]),
  })
    .system('You remember what the user tells you.')
    .memoryPipeline(pipeline)
    .build();

  const r2 = await turn2.run('Where do I live?', {
    identity: { conversationId: 'alice-chat' },
    turnNumber: 2,
  });
  console.log('Turn 2:', r2.content);

  // Different session, same agent — memory isolated by identity.
  const turn3 = Agent.create({
    provider: mock([{ content: "I don't know yet." }]),
  })
    .system('You remember what the user tells you.')
    .memoryPipeline(pipeline)
    .build();

  const r3 = await turn3.run('Where do I live?', {
    identity: { conversationId: 'bob-chat' }, // different conversation
  });
  console.log('Turn 3 (new session):', r3.content);

  // Inspect: the store has Alice's messages but nothing for Bob.
  const aliceEntries = await store.list({ conversationId: 'alice-chat' });
  const bobEntries = await store.list({ conversationId: 'bob-chat' });
  console.log(
    `\nStore state: ${aliceEntries.entries.length} entries for Alice, ${bobEntries.entries.length} for Bob`,
  );
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
