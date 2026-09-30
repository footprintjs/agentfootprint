/**
 * core/time/duration — the ONE duration grammar, units per use.
 *
 * Test types:
 *   unit        — the grammar and the unit sets, row by row (§ 12.1 rows d and e pinned here);
 *   functional  — `durationMs` / `spellDuration` name the same length;
 *   integration — `arguments/declare.ts` · `parsesUnderSpelling` reads a look-back through this grammar
 *                 (`byte-identity-rows.test.ts`);
 *   property    — over 20 000 generated strings the look-back set equals the pre-T1 `LOOKBACK` regex;
 *                 `durationMs(spellDuration(x)) === x` and `spellDuration(durationMs(t))` names t's length;
 *   security    — a 1 MB digit run is refused or measured in linear time, never thrown on;
 *   performance — covered by the property sweep's own budget;
 *   load        — not applicable: a pure function with no shared state.
 */

import { describe, expect, it } from 'vitest';

import {
  AXIS_UNITS,
  durationMs,
  durationParts,
  isDuration,
  isUnitSet,
  LOOKBACK_UNITS,
  spellDuration,
} from '../../../src/core/time/duration.js';
import { parsesUnderSpellingBefore } from './fixtures/before.js';
import { int, pick, prng } from './fixtures/generate.js';

describe('the grammar — unit', () => {
  it.each([
    ['30m', LOOKBACK_UNITS, true],
    ['24h', LOOKBACK_UNITS, true],
    ['7d', LOOKBACK_UNITS, true],
    ['2w', LOOKBACK_UNITS, true],
    ['1000000m', LOOKBACK_UNITS, true], // § 12.1 row d: no digit cap
    ['30s', LOOKBACK_UNITS, false], // § 12.1 row e: seconds are opt-in for a look-back
    ['30s', 'smhdw', true], // … and a tool that declares `units: 'smhdw'` takes them
    ['30s', AXIS_UNITS, true],
    ['0h', LOOKBACK_UNITS, false],
    ['01h', LOOKBACK_UNITS, false],
    ['-2h', LOOKBACK_UNITS, false],
    ['2H', LOOKBACK_UNITS, false],
    ['2 h', LOOKBACK_UNITS, false],
    ['2mo', LOOKBACK_UNITS, false],
    ['2y', LOOKBACK_UNITS, false],
    ['2h', 'h', true],
    ['2m', 'h', false],
  ] as const)('%s under %s → %s', (text, units, ok) => {
    expect(isDuration(text, units)).toBe(ok);
  });

  it('names the digits as written and the unit', () => {
    expect(durationParts('90m', LOOKBACK_UNITS)).toEqual({ digits: '90', unit: 'm' });
  });

  it.each([
    ['smhdw', true],
    ['wdhms', true],
    ['mhdw', true],
    ['s', true],
    ['', false],
    ['mm', false],
    ['smhdwy', false],
    ['x', false],
  ])('unit set %j → %s', (units, ok) => {
    expect(isUnitSet(units)).toBe(ok);
  });

  it('a unit set is named by every caller; a bad one is a caller error', () => {
    expect(() => isDuration('2h', 'hh')).toThrow(TypeError);
    expect(() => spellDuration(60_000, '')).toThrow(TypeError);
  });
});

describe('length — functional', () => {
  it.each([
    ['30s', AXIS_UNITS, 30_000],
    ['30m', LOOKBACK_UNITS, 1_800_000],
    ['2h', LOOKBACK_UNITS, 7_200_000],
    ['1d', LOOKBACK_UNITS, 86_400_000],
    ['1w', LOOKBACK_UNITS, 604_800_000],
    ['1000000m', LOOKBACK_UNITS, 60_000_000_000],
  ] as const)('%s → %d ms', (text, units, ms) => {
    expect(durationMs(text, units)).toBe(ms);
  });

  it('a duration too long to measure exactly is still a duration, but has no length', () => {
    const huge = `${'9'.repeat(20)}w`;
    expect(isDuration(huge, LOOKBACK_UNITS)).toBe(true);
    expect(durationMs(huge, LOOKBACK_UNITS)).toBeUndefined();
  });

  it.each([
    [7_200_000, LOOKBACK_UNITS, '2h'],
    [5_400_000, LOOKBACK_UNITS, '90m'],
    [604_800_000, LOOKBACK_UNITS, '1w'],
    [1_209_600_000, 'mhd', '14d'],
    [30_000, LOOKBACK_UNITS, undefined],
    [30_000, AXIS_UNITS, '30s'],
    [1_500, AXIS_UNITS, undefined],
    [0, AXIS_UNITS, undefined],
    [-60_000, AXIS_UNITS, undefined],
  ] as const)('spellDuration(%d, %s) → %s — the smallest exact spelling', (ms, units, text) => {
    expect(spellDuration(ms, units)).toBe(text);
  });
});

describe('byte identity and round trips — property', () => {
  const r = prng(424242);
  const cases = Array.from({ length: 20_000 }, () => {
    const digits = pick(r, [
      '0',
      '1',
      '9',
      '10',
      '01',
      String(int(r, 1, 99_999)),
      '1'.repeat(int(r, 1, 30)),
    ]);
    return `${pick(r, ['', '', '', '-', ' '])}${digits}${pick(r, [
      's',
      'm',
      'h',
      'd',
      'w',
      'M',
      'y',
      '',
      'mo',
    ])}`;
  });

  it('the look-back set equals the pre-T1 LOOKBACK regex on every generated string', () => {
    let accepted = 0;
    for (const text of cases) {
      const before = parsesUnderSpellingBefore(text, 'lookback');
      expect(isDuration(text, LOOKBACK_UNITS), text).toBe(before);
      if (before) accepted++;
    }
    expect(accepted).toBeGreaterThan(3_000);
  });

  it('durationMs ↔ spellDuration: the same length both ways', () => {
    for (const text of cases) {
      for (const units of [LOOKBACK_UNITS, AXIS_UNITS]) {
        const ms = durationMs(text, units);
        if (ms === undefined) continue;
        const spelled = spellDuration(ms, units) as string;
        expect(spelled, text).toBeDefined();
        expect(durationMs(spelled, units)).toBe(ms);
        expect(spelled.length).toBeLessThanOrEqual(text.length);
      }
    }
    const r2 = prng(3);
    for (let i = 0; i < 5_000; i++) {
      const ms = int(r2, 1, 10_000) * pick(r2, [1_000, 60_000, 3_600_000, 86_400_000]);
      const spelled = spellDuration(ms, AXIS_UNITS) as string;
      expect(durationMs(spelled, AXIS_UNITS)).toBe(ms);
    }
  });
});

describe('hostile input — security', () => {
  it('a 1 MB digit run is judged in linear time', () => {
    const long = `${'1'.repeat(1_000_000)}m`;
    const started = performance.now();
    expect(isDuration(long, LOOKBACK_UNITS)).toBe(true);
    expect(durationMs(long, LOOKBACK_UNITS)).toBeUndefined();
    expect(isDuration(`${long}x`, LOOKBACK_UNITS)).toBe(false);
    expect(performance.now() - started).toBeLessThan(500);
  });

  it.each([null, undefined, 42, {}, ['2h']])('refuses %j without throwing', (value) => {
    expect(isDuration(value, LOOKBACK_UNITS)).toBe(false);
    expect(durationMs(value, LOOKBACK_UNITS)).toBeUndefined();
  });
});
