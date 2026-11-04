import { expect, it } from 'vitest';
import { Agent, askHuman, defineTool, isPaused } from '../../../src/index.js';
import { runnerLive } from '../../../src/core/runnerLive.js';
import { mock } from '../../../src/llm-providers.js';
import type { LLMRequest } from '../../../src/provider-contract/types.js';

function asking(closed: string[] = []) {
  return Agent.create({
    provider: mock({
      replies: [{ toolCalls: [{ id: 'held', name: 'ask', args: {} }] }, 'done', 'next'],
    }),
    model: 'mock',
  })
    .tool(
      defineTool({
        name: 'ask',
        description: 'Ask',
        inputSchema: { type: 'object' },
        execute: (_args, ctx) => {
          for (const scope of ['call', 'run'] as const)
            ctx.onTeardown!(
              () => {
                closed.push(scope);
              },
              { scope },
            );
          return askHuman({ question: 'Continue?' });
        },
      }),
    )
    .build();
}

it.each(['malformed', 'missing'] as const)(
  'a %s owner refusal preserves the question and its resources',
  async (shape) => {
    const closed: string[] = [];
    const agent = asking(closed);
    const pause = await agent.run('first');
    if (!isPaused(pause)) throw new Error('Expected pause');
    const bad = structuredClone(pause.checkpoint);
    if (shape === 'missing') delete bad.sharedState.toolResourceOwner;
    else bad.sharedState.toolResourceOwner = { version: 99 };
    await expect(agent.resume(bad, 'yes')).rejects.toBeInstanceOf(Error);
    expect(closed).toEqual([]);
    await expect(agent.run('other')).rejects.toMatchObject({ code: 'ERR_PENDING_QUESTION' });
    expect(await agent.resume(pause.checkpoint, 'yes')).toBe('done');
    expect([...closed].sort()).toEqual(['call', 'run']);
  },
);

it('a refused foreign carrier cannot replace the selected conversation', async () => {
  const bob = asking();
  const pause = await bob.run({
    message: 'private-B',
    identity: { conversationId: 'B', principal: 'bob' },
  });
  if (!isPaused(pause)) throw new Error('Expected pause');
  const bad = structuredClone(pause.checkpoint);
  bad.sharedState.toolResourceOwner = { version: 99 };
  const alice = Agent.create({ provider: mock({ replies: ['answer-A'] }), model: 'mock' }).build();
  await alice.run({ message: 'private-A', identity: { conversationId: 'A', principal: 'alice' } });
  const before = alice.checkpoint();
  await expect(alice.resume(bad, 'yes')).rejects.toBeInstanceOf(Error);
  expect(alice.checkpoint()?.history).toEqual(before?.history);
  expect(alice.checkpoint()?.identity).toEqual(before?.identity);
  expect(JSON.stringify(alice.getLastSnapshot())).not.toContain('private-B');
});

it('abandon with no locally pending question does not close a transferred stored pause', async () => {
  const closed: string[] = [];
  const agent = asking(closed);
  const pause = await agent.run('first');
  if (!isPaused(pause)) throw new Error('Expected pause');
  const ownership = runnerLive(agent)?.pause?.capture(pause);
  expect(ownership).toBeDefined();
  ownership!.release();
  expect(await agent.abandonPause()).toBeUndefined();
  expect(closed).toEqual([]);
  expect(await agent.resume(pause.checkpoint, 'yes')).toBe('done');
  expect([...closed].sort()).toEqual(['call', 'run']);
});

it.each(['same', 'fresh'] as const)(
  'a catalog failure before answer consumption retains its question and supports exact abandon: %s',
  async (shape) => {
    const closed: string[] = [];
    let fail = false;
    const tool = defineTool({
      name: 'ask',
      description: 'Ask',
      inputSchema: { type: 'object' },
      execute: (_args, ctx) => {
        ctx.onTeardown!(
          () => {
            closed.push('run');
          },
          { scope: 'run' },
        );
        return askHuman({ question: 'Continue?' });
      },
    });
    const make = () =>
      Agent.create({
        provider: {
          name: 'scripted',
          complete: async (r: LLMRequest) =>
            r.messages.some((m) => m.role === 'tool')
              ? { content: 'done', toolCalls: [], usage: { input: 1, output: 1 } }
              : {
                  content: '',
                  toolCalls: [{ id: 'held', name: 'ask', args: {} }],
                  usage: { input: 1, output: 1 },
                },
        },
        model: 'mock',
      })
        .toolProvider({
          id: 'catalog',
          list: () => {
            if (fail) throw new Error('catalog failed');
            return [tool];
          },
        })
        .build();
    const first = make(),
      pause = await first.run('first');
    if (!isPaused(pause)) throw new Error('Expected pause');
    const resumer = shape === 'same' ? first : make();
    fail = true;
    const reports: unknown[] = [];
    resumer.on('agentfootprint.tools.resource_restore', (e) => reports.push(e.payload));
    await expect(resumer.resume(pause.checkpoint, 'yes')).rejects.toThrow('catalog failed');
    expect(closed).toEqual([]);
    expect(reports).toContainEqual({
      local: shape === 'same' ? 'retained' : 'none-known-locally',
      remote: 'unknown',
    });
    await expect(resumer.run('other')).rejects.toMatchObject({ code: 'ERR_PENDING_QUESTION' });
    fail = false;
    expect(await resumer.abandonPause()).toBeDefined();
    // A fresh instance has no handle in its local tier; original host cleanup stays explicit.
    if (shape === 'same') expect(closed).toEqual(['run']);
    else {
      expect(closed).toEqual([]);
      await first.abandonPause();
      expect(closed).toEqual(['run']);
    }
  },
);

it('a valid answer followed by a business failure does not revive the answered question', async () => {
  let fail = false;
  const agent = Agent.create({
    provider: {
      name: 'scripted',
      complete: async (r: LLMRequest) => {
        if (fail) throw new Error('later model failure');
        return r.messages.some((m) => m.role === 'tool')
          ? { content: 'done', toolCalls: [], usage: { input: 1, output: 1 } }
          : {
              content: '',
              toolCalls: [{ id: 'held', name: 'ask', args: {} }],
              usage: { input: 1, output: 1 },
            };
      },
    },
    model: 'mock',
  })
    .tool(
      defineTool({
        name: 'ask',
        description: 'Ask',
        inputSchema: { type: 'object' },
        execute: () => askHuman({ question: 'Continue?' }),
      }),
    )
    .build();
  const pause = await agent.run('first');
  if (!isPaused(pause)) throw new Error('Expected pause');
  fail = true;
  await expect(agent.resume(pause.checkpoint, 'yes')).rejects.toThrow('later model failure');
  fail = false;
  expect(await agent.abandonPause()).toBeUndefined();
  expect(isPaused(await agent.run('other'))).toBe(true);
});
