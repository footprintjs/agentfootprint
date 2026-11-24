import { describe, expect, it } from 'vitest';

import { readRunTime } from '../../src/time/clock.js';
import { instantOf, compareInstants } from '../../src/time/instant.js';
import { resolveMention } from '../../src/time/resolve.js';
import { timeAnswerRow, timeRowIsWellFormed } from '../../src/time/rows.js';

const from = '2026-11-24T10:00:00Z';
const cutoff = '2026-11-24T10:45:00Z';
const zone = 'UTC';

function contains(range: { from: string; to: string }, stamp: string): boolean {
  const time = instantOf(stamp, 'strict')!;
  return (
    compareInstants(instantOf(range.from, 'strict')!, time) <= 0 &&
    compareInstants(time, instantOf(range.to, 'strict')!) < 0
  );
}

describe('confirmed window endpoints', () => {
  it('offers the exact minute and stores its precision through confirmation', () => {
    const resolution = resolveMention(
      [
        {
          date: { kind: 'fixed', year: 2026, month: 11, day: 24 },
          rangeOf: [
            { wall: { h: 10, meridiem: 'am' } },
            { wall: { h: 10, m: 45, meridiem: 'am' } },
          ],
        },
      ],
      { now: '2026-11-24T11:00:00Z', zone },
      { id: 'time-window-fixture', kind: 'rule' },
    );
    const [candidate] = resolution.candidates;
    expect(candidate.range).toEqual({ from, to: cutoff });
    const answer = timeAnswerRow(
      { mention: 0, range: candidate.range, zone, how: 'confirmed', endpoint: candidate.endpoint },
      { turn: 0, iteration: 0 },
    );
    expect(answer.endpoint).toEqual({ cutoff, end: 'exclusive', precision: 'minute' });
    expect(timeRowIsWellFormed({ ...answer })).toBe(true);
    expect(contains(answer, '2026-11-24T10:44:59.999Z')).toBe(true);
    expect(contains(answer, cutoff)).toBe(false);
  });

  it('lets an explicit control include the cutoff instant only', () => {
    const read = readRunTime({
      window: { from, to: cutoff, end: 'inclusive', precision: 'minute' },
    });
    expect(read).not.toHaveProperty('problem');
    if ('problem' in read || read.value?.window === undefined) throw new Error('Expected a window');
    expect(read.value.window.endpoint).toEqual({ cutoff, end: 'inclusive', precision: 'minute' });
    expect(contains(read.value.window, cutoff)).toBe(true);
    expect(contains(read.value.window, '2026-11-24T10:45:00.000000001Z')).toBe(false);
  });
});
