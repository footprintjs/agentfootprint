import { expect, it } from 'vitest';
import { Agent, Sequence, defineTool } from '../../index.js';
import {
  defineMemory,
  MEMORY_TYPES,
  MEMORY_STRATEGIES,
  SNAPSHOT_PROJECTIONS,
  InMemoryStore,
  mockEmbedder,
} from '../index.js';
import type { SnapshotEntry } from './types.js';
import type { LLMProvider } from '../../provider-contract/types.js';

it.each([
  { label: 'plain', env: undefined },
  { label: 'traceId', env: { traceId: 'fixture-trace' } },
  {
    label: 'traceparent',
    env: { traceparent: '00-0123456789abcdef0123456789abcdef-0123456789abcdef-01' },
  },
])('concurrent mounts keep complete causal evidence with $label', async ({ env }) => {
  const store = new InMemoryStore();
  let entered!: () => void;
  let release!: () => void;
  const reached = new Promise<void>((resolve) => {
    entered = resolve;
  });
  const held = new Promise<void>((resolve) => {
    release = resolve;
  });
  const provider: LLMProvider = {
    name: 'scripted',
    complete: async (request) => {
      const result = request.messages.filter((message) => message.role === 'tool').at(-1);
      if (result !== undefined) {
        return { content: result.content, toolCalls: [], usage: { input: 17, output: 5 } };
      }
      const user = request.messages.find((message) => message.role === 'user')?.content;
      if (user === 'alpha') {
        entered();
        await held;
      }
      return {
        content: '',
        toolCalls: [{ id: 'same-call', name: 'private_record', args: {} }],
        usage: { input: 11, output: 3 },
      };
    },
  };
  const shared = Agent.create({ provider, model: 'mock', maxIterations: 3 })
    .system('Return the caller record.')
    .toolProvider({
      id: 'private-records',
      list: (context) => [
        defineTool({
          name: 'private_record',
          description: 'Return the caller record.',
          inputSchema: { type: 'object', properties: {} },
          execute: () => 'PRIVATE-' + context.identity?.conversationId,
        }),
      ],
    })
    .memory(
      defineMemory({
        id: 'causal',
        type: MEMORY_TYPES.CAUSAL,
        strategy: {
          kind: MEMORY_STRATEGIES.TOP_K,
          topK: 1,
          threshold: 0,
          embedder: mockEmbedder(),
        },
        store,
        projection: SNAPSHOT_PROJECTIONS.DECISIONS,
      }),
    )
    .build();
  const alpha = Sequence.create({ id: 'alpha-parent' }).step('shared', shared).build();
  const beta = Sequence.create({ id: 'beta-parent' }).step('shared', shared).build();
  const first = alpha.run({ message: 'alpha', identity: { conversationId: 'alpha' } }, { env });
  const observed = first.catch((error: unknown) => ({ error }));
  try {
    await reached;
    await expect(
      beta.run({ message: 'beta', identity: { conversationId: 'beta' } }, { env }),
    ).resolves.toContain('PRIVATE-beta');
  } finally {
    release();
    await observed;
  }
  await expect(first).resolves.toContain('PRIVATE-alpha');
  for (const identity of ['alpha', 'beta']) {
    const result = await store.list<SnapshotEntry>({ conversationId: identity });
    const snapshots = result.entries
      .map((entry) => entry.value)
      .filter((value) => 'query' in value);
    expect(snapshots).toHaveLength(1);
    const snapshot = snapshots[0];
    expect.soft(snapshot?.toolCalls ?? []).toHaveLength(1);
    expect
      .soft((snapshot?.toolCalls ?? []).map((call) => call.resultPreview))
      .toEqual(['PRIVATE-' + identity]);
    expect.soft(snapshot?.tokenUsage).toEqual({ input: 28, output: 8 });
    expect.soft(snapshot?.decisions?.length ?? 0).toBeGreaterThan(0);
    expect(JSON.stringify(snapshot)).not.toContain(
      identity === 'alpha' ? 'PRIVATE-beta' : 'PRIVATE-alpha',
    );
  }
});
