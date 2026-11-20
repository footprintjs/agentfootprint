import { expect, it } from 'vitest';
import { absent, Agent, allow, coverage, defineTool, isInputPause } from '../../../src/index.js';
import { mock } from '../../../src/llm-providers.js';
import { accountForAnswer, assessAnswer, recordRun, type Recording } from '../../../src/observe.js';
import type { AgentfootprintEvent } from '../../../src/events/registry.js';
import type { ArgumentRow } from '../../../src/core/agent/arguments/rows.js';
import type { LLMMessage } from '../../../src/provider-contract/types.js';
import { readCallOccurrenceKey } from '../../../src/lib/callOccurrence.js';

interface ShelfArgs {
  readonly n: number;
  readonly window: string;
  readonly unit: string;
}

function positions(rows: readonly object[] = []): (number | null)[] {
  return rows.map((row) => {
    const key = readCallOccurrenceKey(row);
    return typeof key === 'string' ? Number(key.split('.').at(-1)) : null;
  });
}

async function countShelves(
  ids: readonly [string, string],
  argumentsByCall: readonly Readonly<Record<string, unknown>>[],
  options: { argumentSources?: boolean; answerWindow?: string; expectBatchRefusal?: true } = {},
) {
  const { argumentSources = false, answerWindow } = options;
  const ran: ShelfArgs[] = [];
  const tool = defineTool<ShelfArgs, unknown>({
    name: 'count',
    description: 'Count items on a fixture shelf.',
    inputSchema: {
      type: 'object',
      required: ['n', 'window', 'unit'],
      properties: { n: { type: 'integer' }, window: { type: 'string' }, unit: { type: 'string' } },
    },
    askOrAssume: {
      window:
        answerWindow === undefined
          ? { assume: '2h' }
          : { ask: 'Which period should this shelf cover?', choices: ['2h', '4h'] },
      unit: { assume: 'boxes' },
    },
    execute: (args) => {
      ran.push({ ...args });
      return args.n === 1
        ? absent({ what: 'items on shelf A', checked: ['shelf A'] })
        : coverage([{ shelf: args.n }], { checked: ['shelf B'], notChecked: ['shelf C'] });
    },
  });
  const agent = Agent.create({
    provider: mock({
      replies: [
        {
          toolCalls: ids.map((id, index) => ({
            id,
            name: 'count',
            args: argumentsByCall[index] ?? {},
          })),
        },
        { content: 'Counted.' },
      ],
    }),
    model: 'mock',
    permissionChecker: { name: 'fixture', check: async () => ({ result: 'allow' }) },
  })
    .tool(tool)
    .toolMiddleware({ name: 'fixture-observer', onToolCall: () => allow() })
    .inputsLayer({ argumentSources })
    .answerLayer({ standingLine: true })
    .build();
  const recorder = recordRun(agent);
  try {
    const outcome = await agent.run({
      message: 'Count the fixture shelves using crates and a 4h window.',
    });
    if (options.expectBatchRefusal === true) {
      expect(outcome).toEqual(expect.stringMatching(/^Counted\./));
      expect(ran).toEqual([]);
    } else if (answerWindow !== undefined) {
      if (!isInputPause(outcome)) {
        const outcomeKind = typeof outcome === 'string' ? 'an answer' : 'another pause';
        throw new Error(`Expected an input pause. Got ${outcomeKind} after ${ran.length} calls.`);
      }
      expect(ran).toEqual([]);
      const request = outcome.awaitingInput;
      expect(request.fields.map((field) => field.id)).toEqual(['f1']);
      await agent.resume(JSON.parse(JSON.stringify(outcome.checkpoint)), {
        requestId: request.requestId,
        values: { f1: answerWindow },
      });
    }
    const recording = JSON.parse(JSON.stringify(recorder.toRecording())) as Recording;
    const { sharedState } = recording.snapshot as {
      sharedState: {
        history: readonly LLMMessage[];
        findingsLedger: readonly ArgumentRow[];
        toolResults: readonly object[];
        messagesInjections: readonly { source: string }[];
        coverageDeclared?: readonly object[];
        middlewareDecisions?: readonly object[];
      };
    };
    const events = (type: AgentfootprintEvent['type']) =>
      recording.events.filter((event) => event.type === type).map(({ payload }) => payload);
    const argumentRows = sharedState.findingsLedger.filter((row) => row.kind === 'argument');
    const history = sharedState.history;
    const resultKeys = history.filter((entry) => entry.role === 'tool');
    const families = {
      acceptedProposals: positions(history.flatMap((entry) => entry.toolCalls ?? [])),
      historyResults: positions(resultKeys),
      toolResults: positions(sharedState.toolResults),
      messagesInjections: positions(
        sharedState.messagesInjections.filter((entry) => entry.source === 'tool-result'),
      ),
      toolStarts: positions(events('agentfootprint.stream.tool_start')),
      toolEnds: positions(events('agentfootprint.stream.tool_end')),
      requestWitnesses: positions(
        recording.events.flatMap((event) =>
          event.type === 'agentfootprint.context.injected' && event.payload.source === 'tool-result'
            ? [event.payload]
            : [],
        ),
      ),
      coverageRows: positions(sharedState.coverageDeclared),
      absenceEvents: positions(events('agentfootprint.tools.absent')),
      coverageEvents: positions(events('agentfootprint.tools.coverage_declared')),
      permissionEvents: positions(events('agentfootprint.permission.check')),
      middlewareRows: positions(sharedState.middlewareDecisions),
      middlewareEvents: positions(events('agentfootprint.middleware.decision')),
      argumentRows: positions(argumentRows),
      argumentEvents: positions(events('agentfootprint.findings.argument')),
    };
    return {
      ran,
      recording,
      families,
      argumentRows,
      resultKeys: resultKeys.map(readCallOccurrenceKey),
    };
  } finally {
    recorder.stop();
    await agent.shutdown();
  }
}

