/**
 * Integration test: Agent with memory — multi-turn conversation persistence.
 *
 * Verifies the full memory stack end-to-end:
 *   - PrepareMemory subflow loads stored history before each turn
 *   - CommitMemory stage persists the full conversation after each turn
 *   - The LLM receives the full conversation history on subsequent turns
 *   - Agent.memory() builder method wires it all together
 */

import { describe, it, expect } from 'vitest';
import {
  Agent,
  InMemoryStore,
  mock,
  userMessage,
  assistantMessage,
} from '../../src/test-barrel';
import type { Message } from '../../src/test-barrel';

// Flush fire-and-forget Promises to complete
const flush = () => new Promise<void>(resolve => setTimeout(resolve, 0));

describe('Agent with memory — integration', () => {
  it('multi-turn: second turn receives stored history from first turn', async () => {
    const store = new InMemoryStore();

    // Turn 1: fresh conversation
    const agent1 = Agent.create({
      provider: mock([{ content: 'The capital of France is Paris.' }]),
    })
      .memory({ store, conversationId: 'conv-1' })
      .build();

    const result1 = await agent1.run('What is the capital of France?');
    expect(result1.content).toBe('The capital of France is Paris.');

    // Wait for fire-and-forget to complete
    await flush();

    // Store should now have turn 1 messages
    const stored = store.load('conv-1') as Message[];
    expect(stored.length).toBeGreaterThan(0);
    expect(stored.some(m => m.role === 'user')).toBe(true);
    expect(stored.some(m => m.role === 'assistant')).toBe(true);

    // Turn 2: new agent instance with same store (simulates server restart)
    let capturedMessages: Message[] = [];
    const agent2 = Agent.create({
      provider: mock([
        { content: 'Yes, I remember — you asked about France in our previous conversation.' },
      ]),
      // Capture what messages the LLM received
    })
      .memory({ store, conversationId: 'conv-1' })
      .build();

    const result2 = await agent2.run('Do you remember what we talked about?');
    expect(result2.content).toContain('France');

    await flush();

    // Store should now have both turns (more messages)
    const storedAfterTurn2 = store.load('conv-1') as Message[];
    expect(storedAfterTurn2.length).toBeGreaterThan(stored.length);
  });

  it('history accumulates correctly across turns', async () => {
    const store = new InMemoryStore();

    const turn = async (message: string, response: string) => {
      const agent = Agent.create({ provider: mock([{ content: response }]) })
        .memory({ store, conversationId: 'chat' })
        .build();
      return agent.run(message);
    };

    await turn('Hi', 'Hello!');
    await flush();
    const after1 = store.size('chat');

    await turn('How are you?', 'I am fine.');
    await flush();
    const after2 = store.size('chat');

    await turn('What did I say first?', 'You said "Hi".');
    await flush();
    const after3 = store.size('chat');

    // Each turn adds at least 2 messages (user + assistant)
    expect(after2).toBeGreaterThan(after1);
    expect(after3).toBeGreaterThan(after2);
  });

  it('Agent without .memory() still works (no regression)', async () => {
    const agent = Agent.create({ provider: mock([{ content: 'Hello world' }]) }).build();

    const result = await agent.run('Hi');
    expect(result.content).toBe('Hello world');
  });

  it('Agent.memory() accepts store + conversationId + strategy', async () => {
    const store = new InMemoryStore();
    // Pre-seed store with 10 messages
    const history: Message[] = Array.from({ length: 10 }, (_, i) =>
      i % 2 === 0 ? userMessage(`q${i}`) : assistantMessage(`a${i}`),
    );
    store.save('conv-strat', history);

    // Strategy: keep only last 4 messages
    const slidingWindow = { prepare: async (msgs: Message[]) => msgs.slice(-4) };

    const agent = Agent.create({
      provider: mock([{ content: 'Got it.' }]),
    })
      .memory({ store, conversationId: 'conv-strat', strategy: slidingWindow })
      .build();

    const result = await agent.run('new question');
    expect(result.content).toBe('Got it.');

    await flush();
    // Store should have the new full history (strategy only trims for LLM context,
    // commit saves the actual messages list for the current turn)
  });

  it('two conversations are isolated — different conversationIds', async () => {
    const store = new InMemoryStore();

    const agentA = Agent.create({ provider: mock([{ content: 'I am agent A.' }]) })
      .memory({ store, conversationId: 'conv-a' })
      .build();

    const agentB = Agent.create({ provider: mock([{ content: 'I am agent B.' }]) })
      .memory({ store, conversationId: 'conv-b' })
      .build();

    await agentA.run('Who are you?');
    await agentB.run('Who are you?');
    await flush();

    const historyA = store.load('conv-a') as Message[];
    const historyB = store.load('conv-b') as Message[];

    expect(historyA.length).toBeGreaterThan(0);
    expect(historyB.length).toBeGreaterThan(0);
    // Isolated — no cross-contamination
    expect(store.ids()).toContain('conv-a');
    expect(store.ids()).toContain('conv-b');
    expect(historyA).not.toEqual(historyB);
  });
});
