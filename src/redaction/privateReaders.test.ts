import { expect, it } from 'vitest';
import { Agent, defineTool, servedViews } from '../index.js';
import { accountForAnswer, assessAnswer, recordRun } from '../observe.js';
import { runnerLive } from '../core/runnerLive.js';
import { SHOWN_ARGS } from '../core/toolShownArgs.js';
import { declarationOf } from './declared.js';
import { servedUnderPolicy } from './marker.js';
import { answer, scripted } from '../../test/core/agent/arguments/askReviewHarness.js';
import { nativeRetainsSafeBase } from '../../test/redaction/nativeFoldBase.js';
import defaultAnswerShapes from '../../test/redaction/fixtures/context-shapes/private-readers.json';

it('with shapes off nothing changes; the default adds the pinned index for a public answer', async () => {
  const mock = scripted([answer('Public answer')]);
  const agent = Agent.create({ provider: mock.provider as never, model: 'fixture' }).build();
  try {
    await agent.run({ message: 'Public question' });
    const raw = runnerLive(agent)?.liveSnapshot();
    const served = agent.getSnapshot();
    expect(raw).toBeDefined();
    expect(JSON.stringify(agent.getSnapshot({ contextShapes: false }))).toBe(JSON.stringify(raw));
    expect(JSON.stringify(served)).toBe(
      JSON.stringify({ ...raw, contextShapes: defaultAnswerShapes }),
    );
    expect(servedUnderPolicy(served)).toBe(false);
    expect(served).toHaveProperty('initialState');
    expect(served?.sharedState).not.toHaveProperty('privateRecordFields');
  } finally {
    await agent.shutdown();
  }
});

it('private-only native coverage keeps public facts readable and separates privacy from its native fold base', async () => {
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
    expect(runnerLive(agent)?.liveSnapshot()?.sharedState.runRedaction).toEqual({
      version: 1,
      caller: 'none',
    });
    const recording = recorder.toRecording();
    expect(declarationOf(agent)).toEqual({ state: 'declared-none' });
    expect(servedUnderPolicy(recording.snapshot)).toBe(true);
    const hasBase = await nativeRetainsSafeBase();
    expect(recording.snapshot.initialState).toEqual(hasBase ? {} : undefined);
    const views = servedViews(recording.snapshot);
    expect(views.length).toBeGreaterThan(0);
    expect(views.some((view) => view.gaps.some((gap) => gap.gap === 'no-fold-base'))).toBe(
      !hasBase,
    );
    expect(views.every((view) => view.gaps.some((gap) => gap.gap === 'privacy-policy'))).toBe(true);
    expect(views[0]?.tools.names).toContain('lookup');
    expect(views[0]?.messages.asSent.some((message) => message.content === 'Public question')).toBe(
      true,
    );
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
