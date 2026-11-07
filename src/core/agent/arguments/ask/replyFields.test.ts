import { expect, it } from 'vitest';
import { applyInputResponse, stampInputRequest } from '../../../../tools/inputRequest.js';
import { physicalPrefix, replyBinding, roundFields } from './replyFields.js';
import type { ArgumentAskState, AskField } from './types.js';

const range = '2026-11-06T17:00:00Z/2026-11-06T18:00:00Z';
const field: AskField = {
  type: 'string',
  question: 'Choose the window.',
  choices: [range],
  members: [{ toolName: 'read', argument: 'window', period: true, toolCallIds: ['one'] }],
  window: { format: 'time-range', mention: 0, labels: ['same label'], zones: ['UTC'] },
};
function waiting(correctable = true) {
  const current = correctable
    ? {
        ...field,
        window: {
          ...field.window!,
          reply: { version: 1 as const, description: 'Say what to change.' },
        },
      }
    : field;
  const state: ArgumentAskState = { iteration: 1, fields: [current], progress: [{ rounds: 0 }] };
  const fields = roundFields(state, [0]);
  return stampInputRequest(
    {
      id: 'test',
      question: 'Choose.',
      fields,
      context: {
        agentfootprint: {
          ask: 'arguments',
          fields: [{ id: 'f1', ...(correctable && { timeReply: replyBinding(current, 'f1') }) }],
        },
      },
    },
    'request-one',
    { toolCallId: 'call-one', originalRequest: 'test' },
  );
}
it('keeps every old range-field byte apart from required, with one appended sibling', () => {
  const old = waiting(false),
    current = waiting();
  expect(current.fields[0]).toEqual({ ...old.fields[0], required: false });
  expect(current.fields[1]).toEqual({
    id: 'f1-correction',
    type: 'string',
    required: false,
    description: 'Say what to change.',
  });
});
it('admits neither to the declared decision while preserving legacy empty refusal', () => {
  expect(() =>
    applyInputResponse(waiting(false), { requestId: 'request-one', values: {} }),
  ).toThrow('supply at least one field');
  expect(applyInputResponse(waiting(), { requestId: 'request-one', values: {} })).toMatchObject({
    supplied: {},
    missing: [],
  });
});
it('keeps prose strict in the range field, accepts it only in the correction sibling', () => {
  expect(
    applyInputResponse(waiting(), { requestId: 'request-one', values: { f1: 'EST time zone' } }),
  ).toHaveProperty('refused');
  expect(
    applyInputResponse(waiting(), {
      requestId: 'request-one',
      values: { 'f1-correction': 'EST time zone' },
    }),
  ).toMatchObject({ supplied: { 'f1-correction': 'EST time zone' }, missing: [] });
});
it('retains both for an explicit hold and still refuses foreign requests', () => {
  expect(
    applyInputResponse(waiting(), {
      requestId: 'request-one',
      values: { f1: range, 'f1-correction': 'no' },
    }),
  ).toMatchObject({ supplied: { f1: range, 'f1-correction': 'no' } });
  expect(() =>
    applyInputResponse(waiting(), { requestId: 'foreign', values: { 'f1-correction': 'no' } }),
  ).toThrow();
});
it('counts physical siblings without renumbering ordinary logical positions', () => {
  const time = {
    ...field,
    window: { ...field.window!, reply: { version: 1 as const, description: 'Correction' } },
  };
  const fields = Array.from({ length: 32 }, () => time),
    state = { iteration: 1, fields, progress: fields.map(() => ({ rounds: 0 })) };
  const indexes = physicalPrefix(
    state,
    fields.map((_, index) => index),
  );
  expect(indexes).toHaveLength(16);
  expect(roundFields(state, indexes)).toHaveLength(32);
});
