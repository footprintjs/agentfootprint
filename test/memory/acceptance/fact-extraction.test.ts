/**
 * Acceptance — FactExtraction end-to-end.
 *
 * Proves that an agent wired with `factPipeline()` distills user
 * self-disclosures into stable Fact entries on write, recalls them as
 * a key/value block on read, and that updates overwrite rather than
 * accumulate.
 *
 * Scenarios:
 *   1. Turn 1: "my name is Alice" → one stored fact with id fact:user.name
 *   2. Turn 2: the LLM prompt includes the "Known facts" block with user.name = Alice
 *   3. Correction ("actually Alicia") → fact:user.name is overwritten, not duplicated
 *   4. Identity isolation — tenant B does not recall tenant A's facts
 */
import { describe, expect, it, beforeEach } from 'vitest';
import { Agent } from '../../../src/lib/concepts';
import {
  factPipeline,
  InMemoryStore,
  factId,
  patternFactExtractor,
} from '../../../src/memory.barrel';
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

describe('Acceptance — FactExtraction', () => {
  it('turn 1 extracts a fact and persists it under fact:user.name', async () => {
    const pipeline = factPipeline({
      store,
      extractor: patternFactExtractor(),
    });
    const provider = spyProvider([{ content: 'Nice to meet you, Alice!' }]);

    const agent = Agent.create({ provider })
      .system('You remember facts about the user.')
      .memoryPipeline(pipeline)
      .build();

    await agent.run('my name is Alice.', {
      identity: { conversationId: 'alice-session' },
      turnNumber: 1,
    });

    const fact = await store.get<Fact>({ conversationId: 'alice-session' }, factId('user.name'));
    expect(fact).not.toBeNull();
    expect(fact!.value.key).toBe('user.name');
    expect(fact!.value.value).toBe('Alice');
  });

  it('turn 2 recalls the fact via the Known-facts system block', async () => {
    const pipeline = factPipeline({ store, extractor: patternFactExtractor() });

    // Turn 1: establish the fact.
    const p1 = spyProvider([{ content: 'Nice to meet you, Alice!' }]);
    await Agent.create({ provider: p1 })
      .memoryPipeline(pipeline)
      .build()
      .run('my name is Alice.', {
        identity: { conversationId: 'alice-session' },
        turnNumber: 1,
      });

    // Turn 2: new agent, same pipeline.
    const p2 = spyProvider([{ content: 'Your name is Alice.' }]);
    await Agent.create({ provider: p2 })
      .memoryPipeline(pipeline)
      .build()
      .run("what's my name?", {
        identity: { conversationId: 'alice-session' },
        turnNumber: 2,
      });

    const turn2Messages = p2.calls[0];
    const factsBlock = turn2Messages.find(
      (m) =>
        m.role === 'system' &&
        typeof m.content === 'string' &&
        m.content.includes('Known facts about the user'),
    );
    expect(factsBlock).toBeDefined();
    const content = factsBlock!.content as string;
    expect(content).toContain('user.name');
    expect(content).toContain('Alice');
  });

  it('correction overwrites the fact — no duplicate entries accumulate', async () => {
    const pipeline = factPipeline({ store, extractor: patternFactExtractor() });

    // Turn 1
    await Agent.create({ provider: spyProvider([{ content: 'ack' }]) })
      .memoryPipeline(pipeline)
      .build()
      .run('my name is Alice.', {
        identity: { conversationId: 'alice-session' },
        turnNumber: 1,
      });

    // Turn 2 — correction
    await Agent.create({ provider: spyProvider([{ content: 'ack' }]) })
      .memoryPipeline(pipeline)
      .build()
      .run('actually, my name is Alicia.', {
        identity: { conversationId: 'alice-session' },
        turnNumber: 2,
      });

    const { entries } = await store.list<Fact>({ conversationId: 'alice-session' }, { limit: 100 });
    const nameEntries = entries.filter((e) => e.id === factId('user.name'));
    expect(nameEntries).toHaveLength(1);
    expect(nameEntries[0].value.value).toBe('Alicia');
  });

  it('identity isolation — tenant B does not recall tenant A facts', async () => {
    const pipeline = factPipeline({ store, extractor: patternFactExtractor() });

    // Tenant A establishes a fact
    await Agent.create({ provider: spyProvider([{ content: 'ok' }]) })
      .memoryPipeline(pipeline)
      .build()
      .run('my name is Alice.', {
        identity: { tenant: 'A', conversationId: 'c' },
        turnNumber: 1,
      });

    // Tenant B should NOT see "Alice" in its prompt
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
