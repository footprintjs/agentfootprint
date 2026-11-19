import { describe, expect, it } from 'vitest';
import { readCallOccurrenceKey } from '../../../lib/callOccurrence.js';
import {
  argumentHistoryCallResolver,
  historyCallForWitness,
  historyCallResolver,
  readHistoryCalls,
  rowsForHistoryCall,
} from './history.js';

const first = [1, 2, 3, 4, 0];
const second = [1, 2, 3, 4, 1];
const firstKey = readCallOccurrenceKey({ callOccurrenceKey: first })!;
const secondKey = readCallOccurrenceKey({ callOccurrenceKey: second })!;
const id = 'reused';
const name = 'inventory';

function proposal(label: string, key?: readonly number[]) {
  return { id, name, args: { label }, ...(key !== undefined && { callOccurrenceKey: key }) };
}

function result(label: string, key?: readonly number[]) {
  return {
    role: 'tool',
    toolName: name,
    toolCallId: id,
    content: label,
    ...(key !== undefined && { callOccurrenceKey: key }),
  };
}

function batch(...toolCalls: ReturnType<typeof proposal>[]) {
  return { role: 'assistant', toolCalls };
}

describe('recorded history call keys', () => {
  it('places proposals and rows on their own results when a batch reuses a provider ID', () => {
    const history = [
      batch(proposal('one', first), proposal('two', second)),
      result('two', second),
      result('one', first),
    ];
    const calls = readHistoryCalls(history);
    const rows = [
      { toolCallId: id, toolName: name, callOccurrenceKey: first, iteration: 1 },
      { toolCallId: id, toolName: name, callOccurrenceKey: second, iteration: 1 },
    ];
    const resolve = argumentHistoryCallResolver(calls, history, -1, rows.entries());
    expect(calls.map((call) => call.proposal?.call.args)).toEqual([
      { label: 'two' },
      { label: 'one' },
    ]);
    expect(resolve(id, name, firstKey)).toMatchObject({ kind: 'matched', call: { index: 2 } });
    expect(resolve(id, name, secondKey)).toMatchObject({ kind: 'matched', call: { index: 1 } });
    expect(rowsForHistoryCall(rows, calls, calls[0]!)).toEqual([{ index: 1, row: rows[1] }]);
  });

  it('keeps an evicted occurrence separate from a same-ID result still in history', () => {
    const history = [batch(proposal('two', second)), result('two', second)];
    const calls = readHistoryCalls(history);
    const rows = [
      [0, { toolCallId: id, toolName: name, callOccurrenceKey: first, iteration: 1 }],
    ] as const;
    const resolve = argumentHistoryCallResolver(calls, history, -1, rows);
    expect(resolve(id, name, firstKey)).toEqual({ kind: 'missing' });
    expect(resolve(id, name, null)).toEqual({ kind: 'ambiguous' });
    expect(resolve(id, name)).toEqual({ kind: 'ambiguous' });
    expect(rowsForHistoryCall([rows[0][1]], calls, calls[0]!)).toEqual([]);
    expect(historyCallForWitness(calls, id, 1, undefined, firstKey)).toBeUndefined();
    expect(historyCallForWitness(calls, id, 999, 'different hash', secondKey)).toBe(calls[0]);
  });

  it('keeps duplicate results or proposals from supplying an exact address', () => {
    const history = [
      batch(proposal('one', first), proposal('two', first)),
      result('one', first),
      result('two', first),
    ];
    const calls = readHistoryCalls(history);
    expect(calls.map((call) => call.proposal)).toEqual([undefined, undefined]);
    expect(historyCallResolver(calls)(id, name, firstKey)).toEqual({ kind: 'ambiguous' });
    expect(readHistoryCalls(history.slice(0, 2))[0]?.proposal).toBeUndefined();
  });

  it('preserves the legacy argument rule for a history and ledger without keys', () => {
    const history = [batch(proposal('one')), result('one')];
    const calls = readHistoryCalls(history);
    const row = { toolCallId: id, toolName: name, iteration: 1 };
    const resolve = argumentHistoryCallResolver(calls, history, -1, [[0, row]]);
    expect(resolve(id, name)).toMatchObject({ kind: 'matched', call: { index: 1 } });
    const conflicting = argumentHistoryCallResolver(calls, history, -1, [
      [0, row],
      [1, { ...row, iteration: 2 }],
    ]);
    expect(conflicting(id, name)).toEqual({ kind: 'ambiguous' });
  });
});
