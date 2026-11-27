import { describe, expect, it } from 'vitest';
import { Agent, allow, ask, checkInApproved, isPaused, type TimeReader } from '../../src/index.js';
import type { LLMRequest, LLMResponse } from '../../src/provider-contract/types.js';
import { pausedRequest } from '../helpers/pausedRequest.js';
import { rulerBounds, rulerTool } from './fixtures/rulerTool.js';

const now = '2026-11-13T20:00:00Z';
const phrase = 'last 2 hours';
const exact = { from: '2026-11-13T18:00:00Z', to: now };
const earlier = { from: '2026-11-13T17:00:00Z', to: exact.from };
const reader: TimeReader = {
  id: 'ruler-frozen-middleware',
  version: '1',
  kind: 'model',
  locale: 'en-US',
  read: () => ({
    mentions: [{ quote: phrase, parses: [{ relative: { unit: 'hour', count: 2 } }] }],
  }),
};
const relative = { kind: 'lookback', argument: 'window', signed: false } as const;

type Args = Record<string, unknown>;

function fixture({
  change,
  pause = false,
  proposals = [{ window: '2h' }],
  commitValues = 'delta',
}: {
  change?: (args: Args, iteration: number) => Args;
  pause?: boolean;
  proposals?: Args[];
  commitValues?: 'full' | 'delta';
} = {}) {
  const calls: Args[] = [];
  const requests: LLMRequest[] = [];
  const provider = {
    name: 'ruler-frozen-middleware',
    async complete(request: LLMRequest): Promise<LLMResponse> {
      requests.push(request);
      const args = proposals[requests.length - 1];
      return {
        content: args === undefined ? 'done' : '',
        toolCalls: args === undefined ? [] : [{ id: 'ruler-call', name: 'ruler', args }],
        usage: { input: 0, output: 0 },
      };
    },
  };
  const builder = Agent.create({ provider, model: 'mock', maxIterations: 4, commitValues })
    .time({ zone: 'UTC', reader })
    .tool(
      rulerTool({
        period: { forms: [relative, rulerBounds], granularity: '1m' },
        onCall: (args) => calls.push(args),
      }),
    );
  if (change !== undefined) {
    builder.toolMiddleware({
      name: 'change-period-arguments',
      onToolCall: ({ args, iteration }) => allow(change(args, iteration), 'Updated input.'),
    });
  }
  if (pause) {
    builder.toolMiddleware({
      name: 'approve-ruler',
      onToolCall: () => ask({ question: 'Read this ruler?' }),
    });
  }
  return { agent: builder.build(), calls, requests };
}

const restoreDuration = (args: Args) => ({ ...args, window: '3h' });

describe('T3 final dispatch of an admitted frozen look-back', () => {
  it('refuses a relative argument restored by middleware', async () => {
    const f = fixture({ change: restoreDuration });
    await f.agent.run({ message: phrase, time: { now } });
    expect(f.calls).toEqual([]);
    expect(f.requests[1]?.messages.find((message) => message.role === 'tool')).toMatchObject({
      content: expect.stringMatching(/frozen look-back/),
    });
    expect(f.agent.checkpoint()?.history.find((message) => message.role === 'tool')).toMatchObject({
      outcome: 'refused',
    });
    expect(f.agent.findings().filter((row) => row.kind === 'call')).toEqual([]);
  });

  it.each(['full', 'delta'] as const)(
    'refuses the restored relative argument after a %s middleware pause',
    async (commitValues) => {
      const f = fixture({ change: restoreDuration, pause: true, commitValues });
      const paused = await f.agent.run({ message: phrase, time: { now } });
      if (!isPaused(paused)) throw new Error('Expected middleware approval.');
      expect(f.calls).toEqual([]);
      await f.agent.resume(
        JSON.parse(JSON.stringify(paused.checkpoint)),
        checkInApproved({ request: pausedRequest(paused), by: 'test host' }),
      );
      expect(f.calls).toEqual([]);
      expect(f.requests[1]?.messages.find((message) => message.role === 'tool')).toMatchObject({
        content: expect.stringMatching(/frozen look-back/),
      });
      expect(
        f.agent.checkpoint()?.history.find((message) => message.role === 'tool'),
      ).toMatchObject({ outcome: 'refused' });
    },
  );

  it('does not attach an earlier frozen witness to a later use of the same provider ID', async () => {
    const f = fixture({
      proposals: [{ window: '2h' }, earlier],
      change: (args, iteration) => (iteration === 2 ? restoreDuration(args) : args),
    });
    await f.agent.run({ message: phrase, time: { now } });
    expect(f.calls).toEqual([exact, restoreDuration(earlier)]);
  });

  it('dispatches clean absolute bounds after middleware approval', async () => {
    const f = fixture({ pause: true });
    const paused = await f.agent.run({ message: phrase, time: { now } });
    if (!isPaused(paused)) throw new Error('Expected middleware approval.');
    await f.agent.resume(
      JSON.parse(JSON.stringify(paused.checkpoint)),
      checkInApproved({ request: pausedRequest(paused), by: 'test host' }),
    );
    expect(f.calls).toEqual([exact]);
  });

  it('keeps the frozen admission when the same turn retries from its saved reading', async () => {
    const first = fixture({ proposals: [] });
    await first.agent.run({ message: phrase, time: { now } });
    const stored = first.agent.checkpoint();
    if (stored === undefined) throw new Error('Expected a saved reading.');
    const retry = fixture({ change: restoreDuration });
    await retry.agent.resumeOnError(
      { ...stored, history: stored.history.slice(0, 1) },
      { time: { now } },
    );
    expect(retry.calls).toEqual([]);
    expect(
      retry.agent.checkpoint()?.history.find((message) => message.role === 'tool'),
    ).toMatchObject({ outcome: 'refused', content: expect.stringMatching(/frozen look-back/) });
  });
});
