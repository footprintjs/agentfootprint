import { describe, expect, it } from 'vitest';
import { readToolSettlements, type HistoryCall } from '../../../recordedCalls.js';
import type { AssessmentPointer } from '../../types.js';
import { failureCategoryReader } from './stage.js';

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
    const read = failureCategoryReader(calls, readToolSettlements(rows, true)?.byKey, () => rows);
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
    const read = failureCategoryReader(calls, admitted, () => rows);
    expect(read.failureByHistory.size).toBe(0);
    expect(read.failureFor([history(4), settlement('/0'), settlement('/1')])).toBeUndefined();
  });

  it('keeps the settlement witness when there is no unique history match', () => {
    const ambiguous = [...calls, { ...calls[0]!, index: 8 }];
    const read = failureCategoryReader(ambiguous, readToolSettlements([first], true)?.byKey, () => [
      first,
    ]);
    expect(read.failureByHistory.size).toBe(0);
    expect(read.failureFor([history(4), history(8)])).toBeUndefined();
    expect(read.failureFor([settlement('/0')])).toBe('timeout');
  });

  it('leaves retained state unread when there is no admitted settlement map', () => {
    const read = failureCategoryReader(calls, undefined, () => {
      throw new Error('unexpected retained read');
    });
    expect(read.failureByHistory.size).toBe(0);
    expect(read.failureFor([history(4), settlement('/0')])).toBeUndefined();
  });
});
