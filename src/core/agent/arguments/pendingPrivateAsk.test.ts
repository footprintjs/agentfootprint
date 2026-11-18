import { describe, expect, it } from 'vitest';
import { defineTool } from '../../../index.js';
import { SHOWN_ARGS } from '../../toolShownArgs.js';
import { stampInputRequest } from '../../../tools/inputRequest.js';
import type { ArgumentAskState } from './ask.js';
import {
  declarePendingPrivateAsk,
  pendingPrivateAskOf,
  pendingPrivateSelections,
  readPendingPrivateAsk,
  requirePendingPrivateViews,
} from './pendingPrivateAsk.js';
import { PrivateArgumentRecordError } from './privateAnswers.js';

const plain = defineTool({ name: 'plain', description: 'Plain call', execute: () => 'ok' });
const guarded = {
  ...defineTool({ name: 'guarded', description: 'Guarded call', execute: () => 'ok' }),
  [SHOWN_ARGS]: (args: Readonly<Record<string, unknown>>) =>
    args.region === 'eu' ? { ...args, account: 'REDACTED' } : args,
};
const awaiting = stampInputRequest(
  {
    id: 'pending-values',
    question: 'Values?',
    fields: [
      { id: 'f1', type: 'string', required: true },
      { id: 'f2', type: 'string', required: true },
    ],
  },
  'pending-fixture',
  { originalRequest: 'go', toolCallId: 'one' },
);
const state: ArgumentAskState = {
  iteration: 1,
  fields: [
    {
      type: 'string',
      question: 'Account?',
      members: [
        { toolName: 'guarded', argument: 'account', toolCallIds: ['one'] },
        { toolName: 'plain', argument: 'account', toolCallIds: ['two'] },
      ],
    },
    {
      type: 'string',
      question: 'Region?',
      members: [{ toolName: 'plain', argument: 'region', toolCallIds: ['two'] }],
    },
  ],
  progress: [{ rounds: 1 }, { rounds: 1 }],
  waiting: { requestId: awaiting.requestId, fieldIndexes: [0, 1], awaiting },
};
const toolOf = (name: string) => (name === 'guarded' ? guarded : plain);
const proof = { version: 1 as const, fields: [{ index: 0, members: [0] }] };

it('declares pending names before any answer, without probing the conditional mapper', () => {
  const planned = declarePendingPrivateAsk(state, toolOf, true);
  expect(planned).toEqual(proof);
  expect(pendingPrivateSelections(planned)).toEqual([
    { root: 'argumentAsk', path: 'progress.0.answer' },
    { root: 'argumentAsk', path: 'progress.0.fills' },
  ]);
  expect(state.progress).toEqual([{ rounds: 1 }, { rounds: 1 }]);
});

it('does not reject the unchanged plain member of a shared private field', () => {
  expect(() => requirePendingPrivateViews(state, proof, toolOf)).not.toThrow();
});

it.each(['lost', 'missing'])(
  'refuses a %s original private member before answer binding',
  (change) => {
    const current = (name: string) =>
      name === 'guarded'
        ? change === 'lost'
          ? { ...guarded, [SHOWN_ARGS]: undefined }
          : undefined
        : plain;
    expect(() => requirePendingPrivateViews(state, proof, current)).toThrowError(
      expect.objectContaining({ code: 'ERR_PRIVATE_ARGUMENT_RECORD' }),
    );
  },
);

it('a resumed question missing its saved declaration refuses with the one private-record error', () => {
  // One refusal family, one class: a caller can tell it by `instanceof` as
  // well as by its code, wherever in the private-argument path it was raised.
  let caught: unknown;
  try {
    readPendingPrivateAsk(undefined, state, true);
  } catch (error) {
    caught = error;
  }
  expect(caught).toBeInstanceOf(PrivateArgumentRecordError);
  expect(caught).toMatchObject({
    code: 'ERR_PRIVATE_ARGUMENT_RECORD',
    message:
      'A private argument question requires its saved declaration and argument-view capability.',
  });
});

