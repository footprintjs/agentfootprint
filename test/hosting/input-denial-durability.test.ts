/**
 * Input admission must precede every conversation carrier.
 *
 * A denied seed used to initialise history before breaking. The exit writer
 * saw the refusal, but async/sync writers had already persisted the seed's
 * history mutation, including the refused request in originalInput. These
 * tests watch the actual session writes and the next provider request: a
 * refusal neither starts a conversation nor overwrites an accepted one.
 */

import { describe, expect, it } from 'vitest';

import { Agent, allow, deny } from '../../src/index.js';
import type { LLMProvider, LLMRequest, LLMResponse } from '../../src/adapters/types.js';
import { memorySessions, standingAgent } from '../../src/hosting/index.js';
import type {
  CheckpointEnvelope,
  DurabilityMode,
  SessionLifecycle,
} from '../../src/hosting/index.js';
import { inProcessHost } from './testHost.js';

const REFUSED = 'refused-input-canary';
const CASES = (['exit', 'async', 'sync'] as const).flatMap((durability) =>
  (['shared', 'pool'] as const).map((shape) => ({ durability, shape })),
);

function recordingSessions(): SessionLifecycle & { writes: CheckpointEnvelope[] } {
  const inner = memorySessions();
  const writes: CheckpointEnvelope[] = [];
  return {
    writes,
    hydrate: (id) => inner.hydrate(id),
    async persist(id, envelope) {
      writes.push(structuredClone(envelope));
      await inner.persist(id, envelope);
    },
  };
}

async function openSubject(durability: DurabilityMode, shape: 'shared' | 'pool') {
  const requests: Pick<LLMRequest, 'messages'>[] = [];
  const provider: LLMProvider = {
    name: 'admission-wire',
    complete(request): Promise<LLMResponse> {
      requests.push({
        messages: request.messages.map(({ role, content }) => ({ role, content })),
      });
      return Promise.resolve({
        content: `accepted-answer-${requests.length}`,
        toolCalls: [],
        usage: { input: 1, output: 1 },
        stopReason: 'stop',
      });
    },
  };
  const buildAgent = () =>
    Agent.create({ provider, model: 'test-model', maxIterations: 2 })
      .system('Answer briefly.')
      .messageMiddleware({
        name: 'input-admission',
        onMessage: (message) =>
          message.phase === 'input' && message.content === REFUSED
            ? deny('This request is not admitted.')
            : allow(),
      })
      .build();
  const sessions = recordingSessions();
  const host = inProcessHost();
  const handle = await standingAgent({
    ...(shape === 'shared' ? { agent: buildAgent() } : { agentFactory: buildAgent }),
    sessions,
    host,
    durability,
  });
  return { sessions, host, handle, requests };
}

describe.each(CASES)(
  'input denial with $durability durability / $shape agent',
  ({ durability, shape }) => {
    it('leaves the accepted envelope and originalInput untouched, then continues it safely', async () => {
      const { sessions, host, handle, requests } = await openSubject(durability, shape);
      try {
        const first = await host.deliver({
          input: 'Remember the accepted request.',
          sessionId: 's',
        });
        expect(first.output).toBe('accepted-answer-1');
        const before = structuredClone(await sessions.hydrate('s'));
        expect(before?.format).toBe('conversation-v1');
        if (before?.format !== 'conversation-v1')
          throw new Error('Expected an accepted conversation');
        expect(before.data.originalInput.message).toBe('Remember the accepted request.');
        const written = sessions.writes.length;

        const denied = await host.deliver({ input: REFUSED, sessionId: 's' });
        expect(denied.code).toBe('ERR_MESSAGE_DENIED');
        expect(denied.output).toBeUndefined();
        expect(requests).toHaveLength(1);
        // Includes history, originalInput, owner and timestamps: a refusal is
        // not a newer accepted conversation, even if its history were empty.
        expect(sessions.writes).toHaveLength(written);
        expect(await sessions.hydrate('s')).toEqual(before);
        expect(JSON.stringify(sessions.writes)).not.toContain(REFUSED);

        const next = await host.deliver({
          input: 'Continue the accepted request.',
          sessionId: 's',
        });
        expect(next.output).toBe('accepted-answer-2');
        expect(requests).toHaveLength(2);
        expect(requests[1]!.messages.filter((message) => message.role !== 'system')).toEqual([
          { role: 'user', content: 'Remember the accepted request.' },
          { role: 'assistant', content: 'accepted-answer-1' },
          { role: 'user', content: 'Continue the accepted request.' },
        ]);
        expect(JSON.stringify(requests)).not.toContain(REFUSED);
      } finally {
        await handle.close();
      }
    });

    it('does not create a stored conversation for a denied first request', async () => {
      const { sessions, host, handle, requests } = await openSubject(durability, shape);
      try {
        const denied = await host.deliver({ input: REFUSED, sessionId: 'new' });
        expect(denied.code).toBe('ERR_MESSAGE_DENIED');
        expect(requests).toHaveLength(0);
        expect(sessions.writes).toEqual([]);
        expect(await sessions.hydrate('new')).toBeUndefined();

        const next = await host.deliver({ input: 'First accepted request.', sessionId: 'new' });
        expect(next.output).toBe('accepted-answer-1');
        expect(requests).toHaveLength(1);
        expect(requests[0]!.messages.filter((message) => message.role !== 'system')).toEqual([
          { role: 'user', content: 'First accepted request.' },
        ]);
        expect(JSON.stringify(sessions.writes)).not.toContain(REFUSED);
      } finally {
        await handle.close();
      }
    });
  },
);
