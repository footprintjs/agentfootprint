import { describe, expect, it, vi } from 'vitest';
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
});
