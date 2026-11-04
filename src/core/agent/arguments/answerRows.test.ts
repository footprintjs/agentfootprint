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
  withWaiting,
} from './ask.js';
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
