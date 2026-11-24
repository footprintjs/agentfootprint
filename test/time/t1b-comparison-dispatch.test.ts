import { expect, it } from 'vitest';
import {
  Agent,
  allow,
  ask,
  checkInApproved,
  defineTool,
  isInputPause,
  isPaused,
  type PeriodForm,
} from '../../src/index.js';
import { pausedRequest } from '../helpers/pausedRequest.js';

const now = '2026-11-13T20:00:00Z';
const confirmed = { from: '2026-11-13T10:00:00Z', to: '2026-11-13T12:00:00Z' };
const shorter = { ...confirmed, to: '2026-11-13T11:50:00Z' };
const different = { from: '2026-11-13T16:00:00Z', to: '2026-11-13T18:00:00Z' };
const tools = ['first', 'second'];
const bounds = {
  kind: 'bounds',
  from: { argument: 'from', as: 'iso' },
  to: { argument: 'to', as: 'iso', edge: 'exclusive' },
} as const satisfies PeriodForm;
const relative = { kind: 'lookback', argument: 'last', signed: false } as const;
const comparison = { tools };

type Args = Record<string, unknown>;

function fixture({
  first = shorter,
  second = confirmed,
  restore = false,
  pause = false,
  relativeOnly = false,
  secondBatch = false,
  encoding = 'delta',
}: {
  first?: Args;
  second?: Args;
  restore?: boolean;
  pause?: boolean;
  relativeOnly?: boolean;
  secondBatch?: boolean;
  encoding?: 'full' | 'delta';
} = {}) {
  const calls: { name: string; args: Args }[] = [];
  const buildSource = (name: string, forms: readonly PeriodForm[]) =>
    defineTool({
      name,
      description: 'Read a synthetic source by time.',
      period: { forms, granularity: '1s' },
      inputSchema: {
        type: 'object',
        properties: {
          from: { type: 'string' },
          to: { type: 'string' },
          last: { type: 'string' },
          flag: { type: 'string' },
        },
        additionalProperties: false,
      },
      askOrAssume: {
        from: { ask: 'From when?' },
        to: { ask: 'Until when?' },
        last: { ask: 'How far back?' },
      },
      execute(args) {
        calls.push({ name, args: { ...args } });
        return typeof args.last === 'string'
          ? 'Connector selected the duration.'
          : 'Connector selected the bounds.';
      },
    });
  let iteration = 0;
  const builder = Agent.create({
    model: 'mock',
    commitValues: encoding,
    provider: {
      name: 'comparison-dispatch-fixture',
      async complete() {
        const callA = { id: 'reused', name: 'first', args: first };
        const callB = { id: secondBatch ? 'reused' : 'other', name: 'second', args: second };
        const toolCalls =
          iteration === 0
            ? secondBatch
              ? [callA]
              : [callA, callB]
            : iteration === 1 && secondBatch
            ? [callB]
            : [];
        iteration++;
        return {
          content: toolCalls.length > 0 ? '' : 'done',
          toolCalls,
          usage: { input: 0, output: 0 },
        };
      },
    },
  })
    .time({ zone: 'UTC' })
    .tool(buildSource('first', [bounds, relative]))
    .tool(buildSource('second', relativeOnly ? [relative] : [bounds, relative]));
  if (restore) {
    builder.toolMiddleware({
      name: 'restore-duration',
      onToolCall: ({ toolName, args }) =>
        toolName === 'second' ? allow({ ...args, last: '2h' }, 'Select the duration.') : allow(),
    });
  }
  if (pause) {
    builder.toolMiddleware({
      name: 'approve-source',
      onToolCall: ({ toolName }) =>
        toolName === 'second' ? ask({ question: 'Read the second source?' }) : allow(),
    });
  }
  return { agent: builder.build(), calls };
}

