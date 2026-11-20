import { expect, it } from 'vitest';
import { z } from 'zod';
import { absent, Agent, askHuman, coverage, defineTool, isPaused } from '../../../index.js';
import { mock } from '../../../llm-providers.js';
import { readTurnCoverage, recordRun, type Recording } from '../../../observe.js';

function tool(name: string, execute: () => unknown) {
  return defineTool({
    name,
    description: 'Read fixture records.',
    inputSchema: { type: 'object' },
    execute,
  });
}

const call = (name: string, id: string) => ({ id, name, args: {} });
function terminalId(recording: Recording): string {
  const terminal = recording.events.find((event) => event.type === 'agentfootprint.agent.turn_end');
  if (terminal === undefined) throw new Error('Expected a completed turn');
  return terminal.meta.runId;
}

async function finished(agent: Agent): Promise<Recording> {
  const recorder = recordRun(agent);
  try {
    await agent.run('Read the fixture records.');
    return recorder.toRecording();
  } finally {
    recorder.stop();
  }
}

it.each([
  [false, false],
  [false, true],
  [true, false],
  [true, true],
])('reads committed declarations with typed=%s and limits=%s', async (typed, limits) => {
  const id = 'full-fixture-call-id';
  const builder = Agent.create({
    provider: mock({
      replies: [
        { toolCalls: [call('lookup', id)] },
        { content: typed ? '{"found":false}' : 'The lookup finished.' },
      ],
    }),
    model: 'mock',
  }).tool(
    tool('lookup', () =>
      coverage(absent({ what: 'records', checked: ['source'] }), {
        checked: ['source'],
        notChecked: ['older records'],
        cannotCover: [{ what: 'external records', why: 'the fixture has no external index' }],
      }),
    ),
  );
  if (limits) builder.limitsTravelWithTheAnswer();
  if (typed) builder.outputSchema(z.object({ found: z.boolean() }));
  const record = await finished(builder.build());
  const expected = [{ toolCallId: id, declarations: 2, checked: 2, notChecked: 1, cannotCover: 1 }];
  expect(readTurnCoverage(record, terminalId(record))).toEqual(expected);
  expect(
    readTurnCoverage(JSON.parse(JSON.stringify(record)) as Recording, terminalId(record)),
  ).toEqual(expected);
});

it('counts a composed search facet that rides the event only as a reference', async () => {
  const lookup = defineTool({
    name: 'lookup',
    description: 'Read fixture records.',
    inputSchema: { type: 'object', properties: { port: { type: 'string' } }, required: ['port'] },
    effects: 'read',
    search: {
      source: { what: 'the fixture store', said: ['the fixture store'] },
      subject: { what: 'records', said: ['records'] },
      arguments: [{ name: 'port', role: 'population' }],
      complete: 'within-arguments',
    },
    execute: () => absent({ what: 'records', checked: 'declared' }),
  });
  const record = await finished(
    Agent.create({
      provider: mock({
        replies: [
          { toolCalls: [{ id: 'composed', name: 'lookup', args: { port: 'port-a' } }] },
          { content: 'The lookup finished.' },
        ],
      }),
      model: 'mock',
    })
      .tool(lookup)
      .build(),
  );
  const declaration = record.events.find((event) => event.type === 'agentfootprint.tools.absent');
  expect(declaration?.payload.checked).toHaveLength(2);
  expect(readTurnCoverage(record, terminalId(record))).toEqual([
    { toolCallId: 'composed', declarations: 1, checked: 3, notChecked: 0, cannotCover: 0 },
  ]);
});

it('keeps repeated IDs distinct, including within the same dispatch', async () => {
  const id = 'reused';
  const record = await finished(
    Agent.create({
      provider: mock({
        replies: [
          { toolCalls: [call('lookup', id), call('lookup', id)] },
          { toolCalls: [call('lookup', id)] },
          { content: 'The lookup finished.' },
        ],
      }),
      model: 'mock',
    })
      .tool(
        tool(
          'lookup',
          (() => {
            let result = 0;
            return () =>
              coverage(
                { ok: true },
                { checked: Array.from({ length: ++result }, (_, i) => `source ${i}`) },
              );
          })(),
        ),
      )
      .build(),
  );
  expect(readTurnCoverage(record, terminalId(record))).toEqual(
    [1, 2, 3].map((checked) => ({
      toolCallId: id,
      declarations: 1,
      checked,
      notChecked: 0,
      cannotCover: 0,
    })),
  );
});

