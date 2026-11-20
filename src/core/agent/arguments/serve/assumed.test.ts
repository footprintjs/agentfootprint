import { expect, it } from 'vitest';
import type { ArgumentRow } from '../rows.js';
import { assumedLinesFor } from './assumed.js';

const row = {
  kind: 'argument',
  turn: 1,
  iteration: 1,
  toolCallId: 'same',
  toolName: 'count',
  argument: 'window',
  source: 'default',
  value: '2h',
} satisfies ArgumentRow;
const decision = { at: 'tool', toolCallId: 'same', changedKeys: ['window'] };
const callOccurrenceKey = [1, 2, 3, 4, 0] as const;
const keyedRow = { ...row, callOccurrenceKey };
const keyedDecision = { ...decision, callOccurrenceKey };
const line = { toolName: 'count', argument: 'window', value: '2h', hidden: false };

it('suppresses an assumed line for exactly its own rewrite', () => {
  expect(assumedLinesFor([keyedRow], 1, () => [keyedDecision])).toEqual([]);
  expect(assumedLinesFor([row], 1, () => [decision])).toEqual([]);
  expect(assumedLinesFor([keyedRow], 1, () => [decision])).toEqual([line]);
  expect(assumedLinesFor([row], 1, () => [keyedDecision])).toEqual([line]);
  const otherBatch = { ...decision, callOccurrenceKey: [1, 2, 3, 5, 0] };
  expect(assumedLinesFor([keyedRow], 1, () => [otherBatch])).toEqual([line]);
});

it('can match a valid occurrence with masked display IDs and rejects unreadable keys', () => {
  expect(
    assumedLinesFor([keyedRow], 1, () => [{ ...keyedDecision, toolCallId: 'REDACTED' }]),
  ).toEqual([]);
  const maskedRow = { ...row, callOccurrenceKey: 'REDACTED' };
  const maskedDecision = { ...decision, callOccurrenceKey: 'REDACTED' };
  expect(assumedLinesFor([maskedRow], 1, () => [decision])).toEqual([line]);
  expect(assumedLinesFor([row], 1, () => [maskedDecision])).toEqual([line]);
});
