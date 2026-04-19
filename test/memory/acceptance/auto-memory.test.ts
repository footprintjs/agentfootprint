/**
 * Acceptance — autoPipeline end-to-end.
 *
 * Proves that an agent wired with `autoPipeline()` gets BOTH
 * dedup-on-key fact memory AND append-only beat memory, recalled as
 * one combined system message in subsequent turns.
 *
 * Scenarios:
 *   1. Turn 1 writes both a fact and a beat — store has both types
 *   2. Turn 2 sees ONE combined system message with facts + narrative
 *   3. Correction overwrites the fact (dedup) while beats accumulate
 *   4. Identity isolation — tenant B does not recall tenant A data
 */
import { describe, expect, it, beforeEach } from 'vitest';
import { Agent } from '../../../src/lib/concepts';
import { autoPipeline, InMemoryStore, factId, isNarrativeBeat } from '../../../src/memory.barrel';
import type { Fact } from '../../../src/memory.barrel';
import type { Message, LLMResponse } from '../../../src/types';

function spyProvider(responses: LLMResponse[]) {
  const calls: Message[][] = [];
  let i = 0;
  return {
    chat: async (messages: Message[]) => {
      calls.push([...messages]);
      return responses[Math.min(i++, responses.length - 1)];
    },
    calls,
  };
}

let store: InMemoryStore;
beforeEach(() => {
  store = new InMemoryStore();
});

describe('Acceptance — autoPipeline', () => {
  it('turn 1 writes both a fact and a beat to the same store', async () => {
    const pipeline = autoPipeline({ store });
    const p1 = spyProvider([{ content: 'Nice to meet you, Alice!' }]);

    const agent = Agent.create({ provider: p1 })
      .system('You remember the user.')
      .memoryPipeline(pipeline)
      .build();

    await agent.run('my name is Alice.', {
      identity: { conversationId: 'alice-session' },
      turnNumber: 1,
    });

    // Facts: stable id
    const nameFact = await store.get<Fact>(
      { conversationId: 'alice-session' },
      factId('user.name'),
    );
    expect(nameFact?.value.value).toBe('Alice');

    // Beats: at least one beat entry exists
    const { entries } = await store.list({ conversationId: 'alice-session' }, { limit: 100 });
    const beatCount = entries.filter((e) => isNarrativeBeat(e.value)).length;
    expect(beatCount).toBeGreaterThan(0);
  });

  it('turn 2 sees ONE combined system message with BOTH facts block + narrative', async () => {
    const pipeline = autoPipeline({ store });

    // Turn 1
    await Agent.create({ provider: spyProvider([{ content: 'ack' }]) })
      .memoryPipeline(pipeline)
      .build()
      .run('my name is Alice.', {
        identity: { conversationId: 'alice-session' },
        turnNumber: 1,
      });

    // Turn 2
    const p2 = spyProvider([{ content: 'ok' }]);
    await Agent.create({ provider: p2 })
      .memoryPipeline(pipeline)
      .build()
      .run("what's my name?", {
        identity: { conversationId: 'alice-session' },
        turnNumber: 2,
      });

    // Exactly ONE system message for auto memory (not two separate)
    const memoryMessages = p2.calls[0].filter(
      (m) =>
        m.role === 'system' &&
        typeof m.content === 'string' &&
        (m.content.includes('Known facts about the user') || m.content.includes('From earlier:')),
    );
    expect(memoryMessages).toHaveLength(1);
    const content = memoryMessages[0].content as string;
    expect(content).toContain('Known facts about the user');
    expect(content).toContain('user.name');
    expect(content).toContain('Alice');
    expect(content).toContain('From earlier:');
  });

  it('correction overwrites the fact; beats accumulate', async () => {
    const pipeline = autoPipeline({ store });

    await Agent.create({ provider: spyProvider([{ content: 'ok' }]) })
      .memoryPipeline(pipeline)
      .build()
      .run('my name is Alice.', {
        identity: { conversationId: 'alice-session' },
        turnNumber: 1,
      });

    await Agent.create({ provider: spyProvider([{ content: 'ok' }]) })
      .memoryPipeline(pipeline)
      .build()
      .run('actually, my name is Alicia.', {
        identity: { conversationId: 'alice-session' },
        turnNumber: 2,
      });

    const { entries } = await store.list<Fact>({ conversationId: 'alice-session' }, { limit: 100 });
    // Facts: exactly one user.name entry, overwritten
    const nameEntries = entries.filter((e) => e.id === factId('user.name'));
    expect(nameEntries).toHaveLength(1);
    expect(nameEntries[0].value.value).toBe('Alicia');

    // Beats: two turns worth — append-only growth
    const beatCount = entries.filter((e) => e.id.startsWith('beat-')).length;
    expect(beatCount).toBeGreaterThanOrEqual(2);
  });

  it('identity isolation — tenant B does not see tenant A data', async () => {
    const pipeline = autoPipeline({ store });

    await Agent.create({ provider: spyProvider([{ content: 'ok' }]) })
      .memoryPipeline(pipeline)
      .build()
      .run('my name is Alice.', {
        identity: { tenant: 'A', conversationId: 'c' },
        turnNumber: 1,
      });

    const pB = spyProvider([{ content: 'I do not know.' }]);
    await Agent.create({ provider: pB })
      .memoryPipeline(pipeline)
      .build()
      .run("what's my name?", {
        identity: { tenant: 'B', conversationId: 'c' },
        turnNumber: 1,
      });

    const promptStr = JSON.stringify(pB.calls[0]);
    expect(promptStr).not.toContain('Alice');
  });
});
