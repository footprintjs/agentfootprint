import { expect, it, vi } from 'vitest';
import {
  Agent,
  allow,
  checkInApproved,
  defineTool,
  isCheckInPause,
  PendingQuestionError,
  RunInFlightError,
} from '../../../index.js';
import { mock } from '../../../llm-providers.js';
import { defineMemory, InMemoryStore } from '../../../memory/index.js';
import { conversationRedaction } from '../../../doors/security.js';

it('uses only the admitted inbound message as native input', async () => {
  const agent = Agent.create({ model: 'mock', provider: mock({ reply: 'unexpected' }) }).build();
  const options = { input: { message: 'substitute input' } };
  for (const inbound of [{}, { message: 'real input' }]) {
    await expect(
      agent.endTurn({ reply: 'notice', reason: 'host-cap' }, { ...inbound, options } as never),
    ).rejects.toThrow(/input/);
  }
  expect(agent.checkpoint()).toBeUndefined();
});

it('applies conversation redaction to the native host recording', async () => {
  const agent = Agent.create({
    model: 'mock',
    provider: mock({ reply: 'unexpected' }),
    redact: conversationRedaction(),
  }).build();
  await expect(agent.endTurn({ reply: 'private-host-text', reason: 'host-cap' })).resolves.toBe(
    'private-host-text',
  );
  const recording = agent.getSnapshot();
  expect(recording).toBeDefined();
  expect(JSON.stringify(recording)).not.toContain('private-host-text');
});

it.each(['deny', 'throw'] as const)(
  'keeps private wording out of a %s reason and preserves memory',
  async (failure) => {
    const identity = { conversationId: 'host-admission' };
    const store = new InMemoryStore();
    const agent = Agent.create({ model: 'mock', provider: mock({ reply: 'earlier answer' }) })
      .memory(
        defineMemory({
          id: 'history',
          type: 'episodic',
          strategy: { kind: 'window', size: 4 },
          store,
        }),
      )
      .messageMiddleware({
        name: 'output',
        onMessage(message) {
          if (message.content === 'secret candidate') {
            if (failure === 'throw') throw new Error(message.content);
            return { kind: 'deny', reason: 'Withheld: ' + message.content };
          }
          return allow();
        },
      })
      .build();
    await agent.run({ message: 'first', identity });
    const earlier = agent.checkpoint()!;
    const before = (await store.list(identity)).entries.map((row) => row.value);
    const tokens: string[] = [];
    agent.on('agentfootprint.stream.token', (event) => tokens.push(event.payload.content));
    const attempt = agent.endTurn(
      { reply: 'secret candidate', reason: 'host-cap' },
      { continueFrom: earlier },
    );
    await expect(attempt).rejects.toMatchObject({
      code: 'ERR_MESSAGE_DENIED',
      middleware: 'output',
    });
    await expect(attempt).rejects.not.toThrow(/secret candidate/);
    expect(tokens).toEqual([]);
    expect((await store.list(identity)).entries.map((row) => row.value)).toEqual(before);
    expect(agent.checkpoint()?.history).toEqual(earlier.history);
    expect(JSON.stringify(agent.getLastSnapshot())).not.toContain('secret candidate');
  },
);

it('hands the run cancellation signal to host output middleware', async () => {
  const controller = new AbortController();
  let observed: AbortSignal | undefined;
  const agent = Agent.create({ model: 'mock', provider: mock({ reply: 'unexpected' }) })
    .messageMiddleware({
      name: 'admission',
      onMessage({ signal }) {
        observed = signal;
        controller.abort();
        return allow();
      },
    })
    .build();
  await expect(
    agent.endTurn(
      { reply: 'private notice', reason: 'host-cap' },
      { options: { signal: controller.signal } },
    ),
  ).rejects.toThrow();
  expect(observed?.aborted).toBe(true);
  expect(agent.checkpoint()?.history ?? []).toEqual([]);
});

it('persists the identical admitted row in the checkpoint and the conversation store', async () => {
  const store = new InMemoryStore();
  const identity = { conversationId: 'durable-host-turn' };
  const agent = Agent.create({ model: 'mock', provider: mock({ reply: 'unexpected' }) })
    .memory(
      defineMemory({
        id: 'history',
        type: 'episodic',
        strategy: { kind: 'window', size: 2 },
        store,
      }),
    )
    .messageMiddleware({ name: 'rewrite', onMessage: () => allow('public notice', 'public form') })
    .build();
  await expect(
    agent.endTurn({ reply: 'private candidate', reason: 'host-cap' }, { identity }),
  ).resolves.toBe('public notice');
  const checkpoint = agent.checkpoint()!;
  const rows = (await store.list(identity)).entries.map((row) => row.value);
  expect(rows).toEqual([
    {
      role: 'assistant',
      content: 'public notice',
      replyOrigin: { kind: 'host', runId: checkpoint.runId },
    },
  ]);
  expect(checkpoint.history).toEqual(rows);
});

it('preserves the active model turn and admits a host notice after its lease releases', async () => {
  const agent = Agent.create({ model: 'mock', provider: mock({ reply: 'model reply' }) }).build();
  const first = agent.run('first');
  await expect(agent.endTurn({ reply: 'overlap', reason: 'host-cap' })).rejects.toThrow(
    RunInFlightError,
  );
  expect(await first).toBe('model reply');
  const earlier = agent.checkpoint()!;
  expect(JSON.stringify(earlier)).not.toContain('overlap');
  expect(
    await agent.endTurn({ reply: 'next', reason: 'host-cap' }, { continueFrom: earlier }),
  ).toBe('next');
});

it('preserves a pending consent request until its own decision arrives', async () => {
  const execute = vi.fn(() => 'approved');
  const agent = Agent.create({
    model: 'mock',
    provider: mock({
      replies: [
        { toolCalls: [{ id: 'call', name: 'confirm', args: {} }] },
        { content: 'finished' },
      ],
    }),
  })
    .tool(
      defineTool({
        name: 'confirm',
        description: 'Needs consent',
        inputSchema: { type: 'object', properties: {} },
        checkIn: 'always',
        execute,
      }),
    )
    .build();
  const paused = await agent.run('confirm');
  if (!isCheckInPause(paused)) throw new Error('expected consent request');
  await expect(agent.endTurn({ reply: 'skip it', reason: 'host-cap' })).rejects.toThrow(
    PendingQuestionError,
  );
  expect(execute).not.toHaveBeenCalled();
  await expect(
    agent.resume(paused.checkpoint, checkInApproved({ request: paused.checkIn, by: 'caller' })),
  ).resolves.toBe('finished');
  expect(execute).toHaveBeenCalledTimes(1);
});
