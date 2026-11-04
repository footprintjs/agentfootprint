import { expect, it } from 'vitest';
import { Agent } from '../../index.js';
import { mock } from '../../llm-providers.js';

const build = () => Agent.create({ provider: mock({ reply: 'done' }), model: 'mock' }).build();

it.each([null, 'bob', {}, { principal: 5 }])(
  'followUp validates identity shape before comparing it: %j',
  async (identity) => {
    const agent = build();
    await agent.run('first');
    const before = agent.checkpoint();
    await expect(agent.followUp('next', { identity } as never)).rejects.toThrow(
      /Agent\.followUp: identity/,
    );
    expect(agent.checkpoint()?.history).toEqual(before?.history);
    expect(agent.checkpoint()?.identity).toEqual(before?.identity);
  },
);

it('an anonymous conversation can explicitly name its next turn', async () => {
  const agent = build();
  await agent.run('anonymous first');
  await expect(
    agent.followUp('named next', { identity: { conversationId: 'same', principal: 'caller' } }),
  ).resolves.toBe('done');
  expect(agent.checkpoint()?.identity).toEqual({ conversationId: 'same', principal: 'caller' });
  expect(agent.checkpoint()?.history.some((message) => message.content === 'anonymous first')).toBe(
    true,
  );
});

it('a session-derived conversation accepts the same id named explicitly on the next turn', async () => {
  const agent = build();
  await agent.run('session first', { sessionId: 's' });
  await expect(
    agent.followUp('named next', { sessionId: 's', identity: { conversationId: 's' } }),
  ).resolves.toBe('done');
  expect(agent.checkpoint()?.identity).toEqual({ conversationId: 's' });
});

it('followUp cannot change an explicitly named person or conversation', async () => {
  const agent = build();
  const identity = { conversationId: 'a', tenant: 't', principal: 'alice' };
  await agent.run({ message: 'first', identity });
  await expect(agent.followUp('same', { identity: { ...identity } })).resolves.toBe('done');
  const before = agent.checkpoint();
  for (const other of [
    { ...identity, principal: 'bob' },
    { ...identity, tenant: 'other' },
    { ...identity, conversationId: 'b' },
  ])
    await expect(agent.followUp('refused', { identity: other })).rejects.toMatchObject({
      code: 'ERR_SESSION_OWNERSHIP_CONFLICT',
    });
  expect(agent.checkpoint()?.history).toEqual(before?.history);
  expect(agent.checkpoint()?.identity).toEqual(before?.identity);
});
