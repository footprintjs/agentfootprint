import { expect, it, vi } from 'vitest';
import { Agent } from '../../src/index.js';
import { memorySessions, readEnvelope, standingAgent } from '../../src/hosting/index.js';
import { inProcessHost } from './testHost.js';
import type { LLMRequest } from '../../src/provider-contract/types.js';

function barrier() {
  let release!: () => void;
  const promise = new Promise<void>((r) => {
    release = r;
  });
  return { promise, release };
}

it('hosted session store after an out-of-band run during settle', async () => {
  const agent = Agent.create({
    provider: {
      name: 'scripted',
      complete: async (request: LLMRequest) => {
        const u = (request.messages.find((m) => m.role === 'user') as any)?.content;
        return { content: `reply-to:${u}`, toolCalls: [], usage: { input: 1, output: 1 } };
      },
    } as any,
    model: 'm',
  }).build();
  const sessions = memorySessions();
  const gate = barrier();
  const entered = barrier();
  let hold = true;
  const persist = sessions.persist.bind(sessions);
  vi.spyOn(sessions, 'persist').mockImplementation(async (id: string, value: any) => {
    if (hold && id === 'a') {
      hold = false;
      entered.release();
      await gate.promise; // the durable write still draining
    }
    await persist(id, value);
  });
  const host = inProcessHost();
  const handle = await standingAgent({ agent, sessions, host, durability: 'async' } as any);
  try {
    const a = host.deliver({ input: 'from-A', sessionId: 'a' });
    await entered.promise;
    let b: any;
    for (let i = 0; i < 100; i++) {
      b = await agent
        .run(
          { message: 'from-B', identity: { conversationId: 'bob-conv', principal: 'bob' } },
          { sessionId: 'b' },
        )
        .then(
          (v) => ({ v }),
          (e) => ({ e: e?.code ?? String(e?.message).slice(0, 100) }),
        );
      if (b.e !== 'ERR_RUN_IN_FLIGHT') break;
      await new Promise((r) => setTimeout(r, 2));
    }
    expect(b).toEqual({ v: 'reply-to:from-B' });
    gate.release();
    const ra: any = await a;
    expect(ra.error).toBeUndefined();
    expect(ra.output ?? ra.text).toBe('reply-to:from-A');
    const env: any = await sessions.hydrate('a');
    const conv = readEnvelope(env);
    expect(conv.identity?.principal).not.toBe('bob');
    expect(JSON.stringify(conv.history)).toContain('from-A');
    expect(JSON.stringify(conv.history)).not.toContain('from-B');
  } finally {
    gate.release();
    await handle.close();
  }
});
