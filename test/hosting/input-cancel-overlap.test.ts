import { expect, it } from 'vitest';
import { Agent, defineTool, requestInput } from '../../src/index.js';
import { memorySessions, standingAgent } from '../../src/hosting/index.js';
import { readStoredSession } from '../../src/hosting/answeredPause.js';
import { inProcessHost } from './testHost.js';
import type { LLMRequest } from '../../src/provider-contract/types.js';

function barrier() {
  let release!: () => void;
  const promise = new Promise<void>((r) => {
    release = r;
  });
  return { promise, release };
}
it('host cancel of an input pause during overlap', async () => {
  let gate: ReturnType<typeof barrier> | undefined;
  let reached: ReturnType<typeof barrier> | undefined;
  const closed: string[] = [];
  const agent = Agent.create({
    provider: {
      name: 's',
      complete: async (r: LLMRequest) => {
        reached?.release();
        if (gate) await gate.promise;
        return (r.messages.find((m) => m.role === 'user') as any)?.content === 'side'
          ? { content: 'done', toolCalls: [], usage: { input: 1, output: 1 } }
          : {
              content: '',
              toolCalls: [{ id: 'c', name: 'collect', args: {} }],
              usage: { input: 1, output: 1 },
            };
      },
    } as any,
    model: 'm',
  })
    .tool(
      defineTool({
        name: 'collect',
        description: 'c',
        inputSchema: { type: 'object', properties: {} },
        execute: (_a: any, ctx: any) => {
          ctx.onTeardown?.(
            () => {
              closed.push('run');
            },
            { scope: 'run' },
          );
          return requestInput({ id: 'i', question: 'Y?', fields: [{ id: 'y', type: 'number' }] });
        },
      }),
    )
    .build();
  const sessions = memorySessions();
  const host = inProcessHost();
  const handle = await standingAgent({ agent, sessions, host });
  try {
    const first: any = await host.deliver({ input: 'q', sessionId: 's1' });
    const requestId = first.awaiting?.awaitingInput?.requestId;
    gate = barrier();
    reached = barrier();
    const side = agent.run('side').catch((e) => ({ e: e?.code }));
    await reached.promise;
    const cancelled: any = await host.deliver({
      input: '',
      sessionId: 's1',
      decision: { requestId, cancel: true },
    });
    expect(cancelled.error).toMatch(/in.flight/);
    const stored = readStoredSession((await sessions.hydrate('s1')) as any);
    expect(stored.waiting).toBeDefined();
    expect(closed).toEqual([]);
    gate.release();
    gate = undefined;
    reached = undefined;
    await side;
  } finally {
    gate?.release();
    await handle.close();
  }
  expect(closed).toEqual(['run']);
});
