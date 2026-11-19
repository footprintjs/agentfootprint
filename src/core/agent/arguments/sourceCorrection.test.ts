import { expect, it } from 'vitest';
import type { CallOccurrenceKey } from '../../../lib/callOccurrence.js';
import {
  omissionRows,
  onlyOmissions,
  settleOmissions,
  type PendingOmissions,
} from './sourceCorrection.js';
import type { BatchCall, CheckedArgument } from './resolve.js';
import type { ArgumentRow } from './rows.js';
import type { CallSources } from './sources.js';

it('settles an omission only for the accepted call that carried it', () => {
  const keys: readonly CallOccurrenceKey[] = [
    [1, 2, 3, 4, 0],
    [1, 2, 3, 4, 1],
  ];
  const calls = keys.map(
    (callOccurrenceKey): BatchCall => ({
      id: 'same',
      name: 'lookup',
      callOccurrenceKey,
      args: { item: 'shelf' },
    }),
  );
  const checked = keys.map(
    (callOccurrenceKey): CheckedArgument => ({
      toolCallId: 'same',
      toolName: 'lookup',
      callOccurrenceKey,
      argument: 'item',
      rule: 'ask',
      asked: 'unverified',
      check: { source: 'model', claimed: 'none' },
    }),
  );
  const rows = keys.map(
    (callOccurrenceKey): ArgumentRow => ({
      kind: 'argument',
      turn: 1,
      iteration: 2,
      toolCallId: 'same',
      toolName: 'lookup',
      callOccurrenceKey,
      argument: 'item',
      asked: 'unverified',
      claimed: 'none',
    }),
  );
  const declared = new Map<number, CallSources>(
    keys.map((callOccurrenceKey, index) => [
      index,
      {
        toolCallId: 'same',
        callOccurrenceKey,
        from: [],
        ...(index === 1 && { declarationMalformed: true }),
      },
    ]),
  );
  const omissions = omissionRows(rows, checked, calls, declared);
  expect(omissions).toEqual([rows[0]]);
  const asks = keys.map((callOccurrenceKey) => ({
    toolCallId: 'same',
    callOccurrenceKey,
    ask: ['item'],
  }));
  expect(onlyOmissions(omissions, asks)).toBe(false);
  expect(onlyOmissions(omissions, asks.slice(0, 1))).toBe(true);

  const state: PendingOmissions = { argumentSourceOmissionRows: rows };
  const filed: ArgumentRow[] = [];
  const write = (settled: readonly ArgumentRow[]) => filed.push(...settled);
  settleOmissions(state, 1, 2, 'preempted', write, rows.slice(0, 1));
  expect(filed).toEqual([
    expect.objectContaining({
      callOccurrenceKey: keys[0],
      withheld: 'batch-preempted',
    }),
  ]);
  expect(state.argumentSourceOmissionRows).toEqual([rows[1]]);
});
