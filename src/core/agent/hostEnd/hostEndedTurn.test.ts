import { expect, it } from 'vitest';
import { Agent, allow } from '../../../index.js';
import { mock } from '../../../llm-providers.js';

it.each(['full', 'delta'] as const)(
  'saves equal model and rewritten host replies across JSON restorations (%s)',
  async (commitValues) => {
    const requests: string[] = [];
    const fresh = () =>
      Agent.create({
        model: 'mock',
        commitValues,
        provider: mock({
          respond(request) {
            requests.push(JSON.stringify(request.messages));
            return {
              content: 'identical',
              toolCalls: [],
              stopReason: 'end_turn',
              usage: { input: 1, output: 1 },
            };
          },
        }),
      })
        .messageMiddleware({
          name: 'admit-notice',
          onMessage: (message) =>
            message.phase === 'output' && message.content === 'notice'
              ? allow('identical', 'public wording')
              : allow(),
        })
        .build();
    const a = fresh();
    expect(await a.run('first')).toBe('identical');
    const first = JSON.parse(JSON.stringify(a.checkpoint()));
    const b = fresh();
    expect(await b.endTurn({ reply: 'notice', reason: 'host-cap' }, { continueFrom: first })).toBe(
      'identical',
    );
    expect(requests).toHaveLength(1);
    const second = JSON.parse(JSON.stringify(b.checkpoint()));
    expect(second.history.some((row: { content: string }) => row.content === 'notice')).toBe(false);
    expect(b.getLastSnapshot()?.sharedState).toMatchObject({
      hostEndReason: 'host-cap',
      totalInputTokens: 0,
      totalOutputTokens: 0,
    });
    expect(JSON.stringify(b.getLastSnapshot()?.sharedState)).not.toContain('"notice"');
    const c = fresh();
    expect(await c.run({ message: 'next', continueFrom: second })).toBe('identical');
    expect(requests).toHaveLength(2);
    expect(requests[1]).not.toContain('replyOrigin');
    const last = JSON.parse(JSON.stringify(c.checkpoint()));
    expect(new Set([first.runId, second.runId, last.runId]).size).toBe(3);
    expect(last.history).toEqual([
      { role: 'user', content: 'first' },
      {
        role: 'assistant',
        content: 'identical',
        replyOrigin: { kind: 'model', runId: first.runId },
      },
      {
        role: 'assistant',
        content: 'identical',
        replyOrigin: { kind: 'host', runId: second.runId },
      },
      { role: 'user', content: 'next' },
      {
        role: 'assistant',
        content: 'identical',
        replyOrigin: { kind: 'model', runId: last.runId },
      },
    ]);
  },
);

it.each(['classic', 'dynamic', 'dynamic-grouped'] as const)(
  'retains the accepted model run identity at the %s checkpoint',
  async (mode) => {
    const agent = Agent.create({
      provider: mock({ reply: 'same' }),
      model: 'mock',
      reactMode: mode,
    }).build();
    expect(await agent.run('one')).toBe('same');
    const checkpoint = agent.checkpoint()!;
    expect(checkpoint.history.at(-1)).toMatchObject({
      role: 'assistant',
      content: 'same',
      replyOrigin: { kind: 'model', runId: checkpoint.runId },
    });
  },
);

it('withholds denied text from delivery, stream, snapshots and saved history', async () => {
  let calls = 0;
  const tokens: string[] = [];
  const agent = Agent.create({
    model: 'mock',
    provider: mock({
      respond() {
        calls++;
        throw new Error('unexpected call');
      },
    }),
  })
    .messageMiddleware({ name: 'hold', onMessage: () => ({ kind: 'deny', reason: 'withheld' }) })
    .build();
  agent.on('agentfootprint.stream.token', (e) => tokens.push(e.payload.content));
  await expect(agent.endTurn({ reply: 'private candidate', reason: 'host-cap' })).rejects.toThrow();
  expect(calls).toBe(0);
  expect(tokens).toEqual([]);
  expect(agent.getLastSnapshot()?.sharedState).toMatchObject({
    hostEndReason: 'host-cap',
    messageDeniedPhase: 'output',
  });
  expect(agent.checkpoint()?.history ?? []).toEqual([]);
  expect(JSON.stringify(agent.getLastSnapshot()?.sharedState)).not.toContain('private candidate');
});

it('rejects invalid schema without repair or running the provider', async () => {
  let calls = 0;
  const agent = Agent.create({
    model: 'mock',
    provider: mock({
      respond() {
        calls++;
        throw new Error('unexpected call');
      },
    }),
  })
    .outputSchema(
      {
        parse(value) {
          if (value !== 42) throw new Error('wrong number');
          return value;
        },
      },
      { retries: 2 },
    )
    .build();
  await expect(agent.endTurn({ reply: 'private candidate', reason: 'host-cap' })).rejects.toThrow(
    /schema/,
  );
  expect(calls).toBe(0);
  expect(agent.checkpoint()?.history ?? []).toEqual([]);
  expect(JSON.stringify(agent.getLastSnapshot()?.sharedState)).not.toContain('private candidate');
});

it('refuses a mandatory judge before either a judge or model runs', async () => {
  let calls = 0;
  const agent = Agent.create({
    model: 'mock',
    provider: mock({
      respond() {
        calls++;
        throw new Error('unexpected provider');
      },
    }),
  })
    .outputSchema({
      parse(value) {
        return value;
      },
    })
    .answerValidation({
      id: 'judge',
      version: '1',
      mode: 'enforce',
      validate() {
        calls++;
        return { checks: [] };
      },
    })
    .build();
  await expect(agent.endTurn({ reply: 'private candidate', reason: 'host-cap' })).rejects.toThrow(
    /terminal policy/,
  );
  expect(calls).toBe(0);
  expect(agent.checkpoint()?.history ?? []).toEqual([]);
});

it('requires real input for a wrapper and calls it once when there is input', async () => {
  const inputs: unknown[] = [];
  const agent = Agent.create({ model: 'mock', provider: mock({ reply: 'unexpected' }) })
    .aroundTurn({
      name: 'wrapper',
      around(turn, proceed) {
        inputs.push(turn);
        return proceed();
      },
    })
    .build();
  await expect(agent.endTurn({ reply: 'done', reason: 'host-cap' })).rejects.toThrow(/inbound/);
  expect(inputs).toHaveLength(0);
  expect(
    await agent.endTurn({ reply: 'done', reason: 'host-cap' }, { message: 'real input' }),
  ).toBe('done');
  expect(inputs).toHaveLength(1);
  expect(agent.checkpoint()?.history.map(({ role, content }) => [role, content])).toEqual([
    ['user', 'real input'],
    ['assistant', 'done'],
  ]);
});

it('cancels during output admission without delivering the candidate', async () => {
  const control = new AbortController();
  const tokens: string[] = [];
  const agent = Agent.create({ model: 'mock', provider: mock({ reply: 'unexpected' }) })
    .messageMiddleware({
      name: 'cancel',
      onMessage() {
        control.abort();
        return allow();
      },
    })
    .build();
  agent.on('agentfootprint.stream.token', (event) => tokens.push(event.payload.content));
  await expect(
    agent.endTurn(
      { reply: 'private candidate', reason: 'host-cap' },
      { options: { signal: control.signal } },
    ),
  ).rejects.toThrow();
  expect(tokens).toEqual([]);
  expect(agent.checkpoint()?.history ?? []).toEqual([]);
});
