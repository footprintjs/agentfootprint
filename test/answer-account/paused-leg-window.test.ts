import { expect, it } from 'vitest';

import { Agent, defineTool, isInputPause, requestInput, slidingWindow } from '../../src/index.js';
import { mock } from '../../src/llm-providers.js';
import { accountForAnswer, recordRun } from '../../src/observe.js';
import type { Recording } from '../../src/recorders/observability/recordRun.js';
import { assertP1 } from './helpers.js';

it('says the pre-pause results are unreadable when the window moves after resume', async () => {
  const trim = slidingWindow({ keepRecentTurns: 3 });
  const agent = Agent.create({
    provider: mock({
      replies: [
        { content: 'Earlier answer.' },
        { toolCalls: [{ id: 'read', name: 'list_items', args: {} }] },
        { toolCalls: [{ id: 'choose', name: 'ask_year', args: {} }] },
        { content: 'Final answer.' },
      ],
    }),
    model: 'mock',
  })
    .tools([
      defineTool({
        name: 'list_items',
        description: 'List fixture items.',
        inputSchema: { type: 'object', properties: {} },
        execute: () => ['a', 'b'],
      }),
      defineTool({
        name: 'ask_year',
        description: 'Ask for the year.',
        inputSchema: { type: 'object', properties: {} },
        execute: () =>
          requestInput({
            id: 'year',
            question: 'Which year?',
            fields: [{ id: 'year', type: 'number', required: true }],
          }),
      }),
    ])
    .window({
      name: 'slide-after-input',
      async plan(input) {
        if (
          input.history.some(
            (message) => message.role === 'tool' && message.toolCallId === 'choose',
          )
        ) {
          return trim.plan(input);
        }
        return undefined;
      },
    })
    .build();
  const recorder = recordRun(agent);
  try {
    await agent.run('Earlier question.');
    const paused = await agent.followUp('List the items.');
    if (!isInputPause(paused)) throw new Error('expected a pause to ask for the year');
    await agent.resume(paused.checkpoint, {
      requestId: paused.awaitingInput.requestId,
      values: { year: 2026 },
    });
    const recording = JSON.parse(JSON.stringify(recorder.toRecording())) as Recording;
    const snapshot = recording.snapshot as {
      initialState: { history: { content: string }[] };
      sharedState: { history: { content: string; toolCallId?: string }[] };
    };
    expect(snapshot.initialState.history[0]?.content).toBe('Earlier question.');
    expect(snapshot.sharedState.history[0]?.content).toBe('List the items.');
    expect(snapshot.sharedState.history.map((message) => message.toolCallId)).toContain('read');

    const runId = recording.events.findLast((e) => e.type === 'agentfootprint.agent.turn_end')?.meta
      .runId;
    if (runId === undefined) throw new Error('expected the resumed run to finish');
    const account = accountForAnswer(recording, undefined, { runId });
    const unmatched =
      'This record cannot match tool results from before the pause to its final history.';
    assertP1(account, recording, {});
    expect(account.run.value?.resumedLeg).toBe(true);
    for (const row of ['checked', 'not-checked', 'found', 'anything-wrong']) {
      const lines = account.rows.find((r) => r.id === row)?.lines;
      expect(lines).toContainEqual(
        expect.objectContaining({
          text: unmatched,
          status: 'not-recorded',
          missing: 'unreadable',
          pointers: [],
        }),
      );
      expect(lines?.map((line) => line.template.id)).not.toContain('beforePause.noResults');
    }
    expect(account.summary.sentence.text).toContain(unmatched);
    expect(account.facts.beforePause).toEqual([]);
    expect(account.facts.checks.unreachable).toEqual(
      expect.arrayContaining(['existence', 'empty-results']),
    );
    expect(account.summary.tone).toBe('unknown');
  } finally {
    recorder.stop();
  }
});
