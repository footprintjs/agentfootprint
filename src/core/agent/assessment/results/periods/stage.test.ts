import { expect, it, vi } from 'vitest';
import { statePointer } from '../../pointer.js';
import { periodUsesToolWords, periodWordsOccurrenceReader } from './stage.js';

it('joins only retained period witnesses at their own array addresses', () => {
  const period = { kind: 'period', callOccurrenceKey: [1, 2, 3, 4, 5] };
  const retained = vi.fn(() => [
    period,
    { ...period, kind: 'coverage' },
    { ...period, callOccurrenceKey: [1, 2] },
  ]);
  const occurrenceOf = periodWordsOccurrenceReader(retained);

  expect(periodUsesToolWords('period-partly-held')).toBe(true);
  expect(periodUsesToolWords('declared-absent')).toBe(false);
  expect(occurrenceOf(statePointer('coverageDeclared', 0))).toBeUndefined();
  expect(occurrenceOf(statePointer('findingsLedger', '00'))).toBeUndefined();
  expect(retained).not.toHaveBeenCalled();
  expect(occurrenceOf(statePointer('findingsLedger', 0, 'verdict'))).toBe('1.2.3.4.5');
  expect(occurrenceOf(statePointer('findingsLedger', 1))).toBeUndefined();
  expect(occurrenceOf(statePointer('findingsLedger', 2))).toBeUndefined();
  expect(retained).toHaveBeenCalledOnce();
});
