import { expect, it } from 'vitest';
import { Agent, defineTool, checkInApproved, isCheckInPause } from '../../src/index.js';
import { memorySessions, readPausedRun, standingAgent } from '../../src/hosting/index.js';
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

it('host answer refused by overlap must not burn the stored consent pause', async () => {
  let gate: ReturnType<typeof barrier> | undefined;
  let reached: ReturnType<typeof barrier> | undefined;
  let ran = 0;
  const agent = Agent.create({
    provider: {
      name: 'scripted',
      complete: async (request: LLMRequest) => {
        reached?.release();
        if (gate) await gate.promise;
        return request.messages.some((m) => m.role === 'tool') ||
          (request.messages.find((m) => m.role === 'user') as any)?.content === 'side'
          ? { content: 'done', toolCalls: [], usage: { input: 1, output: 1 } }
          : {
              content: '',
              toolCalls: [{ id: 'held', name: 'refund', args: {} }],
              usage: { input: 1, output: 1 },
            };
      },
    } as any,
    model: 'm',
  })
    .tool(
      defineTool({
        name: 'refund',
        description: 'refund',
        inputSchema: { type: 'object', properties: {} },
        checkIn: 'always',
        execute: () => {
          ran++;
          return 'refunded';
        },
      }),
    )
    .build();
  const sessions = memorySessions();
  const host = inProcessHost();
  const handle = await standingAgent({ agent, sessions, host });
  try {
    const first: any = await host.deliver({ input: 'please refund', sessionId: 's1' });
    expect(first.awaiting).toBeDefined();
    const pending = first.awaiting;
    const stored = await sessions.hydrate('s1');
    const paused = readPausedRun(stored as any);
    expect((paused as any).answered).toBeUndefined();
    const request =
      (paused as any).pending?.checkIn ?? (paused as any).checkpoint?.pauseData?.checkIn;
    const decision = checkInApproved({ request, by: 'person' });

    // A background use of the same instance, overlapping the host's answer.
    gate = barrier();
    reached = barrier();
    const side = agent.run('side').catch((e) => ({ sideError: e?.code }));
    await reached.promise;
    const answer: any = await host.deliver({ input: '', sessionId: 's1', decision });
    expect(answer.error).toMatch(/in.flight/);
    const after = await sessions.hydrate('s1');
    const afterPaused = readStoredSession(after as any);
    expect(afterPaused.answered).toBeUndefined();
    expect(afterPaused.waiting).toBeDefined();
    expect(ran).toBe(0);
    gate.release();
    gate = undefined;
    reached = undefined;
    await side;
    const retry: any = await host.deliver({ input: '', sessionId: 's1', decision });
    expect(retry.error).toBeUndefined();
    expect(retry.output ?? retry.text).toBe('done');
    expect(ran).toBe(1);
  } finally {
    gate?.release();
    await handle.close();
  }
});
