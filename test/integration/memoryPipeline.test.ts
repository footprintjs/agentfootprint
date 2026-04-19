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

  it('memory-read runs exactly once per turn — not once per ReAct iteration', async () => {
    // Regression for P1: memory-read used to be mounted after sf-tools, so
    // Dynamic ReAct's loopTo → sf-system-prompt / sf-instructions-to-llm
    // re-ran memory-read every iteration. Now it's mounted before the loop
    // body and runs exactly once per .run() call.
    let listCallCount = 0;
    const countingStore = new (class extends InMemoryStore {
      async list(...args: Parameters<InMemoryStore['list']>) {
        listCallCount++;
        return super.list(...args);
      }
    })();

    const pipeline = defaultPipeline({ store: countingStore });

    const adder = {
      id: 'add',
      name: 'add',
      description: 'Add',
      parameters: {
        type: 'object',
        properties: { a: { type: 'number' }, b: { type: 'number' } },
        required: ['a', 'b'],
      },
      handler: async (a: { a: number; b: number }) => ({ content: String(a.a + a.b) }),
    };

    const provider = mock([
      {
        content: 'calling add',
        toolCalls: [{ id: 'c1', name: 'add', arguments: { a: 1, b: 1 } }],
      },
      { content: 'Answer: 2.' },
    ]);

    const agent = Agent.create({ provider }).tool(adder).memoryPipeline(pipeline).build();

    await agent.run('1+1', { identity: { conversationId: 'conv-1' } });

    // One store.list per turn. The tool-call iteration did NOT trigger a
    // second read, proving memory-read is outside the loop body.
    expect(listCallCount).toBe(1);
  });

  it('tool-call loop iterates past the first turn — no premature break from the write mount', async () => {
    // Regression for P0: BreakAfterSave used to $break() on EVERY iteration,
    // which terminated the loop before tool results reached the LLM.
    const pipeline = defaultPipeline({ store });

    const adder = {
      id: 'add',
      name: 'add',
      description: 'Add two numbers',
      parameters: {
        type: 'object',
        properties: { a: { type: 'number' }, b: { type: 'number' } },
        required: ['a', 'b'],
      },
      handler: async (args: { a: number; b: number }) => ({
        content: String(args.a + args.b),
      }),
    };

    const provider = mock([
      {
        content: 'Using the add tool.',
        toolCalls: [{ id: 'c1', name: 'add', arguments: { a: 2, b: 3 } }],
      },
      { content: 'The answer is 5.' },
    ]);

    const agent = Agent.create({ provider })
      .system('You are a calculator.')
      .tool(adder)
      .memoryPipeline(pipeline)
      .build();

    const result = await agent.run('What is 2 + 3?', {
      identity: { conversationId: 'calc-session' },
    });

    // The LLM must have been called twice — once to request the tool, once
    // to consume the result. If the loop had broken after iteration 1, the
    // second call never would have happened.
    expect(provider.getCallCount()).toBe(2);
    expect(result.content).toContain('5');

    // Store has the full conversation: user + assistant(tool-call) +
    // tool-result + assistant(final). If premature writes were happening
    // per-iteration they'd still hit the same `msg-{turn}-{idx}` keys, so
    // the more telling signal is getCallCount above — the write store is
    // just a sanity check that the final turn landed.
    const listed = await store.list({ conversationId: 'calc-session' });
    expect(listed.entries.length).toBeGreaterThanOrEqual(3);
  });
});
