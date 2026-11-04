import { expect, it, vi } from 'vitest';
import { Agent, Sequence } from '../index.js';
import { memorySessions, readEnvelope, standingAgent } from './index.js';
import { inProcessHost } from '../../test/hosting/testHost.js';
import type { LLMProvider, LLMRequest } from '../provider-contract/types.js';

function barrier(): { promise: Promise<void>; release(): void } {
  let release!: () => void;
  const promise = new Promise<void>((resolve) => {
    release = resolve;
  });
  return { promise, release };
}

function latestUser(request: LLMRequest): string {
  return String(
    [...request.messages].reverse().find((message) => message.role === 'user')?.content,
  );
}

it.each(['async', 'sync'] as const)(
  'durability %s never stores an out-of-band invocation in the held session',
  async (durability) => {
    const provider: LLMProvider = {
      name: 'scripted',
      async complete(request) {
        return {
          content: `reply:${latestUser(request)}`,
          toolCalls: [],
          usage: { input: 1, output: 1 },
        };
      },
    };
    const agent = Agent.create({ provider, model: 'test' }).build();
    const sessions = memorySessions();
    const persist = sessions.persist.bind(sessions);
    const entered = barrier(),
      held = barrier();
    const writes: string[] = [];
    let once = false;
    vi.spyOn(sessions, 'persist').mockImplementation(async (id, value) => {
      writes.push(JSON.stringify({ id, value }));
      if (id === 'a' && JSON.stringify(value).includes('reply:from-A') && !once) {
        once = true;
        entered.release();
        await held.promise;
      }
      await persist(id, value);
    });
    const host = inProcessHost();
    const handle = await standingAgent({ agent, sessions, host, durability });
    try {
      const a = host.deliver({ input: 'from-A', sessionId: 'a' });
      await entered.promise;
      expect(writes.length).toBeGreaterThanOrEqual(2);
      const ownedWrites = writes.length;
      await agent.run('from-B', { sessionId: 'b' });
      expect(writes).toHaveLength(ownedWrites);
      held.release();
      expect((await a).output).toBe('reply:from-A');
      expect(writes.every((entry) => !entry.includes('from-B'))).toBe(true);
      const stored = await sessions.hydrate('a');
      expect(JSON.stringify(readEnvelope(stored))).not.toContain('from-B');
    } finally {
      held.release();
      await handle.close();
    }
  },
);

it.each(['direct', 'mounted'] as const)(
  'tokens from an unrelated %s invocation never enter the hosted reply',
  async (shape) => {
    const enteredProvider = barrier(),
      providerHeld = barrier();
    const provider: LLMProvider = {
      name: 'scripted-stream',
      async complete() {
        throw new Error('stream expected');
      },
      async *stream(request) {
        const message = latestUser(request);
        if (shape === 'mounted' && message === 'from-A') {
          enteredProvider.release();
          await providerHeld.promise;
        }
        const content = `secret:${message}`;
        yield { tokenIndex: 0, content, done: false };
        yield {
          tokenIndex: 1,
          content: '',
          done: true,
          response: { content, toolCalls: [], usage: { input: 1, output: 1 } },
        };
      },
    };
    const agent = Agent.create({ provider, model: 'test' }).build();
    const sessions = memorySessions();
    const persist = sessions.persist.bind(sessions);
    const entered = barrier(),
      held = barrier();
    let once = false;
    vi.spyOn(sessions, 'persist').mockImplementation(async (id, value) => {
      if (shape === 'direct' && id === 'a' && !once) {
        once = true;
        entered.release();
        await held.promise;
      }
      await persist(id, value);
    });
    const host = inProcessHost({ streaming: true });
    const handle = await standingAgent({ agent, sessions, host });
    try {
      const a = host.deliver({ input: 'from-A', sessionId: 'a' });
      await (shape === 'direct' ? entered.promise : enteredProvider.promise);
      if (shape === 'direct') await agent.run('from-B', { sessionId: 'b' });
      else
        await Sequence.create({ id: 'other' })
          .step('mounted', agent)
          .build()
          .run({ message: 'from-B' });
      held.release();
      providerHeld.release();
      const reply = await a;
      expect(reply.output).toBe('secret:from-A');
      expect(reply.chunks.join('')).toBe('secret:from-A');
    } finally {
      held.release();
      providerHeld.release();
      await handle.close();
    }
  },
);