it('plain questions omit the field, while protected runs explicitly declare none', () => {
  expect(declarePendingPrivateAsk(state, () => plain, false)).toBeUndefined();
  expect(declarePendingPrivateAsk(state, () => plain, true)).toEqual({ version: 1, fields: [] });
  expect(readPendingPrivateAsk(undefined, state, false)).toBeUndefined();
  expect(() => readPendingPrivateAsk(undefined, state, true)).toThrowError(
    expect.objectContaining({ code: 'ERR_PRIVATE_ARGUMENT_RECORD' }),
  );
});

it('an unavailable ordinary member does not invent a private-question refusal', () => {
  expect(() => declarePendingPrivateAsk(state, () => undefined, false)).not.toThrow();
  expect(declarePendingPrivateAsk(state, () => undefined, false)).toBeUndefined();
  expect(declarePendingPrivateAsk(state, () => undefined, true)).toEqual({
    version: 1,
    fields: [],
  });
});

it('a missing ordinary sibling does not remove the required private member', () => {
  const current = (name: string) => (name === 'guarded' ? guarded : undefined);
  expect(() => declarePendingPrivateAsk(state, current, true)).not.toThrow();
  const declaration = declarePendingPrivateAsk(state, current, true);
  expect(declaration).toEqual(proof);
  expect(() => requirePendingPrivateViews(state, declaration, current)).not.toThrow();
  expect(() => requirePendingPrivateViews(state, declaration, () => undefined)).toThrowError(
    expect.objectContaining({ code: 'ERR_PRIVATE_ARGUMENT_RECORD' }),
  );
});

describe('closed pending declaration', () => {
  it.each([
    null,
    [],
    {},
    { version: 2, fields: [] },
    { version: 1 },
    { version: 1, fields: [], extra: true },
    { version: 1, fields: [{ index: 0, members: [0], extra: true }] },
    { version: 1, fields: [{ index: 0, members: [] }] },
    { version: 1, fields: [{ index: 0, members: [0, 0] }] },
    { version: 1, fields: [{ index: 0, members: [-1] }] },
    { version: 1, fields: [{ index: 0, members: [2] }] },
    { version: 1, fields: [{ index: 0, members: [0.5] }] },
    { version: 1, fields: [{ index: 0, members: ['0'] }] },
    {
      version: 1,
      fields: [
        { index: 0, members: [0] },
        { index: 0, members: [0] },
      ],
    },
    { version: 1, fields: [{ index: 2, members: [0] }] },
  ])('refuses malformed metadata %# without reflecting values', (raw) => {
    expect(() => readPendingPrivateAsk(raw, state, true)).toThrowError(
      expect.objectContaining({ code: 'ERR_PRIVATE_ARGUMENT_RECORD' }),
    );
  });

  it('refuses inherited/accessor metadata without invoking an accessor', () => {
    let reads = 0;
    const accessor = {
      version: 1,
      get fields() {
        reads++;
        return [];
      },
    };
    expect(() => readPendingPrivateAsk(accessor, state, true)).toThrow();
    expect(reads).toBe(0);
    expect(() => readPendingPrivateAsk(Object.create(proof), state, true)).toThrow();
  });

  it('does not read a waiting declaration through an accessor or prototype', () => {
    let reads = 0;
    const inherited = Object.assign(Object.create({ privateFields: proof }), state.waiting);
    expect(() => pendingPrivateAskOf({ ...state, waiting: inherited }, true)).toThrow();
    const accessor = Object.defineProperty({ ...state.waiting! }, 'privateFields', {
      get() {
        reads++;
        return proof;
      },
    });
    expect(() => pendingPrivateAskOf({ ...state, waiting: accessor }, true)).toThrow();
    expect(reads).toBe(0);
    expect(
      pendingPrivateAskOf({ ...state, waiting: { ...state.waiting!, privateFields: proof } }, true),
    ).toEqual(proof);
  });

  it('requires selected indices to belong to this actual fitted question', () => {
    const otherRound = { ...state, waiting: { ...state.waiting!, fieldIndexes: [1] } };
    expect(() => readPendingPrivateAsk(proof, otherRound, true)).toThrow();
    expect(readPendingPrivateAsk({ version: 1, fields: [] }, otherRound, true)).toEqual({
      version: 1,
      fields: [],
    });
  });
});
