import { describe, expect, it } from 'vitest';
import { RedactionRule } from 'footprintjs/advanced';
import { EventDispatcher } from '../../../events/dispatcher.js';
import { createRunRedaction, privateFieldsInForce } from '../../../redaction/runRedaction.js';
import { Agent, Sequence, defineTool, isInputPause } from '../../../index.js';
import { recordRun } from '../../../observe.js';
import { SHOWN_ARGS } from '../../toolShownArgs.js';
import { addPrivateRecordFields } from '../../../redaction/privateFields.js';
import type { ArgumentAskState } from './ask.js';
import type { ArgumentResolution } from './resolve.js';
import {
  markPrivateAsk,
  privateAskSelections,
  privateKeptSelections,
  privateResolutionSelections,
  requirePrivateQuestionSupport,
} from './privateAnswers.js';
import {
  scripted,
  batch,
  answer,
  events,
  replyTo,
  stored,
} from '../../../../test/core/agent/arguments/askReviewHarness.js';

const SECRET = 'PRIVATE-account-R8-fixture';
function maskedTool(execute: (args: Readonly<Record<string, unknown>>) => unknown = () => 'found') {
  const tool = defineTool({
    name: 'lookup',
    description: 'Look up an account',
    inputSchema: {
      type: 'object',
      properties: {
        account: { type: 'string' },
        pin: { type: 'integer' },
        region: { type: 'string' },
      },
    },
    askOrAssume: { account: { ask: 'Account?' }, pin: { ask: 'Pin?' } },
    execute,
  });
  return {
    ...tool,
    [SHOWN_ARGS]: (args: Readonly<Record<string, unknown>>) =>
      args.region === 'eu' && 'account' in args ? { ...args, account: 'REDACTED' } : args,
  };
}
const call = { id: 'one', name: 'lookup', args: { region: 'eu' } };
const rows: ArgumentResolution[] = [
  {
    toolCallId: 'one',
    iteration: 1,
    fills: [
      { argument: 'account', source: 'answered', value: SECRET },
      { argument: 'pin', source: 'answered', value: 42 },
    ],
  },
];
const state: ArgumentAskState = {
  iteration: 1,
  fields: ['account', 'pin'].map((argument) => ({
    type: argument === 'account' ? ('string' as const) : ('number' as const),
    question: argument,
    members: [{ toolName: 'lookup', argument, toolCallIds: ['one'] }],
  })),
  progress: [
    { rounds: 1, answer: SECRET },
    { rounds: 1, answer: 42 },
  ],
};

it('selects actual hidden progress without selecting a public sibling field', () => {
  expect(
    privateAskSelections(state, [call], () => maskedTool(), new Map([['one', rows[0]]])),
  ).toEqual([{ root: 'argumentAsk', path: 'progress.0.answer' }]);
});

it('private progress uses an already resolved default sibling with the accepted answer', () => {
  const noRegion = { ...call, args: {} };
  const base = new Map([
    ['one', { fills: [{ argument: 'region', source: 'default' as const, value: 'eu' }] }],
  ]);
  expect(
    privateAskSelections(state, [noRegion], () => maskedTool(), new Map([['one', rows[0]]]), base),
  ).toEqual([{ root: 'argumentAsk', path: 'progress.0.answer' }]);
});

it('selects converted window fills together with their private source answer', () => {
  const converted: ArgumentAskState = {
    ...state,
    fields: [state.fields[0]],
    progress: [
      {
        rounds: 1,
        answer: SECRET,
        fills: { one: { values: { account: SECRET } } },
      },
    ],
  };
  expect(
    privateAskSelections(converted, [call], () => maskedTool(), new Map([['one', rows[0]]])),
  ).toEqual([
    { root: 'argumentAsk', path: 'progress.0.answer' },
    { root: 'argumentAsk', path: 'progress.0.fills' },
  ]);
});

it('a missing current declaration cannot declassify a bound answer', () => {
  expect(privateAskSelections(state, [call], () => undefined, new Map([['one', rows[0]]]))).toEqual(
    [
      { root: 'argumentAsk', path: 'progress.0.answer' },
      { root: 'argumentAsk', path: 'progress.1.answer' },
    ],
  );
});

