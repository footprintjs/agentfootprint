import { expect, it } from 'vitest';
import { Agent, defineTool, servedViews } from '../index.js';
import { accountForAnswer, assessAnswer, recordRun } from '../observe.js';
import { runnerLive } from '../core/runnerLive.js';
import { SHOWN_ARGS } from '../core/toolShownArgs.js';
import { declarationOf } from './declared.js';
import { servedUnderPolicy } from './marker.js';
import { answer, scripted } from '../../test/core/agent/arguments/askReviewHarness.js';

it('an agent without a hidden argument keeps the native snapshot bytes and no private fields', async () => {
  const mock = scripted([answer('Public answer')]);
  const agent = Agent.create({ provider: mock.provider as never, model: 'fixture' }).build();
  try {
    await agent.run({ message: 'Public question' });
    const raw = runnerLive(agent)?.liveSnapshot();
    const served = agent.getSnapshot();
    expect(raw).toBeDefined();
    expect(JSON.stringify(served)).toBe(JSON.stringify(raw));
    expect(servedUnderPolicy(served)).toBe(false);
    expect(served).toHaveProperty('initialState');
    expect(served?.sharedState).not.toHaveProperty('privateRecordFields');
  } finally {
    await agent.shutdown();
  }
});

it('private-only native coverage keeps public facts readable and reports its missing fold base', async () => {
  const tool = defineTool({
    name: 'lookup',
    description: 'Public lookup',
    inputSchema: { type: 'object', properties: { account: { type: 'string' } } },
    execute: () => 'found',
  });
  const hidden = {
    ...tool,
    [SHOWN_ARGS]: (args: Record<string, unknown>) =>
      'account' in args ? { ...args, account: 'REDACTED' } : args,
  };
  const mock = scripted([answer('Public answer')]);
  const agent = Agent.create({ provider: mock.provider as never, model: 'fixture' })
    .tool(hidden as never)
    .build();
  const recorder = recordRun(agent);
  try {
    await agent.run({ message: 'Public question' });
    const recording = recorder.toRecording();
    expect(declarationOf(agent)).toEqual({ state: 'declared-none' });
    expect(servedUnderPolicy(recording.snapshot)).toBe(true);
    expect(recording.snapshot).not.toHaveProperty('initialState');
    const views = servedViews(recording.snapshot);
    expect(views.length).toBeGreaterThan(0);
    expect(views.some((view) => view.gaps.some((gap) => gap.gap === 'no-fold-base'))).toBe(true);
    const account = accountForAnswer(recording);
    expect(account.question.status).toBe('recorded');
    expect(account.answer.status).toBe('recorded');
    expect(account.summary.sentence.template.id).not.toBe('scope.keptOut');
    expect(assessAnswer(recording).keptOut).toBeUndefined();
  } finally {
    recorder.stop();
    await agent.shutdown();
  }
});
