import { expect, it, vi } from 'vitest';
import { Agent, isPaused, pauseHere } from '../../../src/index.js';

it.each([
  ['missing', undefined],
  ['number', 4],
  ['object', { sessionId: 'a' }],
  ['empty', ''],
] as const)('refuses a %s transport carrier before resuming any work', async (_label, carrier) => {
  const complete = vi.fn(async () => ({
    content: '',
    toolCalls: [{ id: 'same', name: 'hold', args: {} }],
    usage: { input: 1, output: 1 },
  }));
  const execute = vi.fn(() => pauseHere({ question: 'continue?' }));
  const agent = Agent.create({ provider: { name: 'scripted', complete }, model: 'mock' })
    .tool({ schema: { name: 'hold', description: '', inputSchema: { type: 'object' } }, execute })
    .build();
  const paused = await agent.run({ message: 'hold' }, { sessionId: 'a' });
  if (!isPaused(paused)) throw new Error('fixture did not pause');
  const stored = structuredClone(paused.checkpoint);
  if (carrier === undefined) delete stored.sharedState.runSessionId;
  else stored.sharedState.runSessionId = carrier;
  const before = JSON.stringify(stored);
  const result = await agent.resume(stored, 'yes').catch((error: unknown) => error);
  expect.soft(result).toBeInstanceOf(Error);
  expect.soft(String(result)).toMatch(/Invalid checkpoint.*runSessionId/);
  expect.soft(complete).toHaveBeenCalledTimes(1);
  expect.soft(execute).toHaveBeenCalledTimes(1);
  expect.soft(JSON.stringify(stored)).toBe(before);
});

it('refuses another transport session even when the caller identity matches', async () => {
  const complete = vi.fn(async () => ({
    content: '',
    toolCalls: [{ id: 'same', name: 'hold', args: {} }],
    usage: { input: 1, output: 1 },
  }));
  const execute = vi.fn(() => pauseHere({ question: 'continue?' }));
  const agent = Agent.create({ provider: { name: 'scripted', complete }, model: 'mock' })
    .tool({ schema: { name: 'hold', description: '', inputSchema: { type: 'object' } }, execute })
    .build();
  const identity = { principal: 'person', conversationId: 'conversation' };
  const paused = await agent.run({ message: 'hold', identity }, { sessionId: 'a' });
  if (!isPaused(paused)) throw new Error('fixture did not pause');
  await expect(
    agent.resume(paused.checkpoint, 'yes', { identity, sessionId: 'b' }),
  ).rejects.toMatchObject({
    code: 'ERR_SESSION_OWNERSHIP_CONFLICT',
  });
  expect(complete).toHaveBeenCalledTimes(1);
  expect(execute).toHaveBeenCalledTimes(1);
});

it('new sessionless checkpoints carry an explicit null transport fact', async () => {
  const agent = Agent.create({
    provider: {
      name: 'scripted',
      complete: async () => ({
        content: '',
        toolCalls: [{ id: 'same', name: 'hold', args: {} }],
        usage: { input: 1, output: 1 },
      }),
    },
    model: 'mock',
  })
    .tool({
      schema: { name: 'hold', description: '', inputSchema: { type: 'object' } },
      execute: () => pauseHere({ question: 'continue?' }),
    })
    .build();
  const paused = await agent.run({ message: 'hold' });
  if (!isPaused(paused)) throw new Error('fixture did not pause');
  expect(paused.checkpoint.sharedState.runSessionId).toBeNull();
});
