import { expect, it } from 'vitest';
import { Agent, Sequence, defineTool } from '../../../../index.js';
import type { LLMProvider } from '../../../../provider-contract/types.js';

function barrier() {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

it('a direct terminal never closes another mounted component run resource', async () => {
  const entered = barrier();
  const release = barrier();
  const closed: string[] = [];
  const provider: LLMProvider = {
    name: 'scripted',
    complete: async (request) => {
      const user = request.messages.find((message) => message.role === 'user')?.content;
      if (user === 'beta') return { content: 'B', toolCalls: [], usage: { input: 1, output: 1 } };
      if (request.messages.some((message) => message.role === 'tool')) {
        entered.resolve();
        await release.promise;
        return { content: 'A', toolCalls: [], usage: { input: 1, output: 1 } };
      }
      return {
        content: '',
        toolCalls: [{ id: 'same-call', name: 'resource', args: {} }],
        usage: { input: 1, output: 1 },
      };
    },
  };
  const shared = Agent.create({ provider, model: 'mock', maxIterations: 3 })
    .tool(
      defineTool({
        name: 'resource',
        description: 'Hold a resource.',
        inputSchema: { type: 'object', properties: {} },
        execute: (_args, context) => {
          if (!context.onTeardown) throw new Error('Expected a real teardown port');
          context.onTeardown(
            () => {
              closed.push('alpha');
            },
            { scope: 'run', key: 'alpha' },
          );
          return 'ready';
        },
      }),
    )
    .build();
  const parent = Sequence.create({ id: 'resource-parent' }).step('agent', shared).build();
  const first = parent.run({ message: 'alpha', identity: { conversationId: 'alpha' } });
  const observed = first.catch((error: unknown) => ({ error }));
  try {
    await entered.promise;
    await expect(
      shared.run({ message: 'beta', identity: { conversationId: 'beta' } }),
    ).resolves.toBe('B');
    expect.soft(closed).toEqual([]);
  } finally {
    release.resolve();
    await observed;
  }
  await expect(first).resolves.toBe('A');
  expect(closed).toEqual(['alpha']);
});

it('same tool and call id in concurrent components keep distinct call resources', async () => {
  const entered = barrier();
  const release = barrier();
  const closed: string[] = [];
  const provider: LLMProvider = {
    name: 'scripted',
    complete: async (request) => {
      const tool = request.messages.find((message) => message.role === 'tool');
      return tool
        ? { content: tool.content, toolCalls: [], usage: { input: 1, output: 1 } }
        : {
            content: '',
            toolCalls: [{ id: 'same-call', name: 'resource', args: {} }],
            usage: { input: 1, output: 1 },
          };
    },
  };
  const shared = Agent.create({ provider, model: 'mock', maxIterations: 3 })
    .tool(
      defineTool({
        name: 'resource',
        description: 'Hold a call resource.',
        inputSchema: { type: 'object', properties: {} },
        execute: async (_args, context) => {
          const owner = context.identity?.conversationId ?? 'missing';
          if (!context.onTeardown) throw new Error('Expected a real teardown port');
          context.onTeardown(
            () => {
              closed.push(owner);
            },
            { scope: 'call' },
          );
          if (owner === 'alpha') {
            entered.resolve();
            await release.promise;
          }
          return owner;
        },
      }),
    )
    .build();
  const alpha = Sequence.create({ id: 'alpha-resource' }).step('agent', shared).build();
  const beta = Sequence.create({ id: 'beta-resource' }).step('agent', shared).build();
  const first = alpha.run({ message: 'alpha', identity: { conversationId: 'alpha' } });
  const observed = first.catch((error: unknown) => ({ error }));
  try {
    await entered.promise;
    await expect(
      beta.run({ message: 'beta', identity: { conversationId: 'beta' } }),
    ).resolves.toContain('beta');
    expect.soft(closed).toEqual(['beta']);
  } finally {
    release.resolve();
    await observed;
  }
  await expect(first).resolves.toContain('alpha');
  expect.soft([...closed].sort()).toEqual(['alpha', 'beta']);
});
