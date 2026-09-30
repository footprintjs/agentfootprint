/**
 * core/time/range — the one range, its two spellings, one conversion per boundary (§ 3.3).
 *
 * Test types:
 *   unit        — parse / spell / covers / overlaps / roundOutward, row by row;
 *   functional  — each § 3.3 boundary on a worked example ("to 8:40" is `[08:00, 08:41)`);
 *   integration — `arguments/declare.ts` reads an `iso-range` through `splitRange` (`byte-identity-rows.test.ts`);
 *   property    — over 5 000 generated ranges: `parseRange` ↔ `spellRange` under both joiners, and EVERY
 *                 boundary round-trips (inclusive span, tool bound under both edges, look-back);
 *   security    — a joiner-only 1 MB string, non-strings and extra keys are refused, never thrown on;
 *   performance — the property sweep's own budget;
 *   load        — not applicable: pure functions with no shared state.
 */

import { describe, expect, it } from 'vitest';

import {
  compareInstants,
  instantOf,
  spellInstant,
  type Instant,
} from '../../../src/core/time/instant.js';
import { AXIS_UNITS, LOOKBACK_UNITS } from '../../../src/core/time/duration.js';
import {
  boundFrom,
  boundInto,
  covers,
  fromInclusive,
  isTimeRange,
  lookbackOf,
  lookbackRange,
  overlaps,
  parseRange,
  roundOutward,
  spellRange,
  splitRange,
  stepMsOf,
  toInclusive,
  type TimeRange,
} from '../../../src/core/time/range.js';
import { int, pick, prng } from './fixtures/generate.js';

const same = (a: string, b: string): boolean =>
  compareInstants(instantOf(a, 'strict') as Instant, instantOf(b, 'strict') as Instant) === 0;

const R = (from: string, to: string): TimeRange => ({ from, to });

describe('the spellings — unit', () => {
  it('an ISO 8601 interval and a joined argument', () => {
    expect(parseRange('2026-10-09T08:00:00-07:00/2026-10-09T08:41:00-07:00')).toEqual(
      R('2026-10-09T08:00:00-07:00', '2026-10-09T08:41:00-07:00'),
    );
    expect(parseRange('2026-10-09T08:00Z..2026-10-09T09:00Z', '..')).toEqual(
      R('2026-10-09T08:00Z', '2026-10-09T09:00Z'),
    );
    expect(spellRange(R('2026-10-09T08:00Z', '2026-10-09T09:00Z'), '..')).toBe(
      '2026-10-09T08:00Z..2026-10-09T09:00Z',
    );
  });

  it.each([
    ['2026-10-09T09:00Z/2026-10-09T08:00Z', 'reversed'],
    ['2026-10-09T08:00Z/2026-10-09T08:00Z', 'empty'],
    ['2026-10-09T08:00Z/2026-10-09T09:00Z/2026-10-09T10:00Z', 'two joiners'],
    ['2026-10-09T08:00z/2026-10-09T09:00Z', 'lower case — the strict profile'],
    ['2026-10-09/2026-10-10', 'dates alone'],
    ['2026-10-09T08:00Z..2026-10-09T09:00Z', 'the other joiner'],
  ])('%s is no TimeRange (%s)', (text) => {
    expect(parseRange(text)).toBeUndefined();
  });

  it('splitRange is the format check: order is not its question', () => {
    expect(splitRange('2026-10-09T09:00Z..2026-10-09T08:00Z', '..', 'strict')).toBeDefined();
    expect(splitRange('2026-10-09t09:00z..2026-10-09T08:00Z', '..', 'strict')).toBeUndefined();
    expect(splitRange('2026-10-09t09:00z..2026-10-09T08:00Z', '..', 'lenient')).toBeDefined();
  });

  it('isTimeRange: strict instants, from before to, nothing else', () => {
    expect(isTimeRange(R('2026-10-09T08:00Z', '2026-10-09T09:00Z'))).toBe(true);
    expect(isTimeRange({ from: '2026-10-09T08:00Z', to: '2026-10-09T09:00Z', zone: 'UTC' })).toBe(
      false,
    );
    expect(isTimeRange(R('2026-10-09T09:00Z', '2026-10-09T08:00Z'))).toBe(false);
    expect(() => spellRange(R('2026-10-09T09:00Z', '2026-10-09T08:00Z'))).toThrow(TypeError);
  });

  it('covers and overlaps are half-open: touching ends do not overlap', () => {
    const day = R('2026-10-09T00:00Z', '2026-10-10T00:00Z');
    const morning = R('2026-10-09T08:00Z', '2026-10-09T12:00Z');
    const next = R('2026-10-10T00:00Z', '2026-10-10T01:00Z');
    expect(covers(day, morning)).toBe(true);
    expect(covers(morning, day)).toBe(false);
    expect(covers(day, day)).toBe(true);
    expect(overlaps(day, morning)).toBe(true);
    expect(overlaps(day, next)).toBe(false);
    // The same instants in another offset are the same range.
    expect(covers(R('2026-10-09T01:00-07:00', '2026-10-09T05:00-07:00'), morning)).toBe(true);
  });

  it('roundOutward widens, never narrows, and says so', () => {
    expect(roundOutward(R('2026-10-09T08:07:30Z', '2026-10-09T08:41:00Z'), 5 * 60_000)).toEqual({
      range: R('2026-10-09T08:05:00Z', '2026-10-09T08:45:00Z'),
      rounded: true,
    });
    const whole = R('2026-10-09T08:00Z', '2026-10-09T09:00Z');
    expect(roundOutward(whole, 60_000)).toEqual({ range: whole, rounded: false });
    expect(
      roundOutward(R('2026-10-09T08:00:00.5-07:00', '2026-10-09T08:00:01.5-07:00'), 1_000),
    ).toEqual({
      range: R('2026-10-09T08:00:00-07:00', '2026-10-09T08:00:02-07:00'),
      rounded: true,
    });
  });

  it('the step: a tool granularity, else 1 ms', () => {
    expect(stepMsOf(undefined, LOOKBACK_UNITS)).toBe(1);
    expect(stepMsOf('1m', LOOKBACK_UNITS)).toBe(60_000);
    expect(stepMsOf('1s', AXIS_UNITS)).toBe(1_000);
    expect(() => stepMsOf('1s', LOOKBACK_UNITS)).toThrow(TypeError);
  });
});