it('does not invent private storage when an ordinary original party is unavailable', () => {
  const writes: unknown[] = [];
  const scope = { $setValue: (key: string, value: unknown) => writes.push({ key, value }) };
  expect(() =>
    markPrivateAsk(scope, state, [call], () => undefined, new Map([['one', rows[0]]])),
  ).not.toThrow();
  expect(writes).toEqual([]);
  expect(privateFieldsInForce(scope)).toBeUndefined();
});

it('retains conservative missing-holder privacy when private capability was already admitted', () => {
  const run = createRunRedaction({
    policy: undefined,
    privateFields: addPrivateRecordFields(undefined, []),
    dispatcher: new EventDispatcher(),
    getRunContext: () => ({ runId: 'private-missing-holder' } as never),
  });
  const rule = new RedactionRule(run.recordPolicy);
  const writes: unknown[] = [];
  const scope = { $setValue: (key: string, value: unknown) => writes.push({ key, value }) };
  run.bindScope(scope, { runtimeStageId: 'stage#1', getRedactionRule: () => rule } as never);
  markPrivateAsk(scope, state, [call], () => undefined, new Map([['one', rows[0]]]));
  expect(privateFieldsInForce(scope)?.fields.argumentAsk).toEqual([
    'progress.0.answer',
    'progress.1.answer',
  ]);
  expect(rule.verdict(['argumentAsk'])).toMatchObject({
    kind: 'fields',
    paths: ['progress.0.answer', 'progress.1.answer'],
  });
  expect(writes.length).toBeGreaterThan(0);
});

it('kept privacy follows tool/argument/turn across reorder, never matching secret content', () => {
  const hidden = { turn: 2, toolName: 'lookup', argument: 'account', value: SECRET };
  const publicRow = { turn: 2, toolName: 'other', argument: 'region', value: SECRET };
  const prior = addPrivateRecordFields(undefined, [
    { root: 'argumentAnswersKept', path: '0.value' },
  ]);
  expect(privateKeptSelections(prior, [hidden, publicRow], [publicRow, hidden], 2)).toEqual([
    { root: 'argumentAnswersKept', path: '1.value' },
  ]);
  expect(privateKeptSelections(prior, [hidden, publicRow], [publicRow], 2)).toEqual([]);
  expect(privateKeptSelections(prior, [hidden], [{ ...hidden, turn: 3 }], 3)).toEqual([]);
});

it('new kept privacy uses real public context and leaves a public fill visible', () => {
  const after = (rows[0].fills ?? []).map((fill) => ({
    turn: 2,
    toolName: 'lookup',
    argument: fill.argument,
    value: fill.value,
  }));
  expect(
    privateKeptSelections(undefined, undefined, after, 2, {
      toolName: 'lookup',
      tool: maskedTool(),
      args: { region: 'eu', account: SECRET, pin: 42 },
    }),
  ).toEqual([{ root: 'argumentAnswersKept', path: '0.value' }]);
  expect(
    privateKeptSelections(undefined, undefined, after, 2, {
      toolName: 'lookup',
      tool: maskedTool(),
      args: { region: 'public', account: SECRET, pin: 42 },
    }),
  ).toEqual([]);
});

it('unreadable prior index provenance masks the fixed carrier rather than guessing', () => {
  const prior = addPrivateRecordFields(undefined, [
    { root: 'argumentAnswersKept', path: '5.value' },
  ]);
  expect(
    privateKeptSelections(
      prior,
      [],
      [{ turn: 2, toolName: 'lookup', argument: 'account', value: SECRET }],
      2,
    ),
  ).toEqual([{ root: 'argumentAnswersKept', path: '' }]);
  expect(privateResolutionSelections(prior, rows, [call], () => undefined, 2, [])).toEqual([
    { root: 'argumentResolutions', path: '' },
  ]);
});

it('resolved fills inherit kept privacy even if the current tool disappeared', () => {
  const kept = [{ turn: 2, toolName: 'lookup', argument: 'account', value: SECRET }];
  const prior = addPrivateRecordFields(undefined, [
    { root: 'argumentAnswersKept', path: '0.value' },
  ]);
  expect(privateResolutionSelections(prior, rows, [call], () => undefined, 2, kept)).toEqual([
    { root: 'argumentResolutions', path: '0.fills.0.value' },
  ]);
  expect(privateResolutionSelections(undefined, rows, [call], () => maskedTool(), 2)).toEqual([
    { root: 'argumentResolutions', path: '0.fills.0.value' },
  ]);
});

