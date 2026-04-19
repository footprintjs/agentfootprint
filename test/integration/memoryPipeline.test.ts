/**
 * Integration — Agent.memoryPipeline() end-to-end.
 *
 * Proves the new memory pipeline wiring in buildAgentLoop works:
 *   1. Agent.create(...).memoryPipeline(pipeline).build()
 *   2. First turn populates the store via the write subflow
 *   3. Second turn reads from the store via the read subflow, injects
 *      `<memory>` blocks into the LLM prompt
 *   4. Mock LLM replays canned responses; test asserts on what it saw
 */
import { beforeEach, describe, expect, it } from 'vitest';
import { Agent } from '../../src/lib/concepts';
import { mock } from '../../src/adapters/mock/MockAdapter';
import { InMemoryStore } from '../../src/memory/store';
import { defaultPipeline } from '../../src/memory/pipeline';

describe('Agent.memoryPipeline() — integration', () => {
  let store: InMemoryStore;

  beforeEach(() => {
    store = new InMemoryStore();
  });

  it('turn 1 writes messages into the shared store', async () => {
    const pipeline = defaultPipeline({ store });
    const agent = Agent.create({ provider: mock([{ content: 'Hi Alice!' }]) })
      .system('You are a helpful assistant.')
      .memoryPipeline(pipeline)
      .build();

    await agent.run('My name is Alice');

    const listed = await store.list({ conversationId: 'default' });
    // User + assistant persisted by the write subflow
    expect(listed.entries.length).toBeGreaterThanOrEqual(2);

    const contents = listed.entries
      .map((e) => (typeof e.value === 'object' ? JSON.stringify(e.value) : ''))
      .join(' ');
    expect(contents).toContain('Alice');
  });

  it('turn 2 reads turn 1 from the store and injects into the LLM prompt', async () => {
    const pipeline = defaultPipeline({ store });

    // Turn 1
    const agent1 = Agent.create({ provider: mock([{ content: 'Nice to meet you, Alice.' }]) })
      .system('You remember what the user tells you.')
      .memoryPipeline(pipeline)
      .build();
    await agent1.run('My name is Alice');

    // Turn 2 — new agent sharing the same pipeline/store.
    // Use a provider we can inspect: we'll spy on what it received.
    let capturedMessages: unknown[] = [];
    const spyProvider = {
      chat: async (messages: unknown[]) => {
        capturedMessages = messages;
        return { content: 'Your name is Alice.' };
      },
    };

    const agent2 = Agent.create({ provider: spyProvider })
      .system('You remember what the user tells you.')
      .memoryPipeline(pipeline)
      .build();
    await agent2.run("What's my name?");

    // The read subflow should have injected a system message containing
    // "Alice" (from turn 1) into the LLM prompt.
    const promptStr = JSON.stringify(capturedMessages);
    expect(promptStr).toContain('Alice');
  });

  it('per-run identity scopes memory across sessions', async () => {
    const pipeline = defaultPipeline({ store });

    // Session A — writes under identity A
    const agentA = Agent.create({ provider: mock([{ content: 'Got it.' }]) })
      .memoryPipeline(pipeline)
      .build();
    await agentA.run('I am user A', {
      identity: { tenant: 'x', conversationId: 'session-A' },
    });

    // Session B — different identity must NOT see A's data
    let capturedB: unknown[] = [];
    const spyB = {
      chat: async (messages: unknown[]) => {
        capturedB = messages;
        return { content: 'Who are you?' };
      },
    };
    const agentB = Agent.create({ provider: spyB }).memoryPipeline(pipeline).build();
    await agentB.run('Who am I?', {
      identity: { tenant: 'x', conversationId: 'session-B' },
    });

    // Session B's prompt should not contain 'user A'
    expect(JSON.stringify(capturedB)).not.toContain('user A');
  });

  it('per-run identity respects tenant isolation', async () => {
    const pipeline = defaultPipeline({ store });

    const agentA = Agent.create({ provider: mock([{ content: 'got-A' }]) })
      .memoryPipeline(pipeline)
      .build();
    await agentA.run('TENANT-A-DATA', {
      identity: { tenant: 'A', conversationId: 'c1' },
    });

    let capturedB: unknown[] = [];
    const spyB = {
      chat: async (messages: unknown[]) => {
        capturedB = messages;
        return { content: 'x' };
      },
    };
    const agentB = Agent.create({ provider: spyB }).memoryPipeline(pipeline).build();
    await agentB.run('hello', {
      identity: { tenant: 'B', conversationId: 'c1' }, // same conv id, different tenant
    });

    expect(JSON.stringify(capturedB)).not.toContain('TENANT-A-DATA');
  });

  it('throws when both .memory() and .memoryPipeline() are set', () => {
    const pipeline = defaultPipeline({ store });
    expect(() => {
      Agent.create({ provider: mock([{ content: 'x' }]) })
        .memory({ store: {} as never, conversationId: 'x' })
        .memoryPipeline(pipeline)
        .build();
    }).toThrow(/cannot combine/);
  });
});