describe('the § 3.3 boundaries — functional', () => {
  it('a person\'s "8:00 to 8:40", read to the end of its grain, shown through 08:40', () => {
    const asked = R('2026-10-09T08:00:00-07:00', '2026-10-09T08:41:00-07:00');
    expect(toInclusive(asked, 60_000)).toEqual({
      from: '2026-10-09T08:00:00-07:00',
      to: '2026-10-09T08:40:00-07:00',
    });
  });

  it("a result's inclusive `queried` read back with the tool's step (else 1 ms)", () => {
    const queried = { from: '2026-10-09T08:00:00Z', to: '2026-10-09T08:40:00Z' };
    expect(fromInclusive(queried, 60_000)).toEqual(
      R('2026-10-09T08:00:00Z', '2026-10-09T08:41:00Z'),
    );
    expect(fromInclusive(queried)).toEqual(R('2026-10-09T08:00:00Z', '2026-10-09T08:40:00.001Z'));
    // A lenient spelling a result may declare is read, and respelled strict.
    expect(fromInclusive({ from: '2026-10-09t08:00z', to: '2026-12-31T23:59:60Z' }, 1_000)).toEqual(
      R('2026-10-09T08:00:00Z', '2027-01-01T00:00:01Z'),
    );
    expect(() => fromInclusive({ from: '2026-10-09T09:00Z', to: '2026-10-09T08:00Z' })).toThrow(
      TypeError,
    );
  });

  it("a tool's `to` bound under each edge", () => {
    expect(boundInto('2026-10-09T08:41:00-07:00', 'exclusive', 60_000)).toBe(
      '2026-10-09T08:41:00-07:00',
    );
    expect(boundInto('2026-10-09T08:41:00-07:00', 'inclusive', 1_000)).toBe(
      '2026-10-09T08:40:59-07:00',
    );
    expect(boundFrom('2026-10-09T08:40:59-07:00', 'inclusive', 1_000)).toBe(
      '2026-10-09T08:41:00-07:00',
    );
  });

  it('a look-back at a dispatch instant, and back', () => {
    const range = lookbackRange('2026-10-09T08:40:00-07:00', '40m', LOOKBACK_UNITS);
    expect(range).toEqual(R('2026-10-09T08:00:00-07:00', '2026-10-09T08:40:00.001-07:00'));
    expect(lookbackOf(range, LOOKBACK_UNITS)).toEqual({
      until: '2026-10-09T08:40:00-07:00',
      duration: '40m',
    });
    expect(
      lookbackOf(R('2026-10-09T08:00:00Z', '2026-10-09T08:00:30.001Z'), LOOKBACK_UNITS),
    ).toBeUndefined();
    expect(lookbackOf(R('2026-10-09T08:00:00Z', '2026-10-09T08:00:30.001Z'), AXIS_UNITS)).toEqual({
      until: '2026-10-09T08:00:30Z',
      duration: '30s',
    });
  });

  it('a range narrower than one step has no inclusive spelling at that step', () => {
    expect(() => toInclusive(R('2026-10-09T08:00:00Z', '2026-10-09T08:00:30Z'), 60_000)).toThrow(
      RangeError,
    );
  });
});

