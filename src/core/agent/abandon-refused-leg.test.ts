import { expect, it } from 'vitest';
import { Agent, askHuman, defineTool, isPaused, requestInput } from '../../index.js';
import type { LLMProvider } from '../../provider-contract/types.js';

it.each(['plain', 'typed'] as const)(
  'abandon after a pre-door aborted %s answer closes the original paused resources',
  async (kind) => {
    const closed: string[] = [];
    const provider: LLMProvider = {
      name: 'scripted',
      async complete(request) {
        const latest = [...request.messages]
          .reverse()
          .find((message) => message.role === 'user')?.content;
        return latest === 'ask'
          ? {
              content: '',
              toolCalls: [{ id: 'hold', name: 'hold', args: {} }],
              usage: { input: 1, output: 1 },
            }
          : { content: 'done', toolCalls: [], usage: { input: 1, output: 1 } };
      },
    };
    const agent = Agent.create({ provider, model: 'test' })
      .tool(
        defineTool({
          name: 'hold',
          description: 'hold',
          inputSchema: { type: 'object' },
          execute: (_args, context) => {
            for (const scope of ['call', 'run'] as const)
              context.onTeardown!(
                () => {
                  closed.push(scope);
                },
                { scope },
              );
            return kind === 'plain'
              ? askHuman({ question: 'Continue?' })
              : requestInput({
                  id: 'year',
                  question: 'Which year?',
                  fields: [{ id: 'year', type: 'number', required: true }],
                });
          },
        }),
      )
      .build();
    try {
      const paused = await agent.run('ask');
      if (!isPaused(paused)) throw new Error('Expected pause');
      const abort = new AbortController();
      abort.abort(new Error('cancelled before resume'));
      const answer =
        kind === 'plain'
          ? 'yes'
          : { requestId: paused.awaitingInput!.requestId, values: { year: 2026 } };
      for (let attempt = 0; attempt < 2; attempt++)
        await expect(
          agent.resume(paused.checkpoint, answer, { env: { signal: abort.signal } }),
        ).rejects.toThrow();
      expect(closed).toEqual([]);
      expect(await agent.abandonPause()).toMatchObject({ toolName: 'hold' });
      expect([...closed].sort()).toEqual(['call', 'run']);
      expect(await agent.abandonPause()).toBeUndefined();
      await expect(agent.run('next')).resolves.toBe('done');
    } finally {
      await agent.shutdown({ stop: true });
    }
    expect([...closed].sort()).toEqual(['call', 'run']);
  },
);
