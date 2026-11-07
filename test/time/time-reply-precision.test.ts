import { expect, it } from 'vitest';
import { validateCheckpoint } from '../../src/core/runCheckpoint.js';
import { lookbackRange } from '../../src/time/range.js';
import { isCorrectedMeaning } from '../../src/time/rows/meaning.js';
import { timeRowIsWellFormed } from '../../src/time/rows.js';

it('a sub-millisecond clock keeps its exact corrected duration through runCheckpoint', () => {
  const range = lookbackRange('2026-11-06T18:01:00.123456789Z', '2h', 'smhdw');
  const row = {
    kind: 'time-answer',
    turn: 1,
    iteration: 0,
    mention: 0,
    ...range,
    zone: 'UTC',
    how: 'confirmed',
    corrected: { lookback: '2h' },
  };
  expect(isCorrectedMeaning(row.corrected, range)).toBe(true);
  expect(timeRowIsWellFormed(row)).toBe(true);
  const checkpoint = {
    version: 1,
    runId: 'precise-clock',
    history: [],
    lastCompletedIteration: 0,
    originalInput: { message: 'a corrected time' },
    checkpointedAt: 1,
    findingsLedger: [row],
  };
  expect(validateCheckpoint(JSON.parse(JSON.stringify(checkpoint))).findingsLedger).toEqual([row]);
  expect(
    isCorrectedMeaning(row.corrected, { ...range, to: '2026-11-06T18:01:00.124456788Z' }),
  ).toBe(false);
});