describe('round trips — property', () => {
  const r = prng(33);
  const offsets = [0, -420, -480, 60, 330, 345, 765, 840, -210];
  const STEPS = [1, 1_000, 60_000, 3_600_000, 86_400_000];

  /** A strict range: whole-ms or 9-digit bounds in random offsets, from before to. */
  function range(): TimeRange {
    const base = Date.UTC(
      int(r, 1971, 2090),
      int(r, 0, 11),
      int(r, 1, 28),
      int(r, 0, 23),
      int(r, 0, 59),
    );
    const from: Instant = {
      ms: base + int(r, 0, 59_999),
      nanos: r() < 0.2 ? int(r, 0, 999_999) : 0,
    };
    const to: Instant = { ms: from.ms + int(r, 1, 40) * pick(r, STEPS), nanos: from.nanos };
    return {
      from: spellInstant(from, pick(r, offsets)) as string,
      to: spellInstant(to, pick(r, offsets)) as string,
    };
  }
  const cases = Array.from({ length: 5_000 }, range);

  it('parseRange ↔ spellRange under both joiners', () => {
    for (const x of cases) {
      for (const joiner of ['/', '..'] as const) {
        const text = spellRange(x, joiner);
        expect(parseRange(text, joiner), text).toEqual(x);
        expect(spellRange(parseRange(text, joiner) as TimeRange, joiner)).toBe(text);
      }
    }
  });

  it('every boundary round-trips: inclusive span, tool bound (both edges), look-back', () => {
    for (const x of cases) {
      for (const step of STEPS) {
        // inclusive span (a declared period, SQL BETWEEN, a chart brush)
        let span;
        try {
          span = toInclusive(x, step);
        } catch (e) {
          expect(e).toBeInstanceOf(RangeError); // narrower than one step
          continue;
        }
        const back = fromInclusive(span, step);
        expect(same(back.from, x.from) && same(back.to, x.to), JSON.stringify({ x, step })).toBe(
          true,
        );
        // a tool's to-bound, under each edge
        for (const edge of ['inclusive', 'exclusive'] as const) {
          expect(same(boundFrom(boundInto(x.to, edge, step), edge, step), x.to)).toBe(true);
        }
      }
      // a look-back, wherever the range's length is a whole look-back
      const lb = lookbackOf(x, AXIS_UNITS);
      if (lb !== undefined) {
        const again = lookbackRange(lb.until, lb.duration, AXIS_UNITS);
        expect(same(again.from, x.from) && same(again.to, x.to), JSON.stringify(x)).toBe(true);
      }
    }
  });

  it('roundOutward only ever widens, and the widened range is whole steps', () => {
    for (const x of cases) {
      const step = pick(r, STEPS);
      const { range: wide, rounded } = roundOutward(x, step);
      expect(covers(wide, x)).toBe(true);
      expect(rounded).toBe(!(same(wide.from, x.from) && same(wide.to, x.to)));
      for (const bound of [wide.from, wide.to]) {
        const i = instantOf(bound, 'strict') as Instant;
        expect(i.nanos).toBe(0);
        expect(((i.ms % step) + step) % step).toBe(0);
      }
    }
  });
});

describe('hostile input — security', () => {
  it('a 1 MB run of joiners is refused in linear time', () => {
    const long = '..'.repeat(500_000);
    const started = performance.now();
    expect(parseRange(long, '..')).toBeUndefined();
    expect(splitRange(`2026-10-09T08:00Z${'/'.repeat(1_000_000)}`, '/', 'strict')).toBeUndefined();
    expect(performance.now() - started).toBeLessThan(500);
  });

  it.each([null, undefined, 42, {}, ['a', 'b']])('parseRange(%j) is undefined', (value) => {
    expect(parseRange(value)).toBeUndefined();
    expect(isTimeRange(value)).toBe(false);
  });

  it('a conversion handed a malformed range is a caller error, named', () => {
    expect(() =>
      covers({ from: 'x', to: 'y' }, R('2026-10-09T08:00Z', '2026-10-09T09:00Z')),
    ).toThrow(/is not a TimeRange/);
    expect(() => toInclusive(R('2026-10-09T08:00Z', '2026-10-09T09:00Z'), 0)).toThrow(
      /positive whole number/,
    );
    expect(() => boundInto('2026-10-09t08:00z', 'inclusive', 1)).toThrow(TypeError);
  });
});
