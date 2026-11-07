import { expect, it } from 'vitest';
import { stampInputRequest } from '../../../../tools/inputRequest.js';
import { chooseReading, DEFAULT_TIME_POLICY, resolveMention } from '../../../../time/resolve.js';
import { timeReplyOf } from '../../../../time/reply.js';
import { spellRange } from '../../../../time/range.js';
import type { TimeReadingRow } from '../../../../time/rows.js';
import { defaultTimeAskMessages } from '../../../../locales/timeAsk.js';
import type { ToolOf } from '../resolve.js';
import type { AskField, ArgumentAskState } from './types.js';
import { bindWindowReply } from './windowReply.js';
import { replyBinding, roundFields } from './replyFields.js';

const now = '2026-11-06T18:01:00Z',
  clock = { now, zone: 'UTC' };
const reader = { id: 'fixture', version: '1', kind: 'rule' as const, locale: 'en-US' };
const parses = [{ relative: { unit: 'hour' as const, count: 1 } }];
const resolution = resolveMention(parses, clock, reader, true, DEFAULT_TIME_POLICY);
const row: TimeReadingRow = {
  kind: 'time-reading',
  turn: 1,
  iteration: 1,
  mentions: 1,
  mention: 0,
  quote: 'last 1 hour',
  reader,
  tzdata: 'fixture',
  parses,
  candidates: resolution.candidates,
  choice: chooseReading(resolution, DEFAULT_TIME_POLICY, 'rule', undefined, true),
};
const changed = timeReplyOf({
  row,
  clock,
  policy: DEFAULT_TIME_POLICY,
  correction: 'last 2 hours',
});
if (changed.kind !== 'reask') throw new Error('Expected a replacement proposal');
const range = changed.row.candidates![0]!.range,
  value = spellRange(range);
const tool: NonNullable<ReturnType<ToolOf>> = {
  schema: {
    name: 'activity',
    inputSchema: {
      type: 'object',
      properties: { from: { type: 'integer' }, to: { type: 'integer' } },
    },
  },
  askOrAssume: { from: { ask: 'From when?' }, to: { ask: 'Until when?' } },
  period: {
    forms: [
      {
        kind: 'bounds',
        from: { argument: 'from', as: 'epoch-ms' },
        to: { argument: 'to', as: 'epoch-ms', edge: 'exclusive' },
      },
    ],
  },
};
const field: AskField = {
  type: 'string',
  question: 'Confirm?',
  choices: [value],
  members: ['from', 'to'].map((argument) => ({
    toolName: 'activity',
    argument,
    period: true,
    toolCallIds: ['one'],
  })),
  window: {
    format: 'time-range',
    mention: 0,
    zones: ['UTC'],
    reading: changed.row,
    corrected: true,
    reply: { version: 1, description: 'Correction?' },
  },
};
const state: ArgumentAskState = { iteration: 1, fields: [field], progress: [{ rounds: 1 }] };
const awaiting = stampInputRequest(
  {
    id: 'test',
    question: 'Confirm?',
    fields: roundFields(state, [0]),
    context: {
      agentfootprint: {
        ask: 'arguments',
        fields: [{ id: 'f1', timeReply: replyBinding(field, 'f1') }],
      },
    },
  },
  'request-one',
  { toolCallId: 'one', originalRequest: 'test' },
);
const calls = new Map([['one', { id: 'one', name: 'activity', args: {} }]]);
const time = {
  now,
  zone: 'UTC',
  reading: { row, policy: DEFAULT_TIME_POLICY, messages: defaultTimeAskMessages },
};

it('converts the exact corrected proposal and records its accepted duration', () => {
  const bound = bindWindowReply(field, { f1: value }, 'f1', awaiting, calls, () => tool, time);
  expect(bound).toMatchObject({
    fills: { one: { values: { from: Date.parse(range.from), to: Date.parse(now) } } },
    answered: { how: 'confirmed', corrected: { lookback: '2h' } },
  });
});
it('a full interval correction stays an absolute edit even if equal to an offered lookback', () => {
  const bound = bindWindowReply(
    field,
    { 'f1-correction': value },
    'f1',
    awaiting,
    calls,
    () => tool,
    time,
  );
  expect(bound).toMatchObject({
    fills: { one: { values: { from: Date.parse(range.from), to: Date.parse(range.to) } } },
    answered: { how: 'edited', corrected: {} },
  });
  if (!('answered' in bound)) throw new Error('Expected a bound interval');
  expect(bound.answered.corrected).not.toHaveProperty('lookback');
});
