import { expect, it } from 'vitest';
import { Agent } from '../../../Agent.js';
import { Sequence } from '../../../../core-flow/Sequence.js';
import { defineTool } from '../../../../tools/tools.js';
import type { LLMProvider } from '../../../../provider-contract/types.js';

it.each(['classic', 'dynamic', 'dynamic-grouped'] as const)(
  '%s: a shared agent dispatches only its own provider offer and argument defaults',
  async (reactMode) => {
    let entered!: () => void;
    let release!: () => void;
    const reached = new Promise<void>((resolve) => {
      entered = resolve;
    });
    const held = new Promise<void>((resolve) => {
      release = resolve;
    });
    const listings: string[] = [];
    const provider: LLMProvider = {
      name: 'scripted',
      complete: async (request) => {
        const result = request.messages.filter((message) => message.role === 'tool').at(-1);
        if (result !== undefined) {
          return {
            content: result.content,
            toolCalls: [],
            usage: { input: 1, output: 1 },
            stopReason: 'stop',
          };
        }
        const user = request.messages.find((message) => message.role === 'user')?.content;
        if (user === 'alpha') {
          entered();
          await held;
        }
        return {
          content: '',
          toolCalls: [{ id: 'same-call', name: 'private_record', args: {} }],
          usage: { input: 1, output: 1 },
          stopReason: 'tool_use',
        };
      },
    };
    const shared = Agent.create({ provider, model: 'mock', maxIterations: 3, reactMode })
      .system('Return the requested record.')
      .toolProvider({
        id: 'private-records',
        list: (context) => {
          const identity = context.identity?.conversationId ?? 'missing';
          listings.push(identity);
          return [
            defineTool({
              name: 'private_record',
              description: 'Return the caller record.',
              inputSchema: {
                type: 'object',
                properties: {
                  window: { type: 'string', enum: [identity + '-window'] },
                },
                required: ['window'],
              },
              askOrAssume: { window: { assume: identity + '-window' } },
              execute: (args) => ({ value: 'PRIVATE-' + identity, window: args.window }),
            }),
          ];
        },
      })
      .inputsLayer()
      .build();
    const alpha = Sequence.create({ id: 'alpha-parent' }).step('agent', shared).build();
    const beta = Sequence.create({ id: 'beta-parent' }).step('agent', shared).build();
    const first = alpha.run({ message: 'alpha', identity: { conversationId: 'alpha' } });
    const observed = first.catch((error: unknown) => ({ error }));
    try {
      await reached;
      await expect(
        beta.run({ message: 'beta', identity: { conversationId: 'beta' } }),
      ).resolves.toContain('PRIVATE-beta');
    } finally {
      release();
      await observed;
    }
    await expect(first).resolves.toContain('PRIVATE-alpha');
    await expect(first).resolves.not.toContain('PRIVATE-beta');
    await expect(first).resolves.toContain('alpha-window');
    await expect(first).resolves.not.toContain('beta-window');
    const expectedListings = reactMode === 'classic' ? 1 : 2;
    expect(listings.filter((identity) => identity === 'alpha')).toHaveLength(expectedListings);
    expect(listings.filter((identity) => identity === 'beta')).toHaveLength(expectedListings);
  },
);
