/**
 * Acceptance — NarrativeMemory end-to-end.
 *
 * Proves that an agent wired with `narrativePipeline()` compresses a
 * turn's messages into beats on write, recalls them across turns via
 * the story-paragraph formatter, and that the LLM sees the beats in
 * its prompt.
 *
 * Scenarios:
 *   1. Alice turn 1 writes a beat (identity) — assert the store has it
 *   2. Turn 2 reads back the beat — assert the LLM prompt contains
 *      "User said: My name is Alice" (the heuristic extractor's beat)
 *   3. LLM sees a PARAGRAPH, not per-entry `<memory>` blocks (contrast
 *      with defaultPipeline — proves narrative format)
 *   4. Identity isolation — tenant B does not recall tenant A's beats
 */
import { describe, expect, it, beforeEach } from 'vitest';
import { Agent } from '../../../src/lib/concepts';
import { narrativePipeline, InMemoryStore, heuristicExtractor } from '../../../src/memory.barrel';
import type { Message, LLMResponse } from '../../../src/types';

/**
 * Spy provider — captures every chat() call's messages so we can
 * assert what the LLM saw in each turn.
 */
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

describe('Acceptance — NarrativeMemory', () => {
  it('turn 1 extracts a beat and persists it', async () => {
    const pipeline = narrativePipeline({
      store,
      extractor: heuristicExtractor(),
    });
    const provider = spyProvider([{ content: 'Nice to meet you, Alice!' }]);

    const agent = Agent.create({ provider })
      .system('You remember users across sessions.')
      .memoryPipeline(pipeline)
      .build();

    await agent.run('My name is Alice.', {
      identity: { conversationId: 'alice-session' },
    });

    const listed = await store.list({ conversationId: 'alice-session' });
    // Two beats written: one for user message, one for assistant reply
    expect(listed.entries.length).toBeGreaterThanOrEqual(1);

    // At least one beat has the identity category (high importance)
    const identityBeat = listed.entries.find(
      (e) => (e.value as { category?: string }).category === 'identity',
    );
    expect(identityBeat).toBeDefined();
    const summary = (identityBeat!.value as { summary: string }).summary;
    expect(summary).toContain('Alice');
  });

  it('turn 2 recalls the beat via story paragraph — LLM sees "Alice" in prompt', async () => {
    const pipeline = narrativePipeline({ store });

    // Turn 1
    const p1 = spyProvider([{ content: 'Nice to meet you, Alice!' }]);
    const agent1 = Agent.create({ provider: p1 })
      .system('You remember users.')
      .memoryPipeline(pipeline)
      .build();
    await agent1.run('My name is Alice.', {
      identity: { conversationId: 'alice-session' },
    });

    // Turn 2 — new agent, same pipeline
    const p2 = spyProvider([{ content: 'Your name is Alice.' }]);
    const agent2 = Agent.create({ provider: p2 })
      .system('You remember users.')
      .memoryPipeline(pipeline)
      .build();
    await agent2.run("What's my name?", {
      identity: { conversationId: 'alice-session' },
    });

    // Inspect turn-2's LLM prompt — should contain "Alice" injected via
    // the narrative memory system message
    const turn2Prompt = JSON.stringify(p2.calls[0]);
    expect(turn2Prompt).toContain('Alice');
  });

  it('recall is a STORY paragraph (not per-entry <memory> blocks)', async () => {
    const pipeline = narrativePipeline({ store });

    // Seed two turns with explicit turnNumber so beat ids don't
    // collide. (Default turnNumber is 1 — the caller is responsible
    // for incrementing per-run; the memory pipeline writes
    // `beat-{turn}-{index}` and same turn = same ids = overwrite.)
    const p1 = spyProvider([{ content: 'Ack.' }]);
    await Agent.create({ provider: p1 })
      .memoryPipeline(pipeline)
      .build()
      .run('My name is Alice.', {
        identity: { conversationId: 'alice-session' },
        turnNumber: 1,
      });

    const p2 = spyProvider([{ content: 'Sure.' }]);
    await Agent.create({ provider: p2 })
      .memoryPipeline(pipeline)
      .build()
      .run('I like blue.', {
        identity: { conversationId: 'alice-session' },
        turnNumber: 2,
      });

    // Turn 3 should see BOTH beats in a single paragraph
    const p3 = spyProvider([{ content: 'Ok.' }]);
    await Agent.create({ provider: p3 })
      .memoryPipeline(pipeline)
      .build()
      .run('remind me', {
        identity: { conversationId: 'alice-session' },
        turnNumber: 3,
      });

    const messages = p3.calls[0];
    // The injected memory should be a system message with "From earlier:" prefix
    const memoryMsg = messages.find(
      (m) =>
        m.role === 'system' && typeof m.content === 'string' && m.content.includes('From earlier:'),
    );
    expect(memoryMsg).toBeDefined();
    const content = memoryMsg!.content as string;

    // Cohesive paragraph format — NOT `<memory>` tags
    expect(content).not.toContain('<memory ');

    // Both beats present
    expect(content).toContain('Alice');
    expect(content).toContain('blue');
  });

  it('identity isolation — tenant B does not recall tenant A beats', async () => {
    const pipeline = narrativePipeline({ store });

    // Tenant A writes
    await Agent.create({ provider: spyProvider([{ content: 'ok' }]) })
      .memoryPipeline(pipeline)
      .build()
      .run('The passphrase is swordfish.', {
        identity: { tenant: 'A', conversationId: 'c' },
      });

    // Tenant B should NOT see "swordfish" in its prompt
    const pB = spyProvider([{ content: 'Nothing yet.' }]);
    await Agent.create({ provider: pB })
      .memoryPipeline(pipeline)
      .build()
      .run('What did I tell you?', {
        identity: { tenant: 'B', conversationId: 'c' },
      });

    const promptStr = JSON.stringify(pB.calls[0]);
    expect(promptStr).not.toContain('swordfish');
  });
});