it('records each assumed argument under its own accepted batch position', async () => {
  const args = [{ n: 1 }, { n: 2 }];
  const unique = await countShelves(['first', 'second'], args);
  const reused = await countShelves(['same', 'same'], args);
  expect(unique.families).toEqual({
    acceptedProposals: [0, 1],
    historyResults: [0, 1],
    toolResults: [0, 1],
    messagesInjections: [0, 1],
    toolStarts: [0, 1],
    toolEnds: [0, 1],
    requestWitnesses: [0, 1],
    coverageRows: [0, 1],
    absenceEvents: [0],
    coverageEvents: [1],
    permissionEvents: [0, 1],
    middlewareRows: [0, 1],
    middlewareEvents: [0, 1],
    argumentRows: [0, 0, 1, 1],
    argumentEvents: [0, 0, 1, 1],
  });
  expect.soft(reused.families).toEqual(unique.families);

  for (const run of [unique, reused]) {
    expect
      .soft(run.argumentRows.map((row) => run.resultKeys.indexOf(readCallOccurrenceKey(row))))
      .toEqual([0, 0, 1, 1]);
    const assumed = assessAnswer(run.recording).reasons.find(
      (row) => row.reason === 'argument-assumed',
    );
    expect.soft(assumed?.witness).toEqual(
      [0, 1, 2, 3].map((index) => ({
        kind: 'state',
        key: 'findingsLedger',
        path: `/${index}/argument`,
      })),
    );
    expect
      .soft(accountForAnswer(run.recording).rows.find(({ id }) => id === 'how-sure')?.lines)
      .toContainEqual(
        expect.objectContaining({
          text: expect.stringContaining('4 values the calls ran with were assumed'),
        }),
      );
  }
});

