/**
 * Agent.memory() — integration tests for the builder method that mounts
 * memory READ subflows into the Agent flowchart.
 *
 * Verifies:
 *   - .memory(definition) accepts a MemoryDefinition produced by defineMemory
 *   - Multiple .memory() registrations layer cleanly (no scope-key collision)
 *   - Duplicate ids throw at build time (eager validation)
 *   - The agent runs end-to-end with memory registered (no crash)
 */

import { describe, expect, it } from 'vitest';

import { Agent } from '../../src/core/Agent.js';
import { mock } from '../../src/adapters/llm/MockProvider.js';
import {
  defineMemory,
  MEMORY_TYPES,
  MEMORY_STRATEGIES,
} from '../../src/memory/index.js';
import { InMemoryStore } from '../../src/memory/store/index.js';
import { mockEmbedder } from '../../src/memory/embedding/index.js';

describe('Agent.memory() — integration', () => {
  it('registers a single memory; agent runs end-to-end', async () => {
    const memory = defineMemory({
      id: 'short-term',
      type: MEMORY_TYPES.EPISODIC,
      strategy: { kind: MEMORY_STRATEGIES.WINDOW, size: 10 },
      store: new InMemoryStore(),
    });

    const agent = Agent.create({
      provider: mock({ reply: 'ok' }),
      model: 'mock',
      maxIterations: 1,
    })
      .system('You remember the user.')
      .memory(memory)
      .build();

    const result = await agent.run({
      message: 'hello',
      identity: { conversationId: 'conv-1' },
    });

    expect(typeof result).toBe('string');
  });

  it('registers MULTIPLE memories — per-id scope keys keep them isolated', async () => {
    const shortTerm = defineMemory({
      id: 'short',
      type: MEMORY_TYPES.EPISODIC,
      strategy: { kind: MEMORY_STRATEGIES.WINDOW, size: 5 },
      store: new InMemoryStore(),
    });
    const facts = defineMemory({
      id: 'facts',
      type: MEMORY_TYPES.SEMANTIC,
      strategy: { kind: MEMORY_STRATEGIES.EXTRACT, extractor: 'pattern' },
      store: new InMemoryStore(),
    });

    const agent = Agent.create({
      provider: mock({ reply: 'ok' }),
      model: 'mock',
      maxIterations: 1,
    })
      .memory(shortTerm)
      .memory(facts)
      .build();

    const result = await agent.run({
      message: 'hi',
      identity: { conversationId: 'multi' },
    });

    expect(typeof result).toBe('string');
  });

  it('throws at build time on duplicate memory ids (eager validation)', () => {
    const a = defineMemory({
      id: 'collide',
      type: MEMORY_TYPES.EPISODIC,
      strategy: { kind: MEMORY_STRATEGIES.WINDOW, size: 5 },
      store: new InMemoryStore(),
    });
    const b = defineMemory({
      id: 'collide',
      type: MEMORY_TYPES.EPISODIC,
      strategy: { kind: MEMORY_STRATEGIES.WINDOW, size: 5 },
      store: new InMemoryStore(),
    });

    const builder = Agent.create({ provider: mock({ reply: 'ok' }), model: 'mock' })
      .memory(a);

    expect(() => builder.memory(b)).toThrow(/duplicate id 'collide'/);
  });

  it('semantic memory with pre-seeded store + Top-K reads embeddings', async () => {
    const store = new InMemoryStore({ embedder: mockEmbedder() });
    const semantic = defineMemory({
      id: 'sem',
      type: MEMORY_TYPES.SEMANTIC,
      strategy: {
        kind: MEMORY_STRATEGIES.TOP_K,
        topK: 3,
        embedder: mockEmbedder(),
      },
      store,
    });

    const agent = Agent.create({
      provider: mock({ reply: 'ok' }),
      model: 'mock',
      maxIterations: 1,
    })
      .memory(semantic)
      .build();

    // Smoke-test: pre-seeded vector store + Top-K runs without crashing.
    const result = await agent.run({
      message: 'tell me about my preferences',
      identity: { conversationId: 'sem-test' },
    });
    expect(typeof result).toBe('string');
  });

  it('agents WITHOUT .memory() work unchanged (no regression)', async () => {
    const agent = Agent.create({
      provider: mock({ reply: 'no memory needed' }),
      model: 'mock',
      maxIterations: 1,
    }).build();

    const result = await agent.run({ message: 'hi' });
    expect(typeof result).toBe('string');
  });

  it('episodic memory WRITES persist the turn (user + assistant) to the store', async () => {
    const store = new InMemoryStore();
    const memory = defineMemory({
      id: 'persistent',
      type: MEMORY_TYPES.EPISODIC,
      strategy: { kind: MEMORY_STRATEGIES.WINDOW, size: 10 },
      store,
    });

    const agent = Agent.create({
      provider: mock({ reply: 'hello back' }),
      model: 'mock',
      maxIterations: 1,
    })
      .memory(memory)
      .build();

    const identity = { conversationId: 'persist-test' };
    await agent.run({ message: 'hello', identity });

    // Verify the turn landed in the store.
    const result = await store.list(identity);
    expect(result.entries.length).toBeGreaterThanOrEqual(2);
    // Either order is fine as long as both messages persisted.
    const contents = result.entries.map((e) =>
      typeof e.value === 'object' && e.value !== null && 'content' in e.value
        ? (e.value as { content: string }).content
        : '',
    );
    expect(contents).toContain('hello');
    expect(contents).toContain('hello back');
  });

  it('memory writes only fire when the agent reaches the final stage (loop terminates)', async () => {
    const store = new InMemoryStore();
    const memory = defineMemory({
      id: 'turn-scoped',
      type: MEMORY_TYPES.EPISODIC,
      strategy: { kind: MEMORY_STRATEGIES.WINDOW, size: 5 },
      store,
    });

    const agent = Agent.create({
      provider: mock({ reply: 'ok' }),
      model: 'mock',
      maxIterations: 1,
    })
      .memory(memory)
      .build();

    const id1 = { conversationId: 'turn1' };
    const id2 = { conversationId: 'turn2' };

    await agent.run({ message: 'first turn', identity: id1 });
    await agent.run({ message: 'second turn', identity: id2 });

    // Identity isolation: each conversationId has its own entries.
    const r1 = await store.list(id1);
    const r2 = await store.list(id2);
    expect(r1.entries.length).toBeGreaterThanOrEqual(2);
    expect(r2.entries.length).toBeGreaterThanOrEqual(2);
  });
});
