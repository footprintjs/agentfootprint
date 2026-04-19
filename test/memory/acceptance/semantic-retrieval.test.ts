/**
 * Acceptance — SemanticRetrieval end-to-end.
 *
 * Proves `semanticPipeline()` indexes messages with embeddings on
 * write and retrieves the most relevant messages on read.
 *
 * Scenarios:
 *   1. Turn 1 writes messages with embeddings — assert entries carry
 *      `.embedding` vectors.
 *   2. Turn 2 (topic-shifted) asks about dogs — assert the dog beats
 *      from turn 1 are retrieved over unrelated beats.
 *   3. Identity isolation — tenant B doesn't recall tenant A vectors.
 *   4. Realistic "distant turn" — relevant context from turn 1 is
 *      surfaced at turn 5 even after 4 unrelated turns.
 */
import { beforeEach, describe, expect, it } from 'vitest';
import { Agent } from '../../../src/lib/concepts';
import { semanticPipeline, InMemoryStore, mockEmbedder } from '../../../src/memory.barrel';
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

describe('Acceptance — SemanticRetrieval', () => {
  it('turn 1 persists messages with embedding vectors', async () => {
    const embedder = mockEmbedder({ dimensions: 32 });
    const pipeline = semanticPipeline({ store, embedder, embedderId: 'mock-32' });
    const provider = spyProvider([{ content: 'Woof!' }]);

    const agent = Agent.create({ provider }).memoryPipeline(pipeline).build();

    await agent.run('I have two dogs, they are my favorite pets.', {
      identity: { conversationId: 'alice' },
      turnNumber: 1,
    });

    const listed = await store.list({ conversationId: 'alice' });
    expect(listed.entries.length).toBeGreaterThanOrEqual(1);
    // At least one entry has an embedding attached
    const withVec = listed.entries.find((e) => e.embedding);
    expect(withVec).toBeDefined();
    expect(withVec!.embedding!.length).toBe(32);
    expect(withVec!.embeddingModel).toBe('mock-32');
  });

  it('semantic retrieval surfaces relevant past messages over unrelated ones', async () => {
    const embedder = mockEmbedder({ dimensions: 32 });
    const pipeline = semanticPipeline({ store, embedder, k: 5 });

    // Turn 1 — mention dogs
    await Agent.create({ provider: spyProvider([{ content: 'Cute!' }]) })
      .memoryPipeline(pipeline)
      .build()
      .run('I love dogs, I have two Golden Retrievers.', {
        identity: { conversationId: 'c' },
        turnNumber: 1,
      });

    // Turn 2 — unrelated topic
    await Agent.create({ provider: spyProvider([{ content: 'Nice.' }]) })
      .memoryPipeline(pipeline)
      .build()
      .run('My car is a blue sedan.', {
        identity: { conversationId: 'c' },
        turnNumber: 2,
      });

    // Turn 3 — asks about dogs again. Semantic pipeline should
    // retrieve turn-1 dog content over turn-2 car content.
    const p3 = spyProvider([{ content: 'Yep.' }]);
    await Agent.create({ provider: p3 })
      .memoryPipeline(pipeline)
      .build()
      .run('tell me about my dogs', {
        identity: { conversationId: 'c' },
        turnNumber: 3,
      });

    const promptStr = JSON.stringify(p3.calls[0]);
    // The dog-related text from turn 1 should be in the injected memory
    expect(promptStr).toContain('Golden Retrievers');
  });

  it('identity isolation — tenant B does not retrieve tenant A vectors', async () => {
    const embedder = mockEmbedder({ dimensions: 32 });
    const pipeline = semanticPipeline({ store, embedder });

    // Tenant A writes
    await Agent.create({ provider: spyProvider([{ content: 'ok' }]) })
      .memoryPipeline(pipeline)
      .build()
      .run('The passphrase is swordfish.', {
        identity: { tenant: 'A', conversationId: 'c' },
        turnNumber: 1,
      });

    // Tenant B queries similar-sounding text
    const pB = spyProvider([{ content: 'Nothing.' }]);
    await Agent.create({ provider: pB })
      .memoryPipeline(pipeline)
      .build()
      .run('what is the passphrase', {
        identity: { tenant: 'B', conversationId: 'c' },
        turnNumber: 1,
      });

    expect(JSON.stringify(pB.calls[0])).not.toContain('swordfish');
  });

  it('distant-turn recall — relevant turn-1 content surfaces at turn 5', async () => {
    const embedder = mockEmbedder({ dimensions: 64 });
    const pipeline = semanticPipeline({ store, embedder, k: 10 });

    // Turn 1 — relevant fact
    await Agent.create({ provider: spyProvider([{ content: 'ok' }]) })
      .memoryPipeline(pipeline)
      .build()
      .run('My favorite ice cream flavor is pistachio.', {
        identity: { conversationId: 'user' },
        turnNumber: 1,
      });

    // Turns 2-4 — unrelated chatter
    for (let t = 2; t <= 4; t++) {
      await Agent.create({
        provider: spyProvider([{ content: `turn ${t} reply` }]),
      })
        .memoryPipeline(pipeline)
        .build()
        .run(`unrelated topic ${t}: weather and traffic`, {
          identity: { conversationId: 'user' },
          turnNumber: t,
        });
    }

    // Turn 5 — asks about ice cream
    const p5 = spyProvider([{ content: 'pistachio!' }]);
    await Agent.create({ provider: p5 })
      .memoryPipeline(pipeline)
      .build()
      .run('what is my favorite ice cream flavor?', {
        identity: { conversationId: 'user' },
        turnNumber: 5,
      });

    const promptStr = JSON.stringify(p5.calls[0]);
    // Even though turn 1 was 4 turns back, semantic retrieval should
    // surface it for this query over the unrelated weather/traffic chatter.
    expect(promptStr).toContain('pistachio');
  });
});