it.each([false, true])(
  'keeps different fills with their own call (declared sources %s)',
  async (argumentSources) => {
    const fromPerson = (argument: string, quote: string) =>
      argumentSources ? { _findings: { from: [{ argument, source: 'user', quote }] } } : {};
    const args = [
      { n: 1, unit: 'crates', ...fromPerson('unit', 'crates') },
      { n: 2, window: '4h', ...fromPerson('window', '4h') },
    ];
    const unique = await countShelves(['first', 'second'], args, { argumentSources });
    const reused = await countShelves(['same', 'same'], args, { argumentSources });
    const expected = [
      { n: 1, window: '2h', unit: 'crates' },
      { n: 2, window: '4h', unit: 'boxes' },
    ];
    expect(unique.ran).toEqual(expected);
    expect.soft(reused.ran).toEqual(expected);
    const values = ({ argumentRows, resultKeys }: Awaited<ReturnType<typeof countShelves>>) =>
      argumentRows.map((row) => [
        resultKeys.indexOf(readCallOccurrenceKey(row)),
        row.argument,
        row.value,
        row.source,
      ]);
    const suppliedSource = argumentSources ? 'said' : 'model';
    expect(values(unique)).toEqual([
      [0, 'window', '2h', 'default'],
      [0, 'unit', 'crates', suppliedSource],
      [1, 'window', '4h', suppliedSource],
      [1, 'unit', 'boxes', 'default'],
    ]);
    expect.soft(values(reused)).toEqual(values(unique));
  },
);

it('keeps valid, incorrect, and malformed declarations with the call that sent them', async () => {
  const args = [
    {
      n: 1,
      unit: 'crates',
      _findings: { from: [{ argument: 'unit', source: 'user', quote: 'crates' }] },
    },
    {
      n: 2,
      unit: 'baskets',
      _findings: {
        from: [
          { argument: 'unit', source: 'user', quote: 'baskets' },
          { argument: 'unit', source: 'user' },
        ],
      },
    },
  ];
  const options = { argumentSources: true };
  const unique = await countShelves(['first', 'second'], args, options);
  const reused = await countShelves(['same', 'same'], args, options);
  const claims = ({ argumentRows, resultKeys }: Awaited<ReturnType<typeof countShelves>>) =>
    argumentRows.map((row) => [
      resultKeys.indexOf(readCallOccurrenceKey(row)),
      row.argument,
      row.source,
      row.quote,
      row.failed,
      row.malformed,
    ]);
  expect(claims(unique)).toEqual([
    [0, 'window', 'default', undefined, undefined, undefined],
    [0, 'unit', 'said', 'crates', undefined, undefined],
    [1, 'window', 'default', undefined, undefined, 1],
    [1, 'unit', 'model', 'baskets', 'quote-not-found', undefined],
  ]);
  expect(claims(reused)).toEqual(claims(unique));
});

it('binds the answer to its proposal and preserves duplicate-ID refusal before a human ask', async () => {
  const args = [{ n: 1, window: '4h' }, { n: 2 }];
  const unique = await countShelves(['first', 'second'], args, { answerWindow: '2h' });
  expect(unique.ran).toEqual([
    { n: 1, window: '4h', unit: 'boxes' },
    { n: 2, window: '2h', unit: 'boxes' },
  ]);
  const asked = ({ argumentRows, resultKeys }: Awaited<ReturnType<typeof countShelves>>) =>
    argumentRows
      .filter((row) => row.argument === 'window' && (row.asked || row.source === 'answered'))
      .map((row) => [
        resultKeys.indexOf(readCallOccurrenceKey(row)),
        row.asked,
        row.source,
        row.value,
      ]);
  expect(asked(unique)).toEqual([
    [1, 'missing', undefined, undefined],
    [1, undefined, 'answered', '2h'],
  ]);
  const refused = await countShelves(['same', 'same'], args, {
    answerWindow: '2h',
    expectBatchRefusal: true,
  });
  expect(refused.families.toolStarts).toEqual([]);
  expect(refused.families.historyResults).toEqual([]);
  const { history } = (refused.recording.snapshot as { sharedState: { history: LLMMessage[] } })
    .sharedState;
  expect(history.some((message) => message.content.startsWith('[Tool batch refusal'))).toBe(true);
  expect(refused.argumentRows.filter((row) => row.source === 'answered')).toEqual([]);
  const plannedWindow = refused.argumentRows.filter((row) => row.argument === 'window');
  expect(positions(plannedWindow)).toEqual([0, 1]);
  expect(plannedWindow.map((row) => [row.source, row.value, row.asked])).toEqual([
    ['model', '4h', undefined],
    [undefined, undefined, 'missing'],
  ]);
});
