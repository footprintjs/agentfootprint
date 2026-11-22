import { describe, expect, it } from 'vitest';
import { Agent, defineTool, isPaused } from '../../../../../index.js';
import { mock } from '../../../../../llm-providers.js';
import { assessAnswer, recordRun } from '../../../../../observe.js';
import { answerCompletionReasons } from './completion.js';

const prose = 'The first thing to do is';
const reason = 'answer-output-limit';
const line = "the answer was cut off at the model's output limit";
const key = 'llmLatestStopReason';

it('keeps the turn limit distinct from the model output limit', () => {
  expect(answerCompletionReasons({ stoppedEarly: { iteration: 2 }, [key]: 'max_tokens' })).toEqual([
    {
      reason: 'stopped-early',
      witness: { kind: 'state', key: 'stoppedEarly', path: '/iteration' },
    },
    { reason, witness: { kind: 'state', key, path: '' } },
  ]);
});

it('a paused tool call has no answer to warn about yet', () => {
  const checkpoint = { sharedState: { [key]: 'max_tokens', pausedToolCallId: 'lookup-1' } };
  expect(assessAnswer({ checkpoint })).toMatchObject({
    standing: 'ask',
    reasons: [{ reason: 'asked' }],
  });
  expect(answerCompletionReasons(checkpoint.sharedState)).toEqual([]);
});

describe.each(['classic', 'dynamic', 'dynamic-grouped'] as const)('%s', (reactMode) => {
  it('does not add a stop key to an ordinary prose recording', async () => {
    const agent = Agent.create({
      provider: mock({ reply: prose, stopReason: 'stop' }),
      model: 'mock',
      reactMode,
    }).build();
    const recorder = recordRun(agent);
    try {
      expect(await agent.run({ message: 'What should I do?' })).toBe(prose);
      const recording = JSON.parse(JSON.stringify(recorder.toRecording()));
      expect(Object.hasOwn(recording.snapshot.sharedState, key)).toBe(false);
      expect(assessAnswer(recording).reasons.map((entry) => entry.reason)).not.toContain(reason);
    } finally {
      recorder.stop();
      await agent.shutdown();
    }
  });

  it.each(['full', 'delta'] as const)(
    'explains a truncated answer in a %s recording',
    async (commitValues) => {
      const agent = Agent.create({
        provider: mock({ reply: prose, stopReason: 'max_tokens' }),
        model: 'mock',
        reactMode,
        commitValues,
      }).build();
      const recorder = recordRun(agent);
      const answer = await agent.run({ message: 'What should I do?' });
      const recording = JSON.parse(JSON.stringify(recorder.toRecording()));
      recorder.stop();
      expect(answer).toContain(line);
      expect(recording.snapshot.sharedState[key]).toBe('max_tokens');
      const saved = assessAnswer(recording);
      expect(saved).toEqual(await agent.assessment());
      expect(saved).toMatchObject({
        standing: 'not-sure',
        reasons: [
          {
            reason,
            layer: 4,
            witness: [{ kind: 'state', key, path: '' }],
          },
        ],
      });
    },
  );

  it('replaces a tool-bearing response’s limit with the delivered response’s stop', async () => {
    const agent = Agent.create({
      provider: mock({
        replies: [
          { toolCalls: [{ id: '1', name: 'lookup', args: {} }], stopReason: 'max_tokens' },
          { content: prose, stopReason: 'stop' },
        ],
      }),
      model: 'mock',
      reactMode,
    })
      .tool(
        defineTool({
          name: 'lookup',
          description: 'Look up a fact',
          inputSchema: { type: 'object' },
          execute: () => 'a fact',
        }),
      )
      .build();
    expect(await agent.run({ message: 'What should I do?' })).toBe(prose);
    expect(agent.getLastSnapshot()?.sharedState[key]).toBeUndefined();
    expect((await agent.assessment())?.reasons.map((entry) => entry.reason)).not.toContain(reason);
  });

  it('reports only the pending argument after a cutoff, including after save and resume', async () => {
    const agent = Agent.create({
      provider: mock({
        replies: [
          { toolCalls: [{ id: '1', name: 'lookup', args: {} }], stopReason: 'max_tokens' },
          { content: prose, stopReason: 'stop' },
        ],
      }),
      model: 'mock',
      reactMode,
    })
      .tool(
        defineTool({
          name: 'lookup',
          description: 'Read the logs over a period',
          inputSchema: {
            type: 'object',
            required: ['period'],
            properties: { period: { type: 'string', enum: ['1h', '24h'] } },
          },
          askOrAssume: {
            period: { ask: 'Which period should I read?', choices: ['1h', '24h'] },
          },
          execute: () => [],
        }),
      )
      .answerLayer()
      .build();
    const recorder = recordRun(agent);
    try {
      const paused = await agent.run({ message: 'What do the logs show?' });
      if (!isPaused(paused)) throw new Error('Expected an argument pause.');
      const recording = JSON.parse(JSON.stringify(recorder.toRecording()));
      const saved = assessAnswer(recording);
      expect(saved).toMatchObject({ standing: 'ask', reasons: [{ reason: 'argument-asked' }] });
      expect(await agent.assessment()).toEqual(saved);
      const request = paused.awaitingInput;
      if (request?.fields[0] === undefined) throw new Error('Expected a period input.');
      await expect(
        agent.resume(JSON.parse(JSON.stringify(paused.checkpoint)), {
          requestId: request.requestId,
          values: { [request.fields[0].id]: '24h' },
        }),
      ).resolves.toBe(prose);
      expect((await agent.assessment())?.reasons.map((entry) => entry.reason)).not.toContain(
        reason,
      );
    } finally {
      recorder.stop();
      await agent.shutdown();
    }
  });
});