it('uses one exact range across separate batches and a reused provider call ID', async () => {
  const { agent, calls } = fixture({ second: different, secondBatch: true });
  await agent.run({
    message: 'Compare both sources',
    time: { now, window: confirmed, comparison },
  });
  expect(calls).toEqual(tools.map((name) => ({ name, args: confirmed })));
  const rows = agent.findings().filter((row) => row.kind === 'call-window');
  expect(rows).toMatchObject([
    {
      toolCallId: 'reused',
      toolName: 'first',
      asked: confirmed,
      comparison: { original: shorter, corrected: true },
    },
    {
      toolCallId: 'reused',
      toolName: 'second',
      asked: confirmed,
      comparison: { original: different, corrected: true },
    },
  ]);
  expect(rows[0]?.callOccurrenceKey).not.toEqual(rows[1]?.callOccurrenceKey);
});

it('keeps ordinary mismatches and has no comparison marker without host intent', async () => {
  const { agent, calls } = fixture();
  await agent.run({ message: 'Compare both sources', time: { now, window: confirmed } });
  expect(calls).toEqual([
    { name: 'first', args: shorter },
    { name: 'second', args: confirmed },
  ]);
  expect(agent.findings().filter((row) => row.kind === 'call-window')).toMatchObject([
    { how: 'model-chosen', asked: shorter },
    { how: 'bound', asked: confirmed },
  ]);
  expect(
    agent
      .findings()
      .filter((row) => row.kind === 'call-window')
      .every((row) => row.comparison === undefined),
  ).toBe(true);
});

it('refuses a competing duration added after exact bounds were selected', async () => {
  const { agent, calls } = fixture({ first: confirmed, restore: true });
  await agent.run({
    message: 'Compare both sources',
    time: { now, window: confirmed, comparison },
  });
  expect(calls).toEqual([{ name: 'first', args: confirmed }]);
});

it.each(['full', 'delta'] as const)(
  'asks before either source runs and keeps the confirmed %s checkpoint',
  async (encoding) => {
    const { agent, calls } = fixture({ second: different, secondBatch: true, encoding });
    const paused = await agent.run({ message: 'Compare both sources', time: { now, comparison } });
    if (!isInputPause(paused)) throw new Error('Expected a comparison confirmation.');
    expect(paused.awaitingInput.fields.map((field) => field.id)).toEqual([
      'window',
      'omitUnavailable',
    ]);
    expect(calls).toEqual([]);
    await agent.resume(
      JSON.parse(JSON.stringify(paused.checkpoint)),
      {
        requestId: paused.awaitingInput.requestId,
        values: { window: `${confirmed.from}/${confirmed.to}`, omitUnavailable: true },
      },
      { time: { now, window: different, comparison } },
    );
    expect(calls).toEqual(tools.map((name) => ({ name, args: confirmed })));
    const snapshot = JSON.parse(JSON.stringify(agent.getSnapshot()));
    expect(snapshot.commitValues).toBe(encoding);
    expect(snapshot.sharedState.findingsLedger).toContainEqual(
      expect.objectContaining({
        kind: 'time-answer',
        comparison: true,
        ...confirmed,
      }),
    );
  },
);

it('asks about omitting a relative-only source and dispatches only the exact source', async () => {
  const { agent, calls } = fixture({ relativeOnly: true, second: { last: '2h' } });
  const paused = await agent.run({
    message: 'Compare both sources',
    time: { now, window: confirmed, comparison },
  });
  if (!isInputPause(paused)) throw new Error('Expected the comparison omission question.');
  expect(paused.awaitingInput.fields.map((field) => field.id)).toEqual(['omitUnavailable']);
  expect(calls).toEqual([]);
  await agent.resume(JSON.parse(JSON.stringify(paused.checkpoint)), {
    requestId: paused.awaitingInput.requestId,
    values: { omitUnavailable: true },
  });
  expect(calls).toEqual([{ name: 'first', args: confirmed }]);
});

it('rechecks already-approved middleware arguments on resumed dispatch', async () => {
  const { agent, calls } = fixture({ first: confirmed, restore: true, pause: true });
  const paused = await agent.run({
    message: 'Compare both sources',
    time: { now, window: confirmed, comparison },
  });
  if (!isPaused(paused)) throw new Error('Expected a middleware check-in.');
  await agent.resume(
    JSON.parse(JSON.stringify(paused.checkpoint)),
    checkInApproved({ request: pausedRequest(paused), by: 'test host' }),
  );
  expect(calls).toEqual([{ name: 'first', args: confirmed }]);
});
