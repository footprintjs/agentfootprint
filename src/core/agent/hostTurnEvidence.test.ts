import { expect, it } from 'vitest';

import { Agent } from '../../index.js';
import { mock } from '../../llm-providers.js';
import { runnerLive } from '../runnerLive.js';
import { admitCompletedTurn } from './turnEvidence/admitCompletedTurn.js';

it('keeps completed evidence from its own hosted invocation after a later turn', async () => {
  const agent = Agent.create({
    provider: mock({ replies: [{ content: 'First' }, { content: 'Second' }] }),
    model: 'mock',
  }).build();
  const host = runnerLive(agent)?.turn;
  if (host === undefined) throw new Error('Expected the hosted turn port');
  const first = await host.run('One', undefined, undefined, true);
  const second = await host.run('Two');
  expect(first.output).toBe('First');
  expect(second.output).toBe('Second');
  expect(second.evidence).toBeUndefined();
  const runId = first.conversation?.runId;
  if (runId === undefined || first.evidence === undefined)
    throw new Error('Expected retained evidence');
  expect(runId).not.toBe(second.conversation?.runId);

  const selected = admitCompletedTurn(first.evidence, runId);
  expect(selected).toMatchObject({
    status: 'ready',
    turn: { terminal: { meta: { runId }, payload: { finalContent: 'First' } } },
  });
  expect(first.evidence.events.every((event) => event.meta.runId === runId)).toBe(true);
  expect(admitCompletedTurn(first.evidence, second.conversation!.runId!)).toEqual({
    status: 'turn-unavailable',
  });
});
