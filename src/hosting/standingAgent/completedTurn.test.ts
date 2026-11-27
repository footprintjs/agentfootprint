import { expect, it } from 'vitest';

import { Agent, inMemoryArtifacts } from '../../index.js';
import { mock } from '../../llm-providers.js';
import { inProcessHost } from '../../../test/hosting/testHost.js';
import { memorySessions } from '../memorySessions.js';
import { standingAgent } from '../standingAgent.js';
import type { HostedCompletedAgentTurn } from './completedTurn.js';

it.each([true, { layout: 'parts' as const, packed: true }])(
  'serves public W9 reads for the exact hosted turn and bound native receipt (%j)',
  async (recordings) => {
    const agent = Agent.create({
      provider: mock({ reply: 'Done.' }),
      model: 'mock',
      artifacts: { store: inMemoryArtifacts(), recordings },
    }).build();
    const hosted = inProcessHost();
    const completions: HostedCompletedAgentTurn[] = [];
    let active = true;
    const token = 'first';
    const headers = { authorization: 'Bearer first' };
    const door = await standingAgent({
      agent,
      sessions: memorySessions(),
      host: hosted,
      identity: {
        verify: async (supplied) => {
          if (!active) throw new Error('Fixture verifier revoked the caller');
          return { userId: supplied === token ? 'first-owner' : 'second-owner' };
        },
      },
      onCompletedTurn: (turn) => {
        completions.push(turn);
      },
    });
    try {
      expect(
        (await hosted.deliver({ input: 'First', sessionId: 'first-session', headers })).output,
      ).toBe('Done.');
      expect(
        (
          await hosted.deliver({
            input: 'Second',
            sessionId: 'second-session',
            headers: { authorization: 'Bearer second' },
          })
        ).output,
      ).toBe('Done.');
      const [first, second] = completions;
      if (first === undefined || second === undefined)
        throw new Error('Expected two exact completed turns');
      expect(first.runId).not.toBe(second.runId);
      expect(first.agent).toBe(agent);
      const request = () => ({ sessionId: 'first-session', headers });
      const live = await first.forRequest(request);
      const saved = await first.forRequest(request, 'saved');
      if (live === undefined || saved === undefined)
        throw new Error('Expected both host capabilities');
      expect(await agent.whatWasNotRead(live)).toMatchObject({
        runId: first.runId,
        facts: [
          { kind: 'declared-coverage', calls: [] },
          { kind: 'evidence-verdict', status: 'disabled' },
        ],
      });
      expect(await agent.whatWasNotRead(saved)).toEqual(await agent.whatWasNotRead(live));
      expect(await agent.why(second.node('shared-node'), live)).toEqual({
        gaps: ['turn-unavailable'],
      });
      expect(await second.forRequest(request)).toBeUndefined();
      expect(
        await first.forRequest(() => ({
          sessionId: 'first-session',
          headers: { authorization: 'Bearer second' },
        })),
      ).toBeUndefined();
      active = false;
      expect(await agent.whatWasNotRead(live)).toEqual({ gaps: ['turn-unavailable'] });
      expect(await agent.whatWasNotRead(saved)).toEqual({ gaps: ['turn-unavailable'] });
    } finally {
      await door.close();
    }
  },
);
