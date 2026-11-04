import { expect, it, vi } from 'vitest';
import { Agent, defineTool, pauseHere } from '../../src/index.js';
import { memorySessions, readPausedRun, standingAgent } from '../../src/hosting/index.js';
import { mock } from '../../src/llm-providers.js';
import { inProcessHost } from './testHost.js';

function pausing(closed: string[]) {
  return Agent.create({
    provider: mock({
      replies: [
        { toolCalls: [{ id: 'same', name: 'hold', args: {} }] },
        { toolCalls: [{ id: 'same', name: 'hold', args: {} }] },
      ],
    }),
    model: 'mock',
  })
    .tool(
      defineTool({
        name: 'hold',
        description: 'Local handle',
        inputSchema: { type: 'object' },
        execute: (_args, ctx) => {
          for (const scope of ['call', 'run', 'session'] as const)
            ctx.onTeardown!(
              () => {
                closed.push(String(ctx.sessionId) + ':' + scope);
              },
              { scope },
            );
          pauseHere({ question: 'continue?' });
        },
      }),
    )
    .build();
}

it('a stored handoff cannot clear a later occurrence’s pending question', async () => {
  const closed: string[] = [];
  const runner = pausing(closed),
    sessions = memorySessions(),
    host = inProcessHost();
  let entered!: () => void, release!: () => void;
  const started = new Promise<void>((resolve) => {
    entered = resolve;
  });
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  const persist = sessions.persist.bind(sessions);
  vi.spyOn(sessions, 'persist').mockImplementation(async (id, value) => {
    if (readPausedRun(value)) {
      entered();
      await gate;
    }
    await persist(id, value);
  });
  const handle = await standingAgent({ agent: runner, sessions, host });
  try {
    const a = host.deliver({ input: 'a', sessionId: 'a' });
    await started;
    await runner.abandonPause();
    await runner.run({ message: 'b' }, { sessionId: 'b' });
    release();
    expect((await a).awaiting).toBeDefined();
    await expect(runner.run({ message: 'third' })).rejects.toMatchObject({
      code: 'ERR_PENDING_QUESTION',
    });
    expect([...closed].sort()).toEqual(['a:call', 'a:run']);
  } finally {
    release();
    await handle.close();
  }
});

it('failed pause persistence disposes its call/run owner and leaves session cleanup to the host', async () => {
  const closed: string[] = [];
  const runner = pausing(closed),
    sessions = memorySessions(),
    host = inProcessHost();
  const persist = sessions.persist.bind(sessions);
  vi.spyOn(sessions, 'persist').mockImplementation(async (id, value) => {
    if (readPausedRun(value)) throw new Error('local pause storage refused');
    await persist(id, value);
  });
  const handle = await standingAgent({ agent: runner, sessions, host });
  try {
    const result = await host.deliver({ input: 'a', sessionId: 'a' });
    expect(result.error).toContain('local pause storage refused');
    expect([...closed].sort()).toEqual(['a:call', 'a:run']);
  } finally {
    await handle.close();
  }
  expect([...closed].sort()).toEqual(['a:call', 'a:run', 'a:session']);
});