it('reads only newly committed declarations when the resumed leg reuses a provider ID', async () => {
  const agent = Agent.create({
    provider: mock({
      replies: [
        { toolCalls: [call('lookup', 'reused')] },
        { toolCalls: [call('ask', 'year')] },
        { toolCalls: [call('lookup', 'reused')] },
        { content: 'The lookup finished.' },
      ],
    }),
    model: 'mock',
  })
    .tools([
      tool('lookup', () => coverage({ ok: true }, { checked: ['source'] })),
      tool('ask', () => askHuman({ question: 'Which year?' })),
    ])
    .build();
  const recorder = recordRun(agent);
  try {
    const paused = await agent.run('Read the fixture records.');
    if (!isPaused(paused)) throw new Error('Expected a pause');
    await agent.resume(paused.checkpoint, '2026');
    const record = recorder.toRecording();
    expect(readTurnCoverage(record, terminalId(record))).toEqual([
      { toolCallId: 'reused', declarations: 1, checked: 1, notChecked: 0, cannotCover: 0 },
    ]);
    const snapshot = { ...(record.snapshot as Record<string, unknown>) };
    expect(snapshot.initialState).toHaveProperty('coverageDeclared');
    delete snapshot.initialState;
    expect(readTurnCoverage({ ...record, snapshot }, terminalId(record))).toBeUndefined();
  } finally {
    recorder.stop();
  }
});

it('rejects a later snapshot paired with the earlier events and proves empty on the later leg', async () => {
  const agent = Agent.create({
    provider: mock({
      replies: [
        { toolCalls: [call('lookup', 'first')] },
        { content: 'The lookup finished.' },
        { content: 'No tool was needed.' },
      ],
    }),
    model: 'mock',
  })
    .tool(tool('lookup', () => coverage({ ok: true }, { checked: ['source'] })))
    .build();
  const first = await finished(agent);
  const next = await finished(agent);
  expect(readTurnCoverage(next, terminalId(next))).toEqual([]);
  expect(readTurnCoverage(next, terminalId(first))).toBeUndefined();
  expect(
    readTurnCoverage({ ...first, snapshot: next.snapshot }, terminalId(first)),
  ).toBeUndefined();
  expect(readTurnCoverage(first, terminalId(first))).toHaveLength(1);
});

it('places keyed coverage without its declaration event and preserves keyless or hidden state', async () => {
  const build = (redact: boolean) =>
    Agent.create({
      provider: mock({
        replies: [{ toolCalls: [call('lookup', 'fixture')] }, { content: 'The lookup finished.' }],
      }),
      model: 'mock',
      ...(redact && { redact: { keys: ['coverageDeclared'] } }),
    })
      .tool(tool('lookup', () => coverage({ ok: true }, { checked: ['source'] })))
      .build();
  const full = await finished(build(false));
  const partial = {
    ...full,
    events: full.events.filter((event) => event.type !== 'agentfootprint.tools.coverage_declared'),
  };
  expect(readTurnCoverage(partial, terminalId(full))).toEqual([
    { toolCallId: 'fixture', declarations: 1, checked: 1, notChecked: 0, cannotCover: 0 },
  ]);
  const legacy = JSON.parse(
    JSON.stringify(partial, (key, value: unknown) =>
      key === 'callOccurrenceKey' ? undefined : value,
    ),
  ) as Recording;
  expect(readTurnCoverage(legacy, terminalId(full))).toEqual([
    { declarations: 1, checked: 1, notChecked: 0, cannotCover: 0 },
  ]);
  const hidden = await finished(build(true));
  expect(readTurnCoverage(hidden, terminalId(hidden))).toBeUndefined();
});