it('uses the final cutoff after two tool calls in a large thinking-enabled turn', async () => {
  const stops = ['tool_use', 'tool_use', 'max_tokens'] as const;
  const budgets: (number | undefined)[] = [];
  let toolRuns = 0;
  const provider = mock({
    chunkDelayMs: 0,
    respond: (request) => {
      const stopReason = stops[budgets.length];
      if (stopReason === undefined) throw new Error('Unexpected provider call');
      budgets.push(request.thinking?.budget);
      return {
        stopReason,
        usage: { input: 80_000, output: stopReason === 'max_tokens' ? 4_096 : 128, thinking: 96 },
        ...(stopReason === 'tool_use'
          ? { toolCalls: [{ id: `lookup-${budgets.length}`, name: 'lookup', args: {} }] }
          : { content: prose }),
      };
    },
  });
  const agent = Agent.create({ provider, model: 'mock', reactMode: 'dynamic-grouped' })
    .thinking({ budget: 1_024 })
    .tool(
      defineTool({
        name: 'lookup',
        description: 'Read the next log segment',
        inputSchema: { type: 'object' },
        execute: () => `Log segment ${++toolRuns}`,
      }),
    )
    .build();
  const providerStops: string[] = [];
  agent.on('agentfootprint.stream.llm_end', ({ payload }) =>
    providerStops.push(payload.stopReason),
  );
  const recorder = recordRun(agent);
  try {
    expect(await agent.run({ message: 'What do the logs show?' })).toContain(line);
    expect(budgets).toEqual([1_024, 1_024, 1_024]);
    expect(toolRuns).toBe(2);
    expect(providerStops).toEqual(stops);
    const recording = JSON.parse(JSON.stringify(recorder.toRecording()));
    expect(recording.snapshot.sharedState[key]).toBe('max_tokens');
    const saved = assessAnswer(recording);
    expect(saved).toEqual(await agent.assessment());
    expect(saved.reasons.filter((entry) => entry.reason === reason)).toHaveLength(1);
  } finally {
    recorder.stop();
    await agent.shutdown();
  }
});

it.each([
  undefined,
  'stop',
  'stop_sequence',
  'refusal',
  'content_filter',
  { stopReason: 'max_tokens' },
])('does not infer a limit from %j or from telemetry', (stopReason) => {
  const snapshot = { sharedState: { [key]: stopReason } };
  const events = [{ type: 'agentfootprint.stream.llm_end', payload: { stopReason: 'max_tokens' } }];
  const baseline = assessAnswer({ snapshot: { sharedState: {} } });
  expect(assessAnswer({ snapshot, events } as Parameters<typeof assessAnswer>[0])).toEqual(
    baseline,
  );
});

it('keeps the prose exact with the answer layer disabled and still records the limit', async () => {
  const agent = Agent.create({
    provider: mock({ reply: prose, stopReason: 'max_tokens' }),
    model: 'mock',
  })
    .answerLayer(false)
    .build();
  expect(await agent.run({ message: 'What should I do?' })).toBe(prose);
  expect(agent.getLastSnapshot()?.sharedState[key]).toBe('max_tokens');
  expect((await agent.assessment())?.reasons.map((entry) => entry.reason)).toContain(reason);
});

it('can report the warning as data without appending any text', async () => {
  const agent = Agent.create({
    provider: mock({ reply: prose, stopReason: 'max_tokens' }),
    model: 'mock',
  })
    .answerLayer()
    .build();
  const ends: unknown[] = [];
  agent.on('agentfootprint.agent.turn_end', (event) => ends.push(event.payload.answerAssessment));
  expect(await agent.run({ message: 'What should I do?' })).toBe(prose);
  expect(ends).toEqual([expect.objectContaining({ standing: 'not-sure', reasons: [reason] })]);
});