it('late mapper without native support refuses, while no-mapper tools read no scope', () => {
  expect(() => requirePrivateQuestionSupport({}, [maskedTool()])).toThrowError(
    expect.objectContaining({ code: 'ERR_PRIVATE_ARGUMENT_RECORD' }),
  );
  const scope = new Proxy(
    {},
    {
      get() {
        throw Error('unexpected scope read');
      },
    },
  );
  expect(() => requirePrivateQuestionSupport(scope, [undefined, {}])).not.toThrow();
});

describe.each(['direct', 'mounted'] as const)(
  'private continuation public surfaces: %s',
  (shape) => {
    it.each(['SAME', 'FRESH'] as const)(
      '%s keeps computation/checkpoint raw and later views masked',
      async (mode) => {
        const ran: unknown[] = [];
        const mock = scripted([batch(call), answer('Done')]);
        const make = () => {
          const agent = Agent.create({ provider: mock.provider as never, model: 'fixture' })
            .tool(
              maskedTool((args) => {
                ran.push({ ...args });
                return 'found';
              }),
            )
            .build();
          return {
            agent,
            runner: shape === 'direct' ? agent : Sequence.create().step('member', agent).build(),
          };
        };
        const first = make(),
          second = mode === 'SAME' ? first : make();
        const seen = [
          events(first.runner as never),
          ...(second === first ? [] : [events(second.runner as never)]),
        ];
        const recordings = [
          recordRun(first.runner),
          ...(second === first ? [] : [recordRun(second.runner)]),
        ];
        try {
          const asked = await first.runner.run({ message: 'go' });
          if (!isInputPause(asked)) throw Error('Expected first argument question');
          const values = Object.fromEntries(
            asked.awaitingInput.fields.map((field) => [
              field.id,
              field.description?.includes('Account') ? SECRET : 2.5,
            ]),
          );
          const again = await first.runner.resume(stored(asked), replyTo(asked, values));
          if (!isInputPause(again)) throw Error('Expected pin re-ask');
          expect(JSON.stringify(again.checkpoint)).toContain(SECRET);
          expect(again.awaitingInput.fields).toHaveLength(1);
          await second.runner.resume(stored(again), replyTo(again, { f1: 42 }));
          expect(ran).toEqual([{ region: 'eu', account: SECRET, pin: 42 }]);
          const surfaces = {
            ...Object.fromEntries(seen.map((surface, index) => [`events.${index}`, surface])),
            ...Object.fromEntries(
              recordings.map((record, index) => [`recording.${index}`, record.toRecording()]),
            ),
            'snapshot.first': first.runner.getSnapshot(),
            'snapshot.resumed': second.runner.getSnapshot(),
            ...Object.fromEntries(
              mock.requests.map((request, index) => [`model.messages.${index}`, request.messages]),
            ),
          };
          for (const [name, surface] of Object.entries(surfaces)) {
            const paths = secretPaths(surface);
            // Keep the original serialized-presence assertion, but report only a
            // boolean and labeled paths: Vitest must not dump raw private values.
            const found = JSON.stringify(surface)?.includes(SECRET) === true;
            expect.soft(found, `${name}: hidden answer paths ${JSON.stringify(paths)}`).toBe(false);
          }
          expect(JSON.stringify(seen)).toContain('lookup');
          expect(JSON.stringify(second.runner.getSnapshot())).toContain('region');
        } finally {
          for (const record of recordings) record.stop();
          await first.runner.shutdown();
          if (second !== first) await second.runner.shutdown();
        }
      },
    );
  },
);

function secretPaths(value: unknown, path = '$', seen = new Set<object>()): string[] {
  if (typeof value === 'string') return value.includes(SECRET) ? [path] : [];
  if (value === null || typeof value !== 'object' || seen.has(value)) return [];
  seen.add(value);
  return Object.entries(value).flatMap(([key, item]) => {
    const privateKey = key.includes(SECRET);
    const child = path + '/' + (privateKey ? '<private-key>' : key);
    return [...(privateKey ? [child] : []), ...secretPaths(item, child, seen)];
  });
}

it('private row classification accepts the tool descriptor without execution capability', () => {
  const { execute: ignoredExecute, ...descriptor } = maskedTool();
  expect(typeof ignoredExecute).toBe('function');
  expect(privateResolutionSelections(undefined, rows, [call], () => descriptor, 2)).toEqual([
    { root: 'argumentResolutions', path: '0.fills.0.value' },
  ]);
});
