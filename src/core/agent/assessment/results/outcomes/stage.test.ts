import { describe, expect, it } from 'vitest';
import { readToolSettlements, type HistoryCall } from '../../../recordedCalls.js';
import type { AssessmentPointer } from '../../types.js';
import { outcomeDetailReader } from './stage.js';

const first = {
  callOccurrenceKey: [10, 20, 30, 40, 0],
  execution: 'threw',
  outcome: 'failed',
  failureCategory: 'timeout',
};
const second = {
  ...first,
  callOccurrenceKey: [10, 20, 30, 40, 1],
  failureCategory: 'auth',
};
const calls: readonly HistoryCall[] = [
  { index: 4, message: {}, providerId: 'same-id', occurrenceKey: '10.20.30.40.0' },
  { index: 6, message: {}, providerId: 'same-id', occurrenceKey: '10.20.30.40.1' },
];
const history = (index: number): AssessmentPointer => ({
  kind: 'history',
  index,
  path: '/toolResultExecution',
});
const settlement = (path: string): AssessmentPointer => ({
  kind: 'state',
  key: 'settledToolCalls',
  path,
});

describe('recorded tool failure categories', () => {
  it('uses exact occurrences and projects one distinct category from matching witnesses', () => {
    const rows = [first, second];
    const read = outcomeDetailReader(calls, readToolSettlements(rows, true)?.byKey, () => rows);
    expect([...read.failureByHistory]).toEqual([
      [4, 'timeout'],
      [6, 'auth'],
    ]);
    expect(read.failureFor([history(4), settlement('/0/outcome')])).toBe('timeout');
    expect(read.failureFor([settlement('/1')])).toBe('auth');
    expect(read.failureFor([history(4), settlement('/1')])).toBeUndefined();
    expect(read.failureFor([history(0), settlement('/00'), settlement('wrong/0')])).toBeUndefined();
  });

  it.each([
    { name: 'legacy row', rows: [{ ...first, failureCategory: undefined }] },
    { name: 'unknown category', rows: [{ ...first, failureCategory: 'unexpected value' }] },
    { name: 'changed category', rows: [{ ...first, failureCategory: 'network' }] },
    { name: 'refusal', rows: [{ ...first, outcome: 'refused' }] },
    { name: 'withheld result', rows: [{ ...first, execution: 'returned', delivery: 'withheld' }] },
    { name: 'changed occurrence', rows: [{ ...second, failureCategory: 'timeout' }] },
    { name: 'shifted row', rows: [second, first] },
    { name: 'duplicate occurrence', rows: [first, first] },
    { name: 'removed row', rows: [] },
  ])('omits a category from both projections after a $name', ({ rows }) => {
    const admitted = readToolSettlements([first], true)?.byKey;
    const read = outcomeDetailReader(calls, admitted, () => rows);
    expect(read.failureByHistory.size).toBe(0);
    expect(read.failureFor([history(4), settlement('/0'), settlement('/1')])).toBeUndefined();
  });

  it('keeps the settlement witness when there is no unique history match', () => {
    const ambiguous = [...calls, { ...calls[0]!, index: 8 }];
    const read = outcomeDetailReader(ambiguous, readToolSettlements([first], true)?.byKey, () => [
      first,
    ]);
    expect(read.failureByHistory.size).toBe(0);
    expect(read.failureFor([history(4), history(8)])).toBeUndefined();
    expect(read.failureFor([settlement('/0')])).toBe('timeout');
  });

  it('leaves retained state unread when there is no admitted settlement map', () => {
    const read = outcomeDetailReader(calls, undefined, () => {
      throw new Error('unexpected retained read');
    });
    expect(read.failureByHistory.size).toBe(0);
    expect(read.failureFor([history(4), settlement('/0')])).toBeUndefined();
  });
});

describe('recorded code output counts', () => {
  const counts = { kept: 8, total: 12, unit: 'characters' };
  const partial = {
    callOccurrenceKey: first.callOccurrenceKey,
    execution: 'returned',
    delivery: 'native',
    reportedStatus: 'partial',
    outputCounts: counts,
  };
  const sibling = { ...partial, callOccurrenceKey: second.callOccurrenceKey };
  const atFirst = settlement('/0/reportedStatus');

  it('places one measured occurrence in the history and settlement witnesses', () => {
    const rows = [partial, sibling];
    const read = outcomeDetailReader(calls, readToolSettlements(rows, true)?.byKey, () => rows);
    expect(read.countsFor([history(4), atFirst])).toEqual(counts);
    expect(read.countsFor([atFirst])).toEqual(counts);
    expect(read.countsFor([history(4), history(6)])).toBeUndefined();
    expect(read.countsFor([atFirst, settlement('/1/reportedStatus')])).toBeUndefined();
    expect(read.countsFor([atFirst, history(8)])).toBeUndefined();
  });

  it.each([
    { name: 'hidden counts', rows: [{ ...partial, outputCounts: 'REDACTED' }] },
    {
      name: 'hidden total',
      rows: [{ ...partial, outputCounts: { ...counts, total: 'REDACTED' } }],
    },
    { name: 'changed count', rows: [{ ...partial, outputCounts: { ...counts, kept: 7 } }] },
    { name: 'shifted settlement', rows: [sibling, partial] },
    { name: 'withheld result', rows: [{ ...partial, delivery: 'withheld' }] },
    { name: 'rewritten result', rows: [{ ...partial, delivery: 'rewritten' }] },
    {
      name: 'changed status',
      rows: [{ ...partial, reportedStatus: undefined, outcome: 'failed' }],
    },
  ])('omits the count after a $name', ({ rows }) => {
    const admitted = readToolSettlements([partial], true)?.byKey;
    const read = outcomeDetailReader(calls, admitted, () => rows);
    expect(read.countsFor([history(4)])).toBeUndefined();
    expect(read.countsFor([atFirst])).toBeUndefined();
  });

  it('does not attach counts through an ambiguous history occurrence', () => {
    const rows = [partial];
    const ambiguous = [...calls, { ...calls[0]!, index: 8 }];
    const read = outcomeDetailReader(ambiguous, readToolSettlements(rows, true)?.byKey, () => rows);
    expect(read.countsFor([history(4)])).toBeUndefined();
    expect(read.countsFor([history(8)])).toBeUndefined();
    expect(read.countsFor([atFirst])).toEqual(counts);
  });
});
