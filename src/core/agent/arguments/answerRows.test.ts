import { describe, expect, it } from 'vitest';
import { defineTool } from '../../../index.js';
import { SHOWN_ARGS } from '../../toolShownArgs.js';
import { stampInputRequest } from '../../../tools/inputRequest.js';
import {
  argumentAskDeclaration,
  bindAnswer,
  initialAskState,
  nextAskRound,
  planAskFields,
  settledCalls,
  withWaiting,
} from './ask.js';
import { restoreAskAddresses } from './askAddresses.js';
import { privateAskSelections } from './privateAnswers.js';
import type { ArgumentResolution } from './resolve.js';

const privateValue = 'private-sibling-answer-fixture';
const tool = {
  ...defineTool({
    name: 'lookup',
    description: 'Look up an account',
    inputSchema: {
      type: 'object',
      properties: {
        account: { type: 'string' },
        region: { type: 'string' },
      },
    },
    askOrAssume: { account: { ask: 'Account?' }, region: { ask: 'Region?' } },
    execute: () => 'found',
  }),
  [SHOWN_ARGS]: (args: Readonly<Record<string, unknown>>) =>
    args.region === 'eu' && 'account' in args ? { ...args, account: 'REDACTED' } : args,
};
const calls = [{ id: 'one', name: 'lookup', args: {} }];

function answerBoth(
  order: readonly string[],
  region: string,
  baseResolutions?: ReadonlyMap<string, ArgumentResolution>,
) {
  const state = initialAskState(
    1,
    planAskFields([{ toolCallId: 'one', ask: order }], calls, () => tool),
  );
  const { declaration, fieldIndexes } = argumentAskDeclaration(state, nextAskRound(state)!);
  const awaiting = stampInputRequest(declaration, 'sibling-answers', {
    originalRequest: 'go',
    toolCallId: 'one',
  });
  const waiting = withWaiting(state, { requestId: awaiting.requestId, fieldIndexes, awaiting });
  const values = Object.fromEntries(
    fieldIndexes.map((index, position) => [
      `f${position + 1}`,
      state.fields[index].members[0].argument === 'account' ? privateValue : region,
    ]),
  );
  return bindAnswer(
    waiting,
    values,
    calls,
    () => tool,
    { turn: 1, iteration: 1 },
    undefined,
    baseResolutions,
  );
}

describe.each([
  ['account', 'region'],
  ['region', 'account'],
])('answered row privacy with sibling order %s/%s', (...order) => {
  it('uses both settled answers before composing any served answer row', () => {
    const bound = answerBoth(order, 'eu');
    expect(bound.rows.map((row) => ('argument' in row ? row.argument : undefined))).toEqual(order);
    expect(JSON.stringify(bound.rows).includes(privateValue)).toBe(false);
    expect(bound.rows).toContainEqual(
      expect.objectContaining({ argument: 'account', value: 'REDACTED' }),
    );
    expect(bound.rows).toContainEqual(expect.objectContaining({ argument: 'region', value: 'eu' }));
    expect(bound.state.progress.map((progress) => progress.answer)).toEqual(
      order.map((argument) => (argument === 'account' ? privateValue : 'eu')),
    );
  });

  it('keeps genuinely public answers visible under the same mapper', () => {
    expect(answerBoth(order, 'public').rows).toContainEqual(
      expect.objectContaining({ argument: 'account', value: privateValue }),
    );
  });
});

it('uses an already resolved sibling default without claiming it was part of the model proposal', () => {
  const bound = answerBoth(
    ['account'],
    'unused',
    new Map([
      [
        'one',
        {
          toolCallId: 'one',
          iteration: 1,
          fills: [{ argument: 'region', source: 'default', value: 'eu' }],
        },
      ],
    ]),
  );
  expect(JSON.stringify(bound.rows).includes(privateValue)).toBe(false);
  expect(bound.rows).toEqual([expect.objectContaining({ argument: 'account', value: 'REDACTED' })]);
  expect(bound.rows[0]).not.toHaveProperty('proposed');
});

it('binds only the asking occurrence and applies that occurrence’s argument view', () => {
  const reused = [
    {
      id: 'same',
      name: 'lookup',
      args: { region: 'eu' },
      callOccurrenceKey: [1, 2, 3, 4, 0] as const,
    },
    {
      id: 'same',
      name: 'lookup',
      args: { region: 'public' },
      callOccurrenceKey: [1, 2, 3, 4, 1] as const,
    },
  ];
  const fields = planAskFields(
    [{ toolCallId: 'same', callOccurrenceKey: reused[0].callOccurrenceKey, ask: ['account'] }],
    reused,
    () => tool,
  );
  const state = initialAskState(1, fields);
  const { declaration, fieldIndexes } = argumentAskDeclaration(state, nextAskRound(state)!);
  const awaiting = stampInputRequest(declaration, 'one-account-answer', {
    originalRequest: 'go',
    toolCallId: 'same',
  });
  const waiting = withWaiting(state, { requestId: awaiting.requestId, fieldIndexes, awaiting });
  const restored = restoreAskAddresses(JSON.parse(JSON.stringify(waiting)), reused);
  const bound = bindAnswer(restored, { f1: privateValue }, reused, () => tool, {
    turn: 1,
    iteration: 1,
  });
  expect(bound.rows).toEqual([
    expect.objectContaining({
      argument: 'account',
      value: 'REDACTED',
      callOccurrenceKey: reused[0].callOccurrenceKey,
    }),
  ]);
  const settled = settledCalls(bound.state);
  expect([...settled.keys()]).toEqual([0]);
  expect(privateAskSelections(bound.state, reused, () => tool, settled)).toEqual([
    { root: 'argumentAsk', path: 'progress.0.answer' },
  ]);
});

it('upgrades a unique older field and refuses an older ID shared by two proposals', () => {
  const legacy = initialAskState(
    1,
    planAskFields([{ toolCallId: 'one', ask: ['account'] }], calls, () => tool),
  );
  const modern = { ...calls[0], callOccurrenceKey: [1, 2, 3, 4, 0] as const };
  expect(restoreAskAddresses(legacy, [modern]).fields[0].members[0].callAddresses).toEqual([0]);
  expect(() =>
    restoreAskAddresses(legacy, [modern, { ...modern, callOccurrenceKey: [1, 2, 3, 4, 1] }]),
  ).toThrow('saved field does not identify one call');
});
