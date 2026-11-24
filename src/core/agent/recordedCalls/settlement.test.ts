import { describe, expect, it, vi } from 'vitest';
import { recordedToolFailureCategory } from './execution.js';
import { readToolSettlements } from './settlement.js';

const proof = { callOccurrenceKey: [1, 2, 3, 4, 0], execution: 'returned', delivery: 'native' };

describe('stored tool settlement proof', () => {
  it('marks a known unreadable field incomplete without invoking its accessor', () => {
    const getter = vi.fn(() => 'pending');
    const row = Object.defineProperty({ ...proof }, 'reportedStatus', { get: getter });

    expect(readToolSettlements([row], true)).toMatchObject({ rows: [], complete: false });
    expect(getter).not.toHaveBeenCalled();
  });

  it('does not pick a winner between rows claiming one occurrence', () => {
    expect(readToolSettlements([proof, { ...proof, delivery: 'withheld' }], true)).toMatchObject({
      rows: [],
      complete: false,
    });
  });

  it('keeps a closed failure category and ignores an unreadable optional category', () => {
    const failed = { callOccurrenceKey: [1, 2, 3, 4, 0], execution: 'threw', outcome: 'failed' };
    const recorded = { ...failed, failureCategory: 'timeout' };
    expect(readToolSettlements([recorded], true)).toMatchObject({
      rows: [recorded],
      complete: true,
    });

    const getter = vi.fn(() => 'timeout');
    const unreadable = Object.defineProperty({ ...failed }, 'failureCategory', { get: getter });
    const unknownCategory = { ...failed, failureCategory: 'unrecognized' };
    for (const row of [unreadable, unknownCategory]) {
      const read = readToolSettlements([row], true);
      expect(read?.rows).toEqual([failed]);
      expect(read?.complete).toBe(true);
    }
    expect(getter).not.toHaveBeenCalled();
  });

  it('reads a category only for an admitted failed throw', () => {
    const result = {
      toolFailureCategory: 'timeout',
      toolResultExecution: 'threw',
      outcome: 'failed',
    };
    expect(recordedToolFailureCategory(result)).toBe('timeout');
    for (const toolResultDisposition of ['withheld', 'rewritten']) {
      expect(recordedToolFailureCategory({ ...result, toolResultDisposition })).toBeUndefined();
    }
    expect(recordedToolFailureCategory({ ...result, outcome: 'refused' })).toBeUndefined();
    expect(
      recordedToolFailureCategory({ ...result, toolResultExecution: 'returned' }),
    ).toBeUndefined();
  });
});
