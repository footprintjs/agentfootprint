import { expect, it, vi } from 'vitest';

import { absent, Agent, askHuman, coverage, defineTool, inMemoryArtifacts } from '../../index.js';
import { mock } from '../../llm-providers.js';
import * as savedRecording from '../../recorders/observability/recordingParts/open.js';
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
      const why = await agent.why(first.node('unknown-node'), live);
      expect(why.gaps).toContain('scope-boundary');
      expect(why.gaps.some((gap) => gap.startsWith('unopened-subflow:'))).toBe(true);
      expect(await agent.why(first.node('unknown-node'), saved)).toEqual(why);
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

it.each([true, { layout: 'parts' as const, packed: true }])(
  'keeps declarations from the same turn before pause in live and saved reads (%j)',
  async (recordings) => {
    const agent = Agent.create({
      provider: mock({
        replies: [
          { toolCalls: [{ id: 'l1', name: 'lookup', args: {} }] },
          { toolCalls: [{ id: 'a1', name: 'ask', args: {} }] },
          { content: 'Done.' },
        ],
      }),
      model: 'mock',
      artifacts: { store: inMemoryArtifacts(), recordings },
    })
      .tool(
        defineTool({
          name: 'lookup',
          description: 'Check one source',
          inputSchema: { type: 'object' },
          execute: () =>
            coverage(absent({ what: 'records', checked: ['source'] }), {
              checked: ['source'],
              notChecked: ['older records'],
              cannotCover: [{ what: 'external records', why: 'no index' }],
            }),
        }),
      )
      .tool(
        defineTool({
          name: 'ask',
          description: 'Ask before continuing',
          inputSchema: { type: 'object' },
          execute: () => askHuman({ question: 'Continue?' }),
        }),
      )
      .limitsTravelWithTheAnswer()
      .answerLayer()
      .build();
    const host = inProcessHost();
    const request = { sessionId: 'coverage-resume', headers: { authorization: 'Bearer resume' } };
    const completions: HostedCompletedAgentTurn[] = [];
    const server = await standingAgent({
      agent,
      sessions: memorySessions(),
      host,
      identity: { verify: async () => ({ userId: 'resume-owner' }) },
      onCompletedTurn: (turn) => {
        completions.push(turn);
      },
    });
    try {
      const paused = await host.deliver({ input: 'Check the source.', ...request });
      expect(paused.awaiting?.question).toBe('Continue?');
      expect(completions).toHaveLength(0);
      const resumed = await host.deliver({ input: '', decision: 'yes', ...request });
      expect(resumed.output).toContain('older records');
      expect(completions).toHaveLength(1);
      const [turn] = completions;
      const live = await turn?.forRequest(() => request);
      const saved = await turn?.forRequest(() => request, 'saved');
      expect(live).toBeDefined();
      expect(saved).toBeDefined();
      const read = await agent.whatWasNotRead(live);
      expect(read).toMatchObject({
        runId: turn?.runId,
        facts: expect.arrayContaining([
          expect.objectContaining({
            kind: 'declared-coverage',
            calls: expect.arrayContaining([
              expect.objectContaining({ notChecked: 1, cannotCover: 1 }),
            ]),
          }),
        ]),
      });
      expect(read.gaps).not.toContain('resumed-turn-coverage-incomplete');
      expect(await agent.whatWasNotRead(saved)).toEqual(read);
    } finally {
      await server.close();
    }
  },
);

it.each(['open', 'root'] as const)(
  'reports an oversized exact saved recording only while its holder is still authorized (%s)',
  async (failureAt) => {
    const agent = Agent.create({
      provider: mock({ reply: 'Done.' }),
      model: 'mock',
      artifacts: { store: inMemoryArtifacts(), recordings: true },
    }).build();
    const host = inProcessHost();
    const request = { sessionId: 'exact-size', headers: { authorization: 'Bearer fixture' } };
    let active = true;
    let completed: HostedCompletedAgentTurn | undefined;
    const door = await standingAgent({
      agent,
      sessions: memorySessions(),
      host,
      identity: {
        verify: async () => {
          if (!active) throw new Error('Fixture verifier revoked the caller');
          return { userId: 'size-owner' };
        },
      },
      onCompletedTurn: async (turn) => {
        completed = turn;
      },
    });
    const open = savedRecording.openSavedRecording;
    const failure = { status: 'unavailable', reason: 'too-large' } as const;
    let revokeAfterRead = false;
    const spy = vi
      .spyOn(savedRecording, 'openSavedRecording')
      .mockImplementation(async (...args) => {
        if (failureAt === 'open') {
          if (revokeAfterRead) active = false;
          return failure;
        }
        const recording = await open(...args);
        if (recording.status !== 'ready') return recording;
        return {
          ...recording,
          readRoot: async () => {
            if (revokeAfterRead) active = false;
            return failure;
          },
        };
      });
    try {
      await host.deliver({ input: 'Evidence', ...request });
      if (completed === undefined) throw new Error('Expected a completed turn');
      const saved = await completed.forRequest(() => request, 'saved');
      expect(saved).toBeDefined();
      expect(await agent.whatWasNotRead()).toEqual({ gaps: ['turn-unavailable'] });
      expect(spy).not.toHaveBeenCalled();
      expect(await agent.whatWasNotRead(saved)).toEqual({ gaps: ['recording-too-large'] });
      expect(await agent.why(completed.node('unknown'), saved)).toEqual({
        gaps: ['recording-too-large'],
      });
      revokeAfterRead = true;
      expect(await agent.whatWasNotRead(saved)).toEqual({ gaps: ['turn-unavailable'] });
    } finally {
      spy.mockRestore();
      await door.close();
    }
  },
);

it('refuses a saved recording with the wrong origin before selecting its root', async () => {
  const agent = Agent.create({
    provider: mock({ reply: 'Done.' }),
    model: 'mock',
    artifacts: { store: inMemoryArtifacts(), recordings: true },
  }).build();
  const host = inProcessHost();
  const request = { sessionId: 'wrong-origin', headers: { authorization: 'Bearer fixture' } };
  let completed: HostedCompletedAgentTurn | undefined;
  const door = await standingAgent({
    agent,
    sessions: memorySessions(),
    host,
    identity: { verify: async () => ({ userId: 'recording-owner' }) },
    onCompletedTurn: (turn) => {
      completed = turn;
    },
  });
  const open = savedRecording.openSavedRecording;
  const readRoot = vi.fn();
  const spy = vi.spyOn(savedRecording, 'openSavedRecording').mockImplementation(async (...args) => {
    const recording = await open(...args);
    if (recording.status !== 'ready') return recording;
    return { ...recording, runId: 'different-run', readRoot };
  });
  try {
    await host.deliver({ input: 'Evidence', ...request });
    if (completed === undefined) throw new Error('Expected a completed turn');
    const saved = await completed.forRequest(() => request, 'saved');
    expect(saved).toBeDefined();
    expect(await agent.whatWasNotRead(saved)).toEqual({ gaps: ['turn-unavailable'] });
    expect(spy).toHaveBeenCalledTimes(1);
    expect(readRoot).not.toHaveBeenCalled();
  } finally {
    spy.mockRestore();
    await door.close();
  }
});
