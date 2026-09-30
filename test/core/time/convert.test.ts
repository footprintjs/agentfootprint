/**
 * A tool's period forms and the EXACT conversions (time design § 7.1, § 7.2,
 * step T5a) — `core/time/convert.ts`.
 *
 * Law: the library converts one range into the first form that holds it
 * exactly, crossing each argument boundary through `range.ts`; a form that
 * would widen, shift or drop part of the window is never chosen here.
 *
 * Test types:
 *   unit        — the sugar table; each form's own rules; every exact row of § 7.2 (look-back →
 *                 look-back with the sign added or removed; look-back → bounds as `[now − L, now)`;
 *                 a range → iso / epoch-ms / epoch-s (rounded outward) / wall / date; a whole day →
 *                 `day`; a range ending at now → the covering look-back, rounded); the rows that are
 *                 NOT exact answer `undefined`; the facts against a range;
 *   property    — every conversion reads back as the range it came from (seeded ranges, every
 *                 exact form, both edges);
 *   boundary    — a doubled wall hour is not exact; a sub-millisecond instant is not exact;
 *   performance — 10 000 conversions and read-backs inside a budget.
 */

import { describe, expect, it } from 'vitest';

import {
  convertExact,
  formIssue,
  granularityMsOf,
  parsesUnderForm,
  periodFactProblem,
  readBack,
  sameRange,
  sugarForms,
  type PeriodForm,
} from '../../../src/core/time/convert.js';

const LA = 'America/Los_Angeles';
const NOW = '2026-10-09T15:40:00Z';
const CTX = { now: NOW, zone: LA, granularityMs: 60_000 };
/** "8:00 to 8:40" read to the end of its minute. */
const ASKED = { from: '2026-10-09T08:00:00-07:00', to: '2026-10-09T08:41:00-07:00' };

const bounds = (
  as: 'iso' | 'epoch-ms' | 'epoch-s' | 'wall' | 'date',
  edge: 'inclusive' | 'exclusive' = 'inclusive',
): PeriodForm => ({
  kind: 'bounds',
  from: { argument: 'start', as },
  to: { argument: 'end', as, edge },
  ...((as === 'wall' || as === 'date') && { zone: { argument: 'tz' } }),
});

describe('the sugar (§ 7.1)', () => {
  it('reads each single-argument spelling as its form, in `accepts` order', () => {
    expect(sugarForms({ argument: 'window', spelling: 'lookback' })).toEqual([
      { kind: 'lookback', argument: 'window', signed: false },
    ]);
    expect(sugarForms({ argument: 'window', spelling: 'signed-lookback' })).toEqual([
      { kind: 'lookback', argument: 'window', signed: true },
    ]);
    expect(sugarForms({ argument: 'window', spelling: 'iso-range' })).toEqual([
      { kind: 'joined', argument: 'window', as: 'iso', joiner: '..', edge: 'inclusive' },
    ]);
    expect(
      sugarForms({
        argument: 'window',
        accepts: ['signed-lookback', 'wall-range'],
        zoneArgument: 'timezone',
      }),
    ).toEqual([
      { kind: 'lookback', argument: 'window', signed: true },
      {
        kind: 'joined',
        argument: 'window',
        as: 'wall',
        joiner: '..',
        edge: 'inclusive',
        zone: { argument: 'timezone' },
      },
    ]);
  });

  it('an argument with no spelling has no form; `forms` is read as written', () => {
    expect(sugarForms({ argument: 'window' })).toEqual([]);
    const forms = [bounds('epoch-ms', 'exclusive')];
    expect(sugarForms({ forms })).toBe(forms);
  });
});

describe("a form's own rules", () => {
  it.each([
    ['an unknown kind', { kind: 'week', argument: 'w' }],
    ['an unknown key', { kind: 'day', argument: 'd', joiner: '..' }],
    [
      'a bound with no `as`',
      {
        kind: 'bounds',
        from: { argument: 'a' },
        to: { argument: 'b', as: 'iso', edge: 'exclusive' },
      },
    ],
    [
      'one argument for both bounds',
      {
        kind: 'bounds',
        from: { argument: 'a', as: 'iso' },
        to: { argument: 'a', as: 'iso', edge: 'exclusive' },
      },
    ],
    [
      'an exclusive start',
      {
        kind: 'bounds',
        from: { argument: 'a', as: 'iso', edge: 'exclusive' },
        to: { argument: 'b', as: 'iso', edge: 'exclusive' },
      },
    ],
    ['a third joiner', { kind: 'joined', argument: 'w', as: 'iso', joiner: '-' }],
    [
      'object keys that repeat',
      { kind: 'object', argument: 'w', keys: { from: 'x', to: 'x' }, as: 'iso', edge: 'inclusive' },
    ],
    ['units outside smhdw', { kind: 'lookback', argument: 'w', signed: false, units: 'mhy' }],
    ['a zone that is not { argument }', { kind: 'day', argument: 'd', zone: 'UTC' }],
  ])('refuses %s', (_what, form) => {
    expect(formIssue(form)).toMatch(/\S/);
  });

  it('TQ18: a `bounds` end and an `object` form must declare their edge — the library never guesses it', () => {
    expect(
      formIssue({
        kind: 'bounds',
        from: { argument: 'a', as: 'iso' },
        to: { argument: 'b', as: 'iso' },
      }),
    ).toMatch(/to\.edge is missing/);
    expect(
      formIssue({ kind: 'object', argument: 'o', keys: { from: 'f', to: 't' }, as: 'iso' }),
    ).toMatch(/edge is missing/);
    // Only the sugar defaults — its `joined` form writes `edge: 'inclusive'` itself; a
    // hand-written `joined` form is the sugar's shape and keeps the default.
    expect(formIssue({ kind: 'joined', argument: 'w', as: 'iso', joiner: '/' })).toBeUndefined();
  });

  it('takes every well-formed kind', () => {
    for (const form of [
      bounds('epoch-ms', 'exclusive'),
      { kind: 'joined', argument: 'w', as: 'iso', joiner: '/' },
      {
        kind: 'object',
        argument: 'w',
        keys: { from: 'gte', to: 'lt' },
        as: 'epoch-s',
        edge: 'exclusive',
      },
      { kind: 'day', argument: 'd', zone: { argument: 'tz' } },
      { kind: 'lookback', argument: 'w', signed: true, units: 'smhdw' },
    ]) {
      expect(formIssue(form)).toBeUndefined();
    }
  });

  it('judges a declared value by the form that names its argument', () => {
    const lookback: PeriodForm = { kind: 'lookback', argument: 'w', signed: false, units: 'smhdw' };
    expect(parsesUnderForm('30s', lookback, 'w')).toBe(true);
    expect(parsesUnderForm('30s', { ...lookback, units: undefined } as PeriodForm, 'w')).toBe(
      false,
    );
    expect(parsesUnderForm(1760022000000, bounds('epoch-ms'), 'start')).toBe(true);
    expect(parsesUnderForm('1760022000000', bounds('epoch-ms'), 'start')).toBe(false);
    expect(parsesUnderForm('2026-10-09T08:00', bounds('wall'), 'start')).toBe(true);
    expect(parsesUnderForm('PST', bounds('wall'), 'tz')).toBe(false);
    expect(
      parsesUnderForm('2026-02-30', { kind: 'day', argument: 'd', zone: { argument: 'tz' } }, 'd'),
    ).toBe(false);
  });
});

describe('the exact rows of § 7.2', () => {
  it('a look-back → a look-back, the sign added or removed, respelled in the units', () => {
    const window = {
      range: { from: '2026-10-09T15:00:00Z', to: '2026-10-09T15:40:00.001Z' },
      lookback: '40m',
    };
    expect(convertExact(window, [{ kind: 'lookback', argument: 'w', signed: true }], CTX)).toEqual({
      form: 0,
      values: { w: '-40m' },
    });
    const hour = { range: window.range, lookback: '3600s' };
    expect(convertExact(hour, [{ kind: 'lookback', argument: 'w', signed: false }], CTX)).toEqual({
      form: 0,
      values: { w: '1h' },
    });
    // 90 s has no spelling in `mhdw`: not exact here (the covering look-back is the next step's).
    const ninety = { range: window.range, lookback: '90s' };
    expect(
      convertExact(ninety, [{ kind: 'lookback', argument: 'w', signed: false }], CTX),
    ).toBeUndefined();
  });

  it('a look-back → bounds as `[now − L, now)`', () => {
    const window = {
      range: { from: '2026-10-09T15:00:00Z', to: '2026-10-09T15:40:00.001Z' },
      lookback: '40m',
    };
    expect(convertExact(window, [bounds('epoch-ms', 'exclusive')], CTX)?.values).toEqual({
      start: Date.parse('2026-10-09T15:00:00Z'),
      end: Date.parse('2026-10-09T15:40:00Z'),
    });
  });

  it('a range → iso (the `to` bound per its edge), epoch-ms, and epoch-s rounded outward', () => {
    expect(
      convertExact({ range: ASKED }, sugarForms({ argument: 'w', spelling: 'iso-range' }), CTX),
    ).toEqual({
      form: 0,
      values: { w: '2026-10-09T08:00:00-07:00..2026-10-09T08:40:59-07:00' },
    });
    expect(convertExact({ range: ASKED }, [bounds('iso', 'exclusive')], CTX)?.values).toEqual({
      start: '2026-10-09T08:00:00-07:00',
      end: '2026-10-09T08:41:00-07:00',
    });
    expect(convertExact({ range: ASKED }, [bounds('epoch-ms', 'inclusive')], CTX)?.values).toEqual({
      start: Date.parse(ASKED.from),
      end: Date.parse(ASKED.to) - 1,
    });
    const ragged = { from: '2026-10-09T08:00:00.250-07:00', to: '2026-10-09T08:41:00.500-07:00' };
    expect(convertExact({ range: ragged }, [bounds('epoch-s', 'exclusive')], CTX)).toEqual({
      form: 0,
      values: { start: Date.parse(ASKED.from) / 1000, end: Date.parse(ASKED.to) / 1000 + 1 },
      rounded: true,
    });
  });

  it('a range → wall times in the zone, and the zone argument', () => {
    expect(
      convertExact(
        { range: ASKED },
        sugarForms({ argument: 'w', spelling: 'wall-range', zoneArgument: 'tz' }),
        CTX,
      )?.values,
    ).toEqual({
      w: '2026-10-09T08:00:00..2026-10-09T08:40:59',
      tz: LA,
    });
  });

  it('a whole day → `day` and `date` bounds; any other range is not exact for them', () => {
    const day = { from: '2026-10-09T00:00:00-07:00', to: '2026-10-10T00:00:00-07:00' };
    const dayForm: PeriodForm = { kind: 'day', argument: 'd', zone: { argument: 'tz' } };
    expect(convertExact({ range: day }, [dayForm], CTX)?.values).toEqual({
      d: '2026-10-09',
      tz: LA,
    });
    expect(convertExact({ range: day }, [bounds('date', 'inclusive')], CTX)?.values).toEqual({
      start: '2026-10-09',
      end: '2026-10-09',
      tz: LA,
    });
    expect(convertExact({ range: ASKED }, [dayForm], CTX)).toBeUndefined();
    // From midnight but short of the next one: not a whole day — sending the day would widen it.
    const shortOfMidnight = { from: '2026-10-09T00:00:00-07:00', to: '2026-10-09T23:00:00-07:00' };
    expect(convertExact({ range: shortOfMidnight }, [dayForm], CTX)).toBeUndefined();
  });

  it('a range ending at now → the smallest covering look-back in the units, rounded', () => {
    const endingNow = { from: '2026-10-09T15:00:20Z', to: '2026-10-09T15:40:00Z' };
    expect(
      convertExact({ range: endingNow }, [{ kind: 'lookback', argument: 'w', signed: true }], CTX),
    ).toEqual({
      form: 0,
      values: { w: '-40m' },
      rounded: true,
    });
    // Ending before now (outside the step): not exact — the covering look-back widens (T5b).
    const earlier = { from: '2026-10-09T14:00:00Z', to: '2026-10-09T15:00:00Z' };
    expect(
      convertExact({ range: earlier }, [{ kind: 'lookback', argument: 'w', signed: true }], CTX),
    ).toBeUndefined();
  });

  it('picks the first form that is exact, skipping one that is not', () => {
    const forms: PeriodForm[] = [
      { kind: 'lookback', argument: 'w', signed: true },
      bounds('epoch-ms', 'exclusive'),
    ];
    const morning = { from: '2026-10-09T06:00:00-07:00', to: '2026-10-09T07:00:00-07:00' };
    expect(convertExact({ range: morning }, forms, CTX)?.form).toBe(1);
    // "8:00 to 8:40" ends within a minute of now (15:40Z) — the look-back holds it, rounded.
    expect(convertExact({ range: ASKED }, forms, CTX)).toMatchObject({ form: 0, rounded: true });
  });

  it('a wall time the zone doubles is not exact; a wall form with no zone is not exact', () => {
    const doubled = { from: '2026-11-01T08:30:00Z', to: '2026-11-01T09:00:00Z' }; // 01:30 PDT, the hour repeats
    expect(convertExact({ range: doubled }, [bounds('wall', 'exclusive')], CTX)).toBeUndefined();
    const noZone: PeriodForm = { kind: 'joined', argument: 'w', as: 'wall', joiner: '..' };
    expect(convertExact({ range: ASKED }, [noZone], CTX)).toBeUndefined();
    expect(convertExact({ range: ASKED }, [noZone], { ...CTX, appZone: LA })).toBeDefined();
  });
});

describe('reading a sent value back (§ 3.3)', () => {
  it('reads each form back as the half-open range', () => {
    expect(
      sameRange(
        readBack(
          { w: '2026-10-09T08:00-07:00..2026-10-09T08:40-07:00' },
          sugarForms({ argument: 'w', spelling: 'iso-range' })[0]!,
          CTX,
        )!,
        ASKED,
      ),
    ).toBe(true);
    expect(
      sameRange(
        readBack(
          { start: Date.parse(ASKED.from), end: Date.parse(ASKED.to) },
          bounds('epoch-ms', 'exclusive'),
          CTX,
        )!,
        ASKED,
      ),
    ).toBe(true);
    expect(readBack({ start: 'x', end: 1 }, bounds('epoch-ms'), CTX)).toBeUndefined();
    expect(
      readBack({ w: '-2h' }, { kind: 'lookback', argument: 'w', signed: false }, CTX),
    ).toBeUndefined();
    expect(
      readBack(
        { w: '2026-10-09T08:00..2026-10-09T08:40', tz: 'PST' },
        sugarForms({ argument: 'w', spelling: 'wall-range', zoneArgument: 'tz' })[0]!,
        CTX,
      ),
    ).toBeUndefined();
  });

  it('property — every exact conversion reads back as the range it came from', () => {
    let seed = 7;
    const next = (): number => {
      seed = (seed * 1_103_515_245 + 12_345) % 2_147_483_648;
      return seed;
    };
    const forms: PeriodForm[] = [
      bounds('iso', 'inclusive'),
      bounds('iso', 'exclusive'),
      bounds('epoch-ms', 'inclusive'),
      bounds('epoch-ms', 'exclusive'),
      bounds('wall', 'inclusive'),
      bounds('wall', 'exclusive'),
      { kind: 'joined', argument: 'w', as: 'epoch-ms', joiner: '/', edge: 'exclusive' },
      {
        kind: 'object',
        argument: 'w',
        keys: { from: 'gte', to: 'lt' },
        as: 'iso',
        edge: 'exclusive',
      },
    ];
    let checked = 0;
    for (let i = 0; i < 400; i++) {
      const fromMs =
        Date.parse('2026-01-01T00:00:00Z') + (next() % 300) * 86_400_000 + (next() % 86_400) * 1000;
      const toMs = fromMs + 1000 + (next() % 172_800) * 1000;
      const range = { from: new Date(fromMs).toISOString(), to: new Date(toMs).toISOString() };
      for (const form of forms) {
        const sent = convertExact({ range }, [form], CTX);
        if (sent === undefined) continue; // a doubled wall hour
        const back = readBack(sent.values, form, CTX);
        expect(
          back !== undefined && sameRange(back, range),
          `${JSON.stringify(form)} ${JSON.stringify(range)}`,
        ).toBe(true);
        checked++;
      }
    }
    expect(checked).toBeGreaterThan(3000);
  });

  it('performance — 10 000 conversions and read-backs stay well inside a budget', () => {
    const form = bounds('iso', 'inclusive');
    const started = performance.now();
    for (let i = 0; i < 10_000; i++) {
      const sent = convertExact({ range: ASKED }, [form], CTX)!;
      readBack(sent.values, form, CTX);
    }
    expect(performance.now() - started).toBeLessThan(3000);
  });
});

describe("the tool's facts against a range", () => {
  it('names the first fact a range breaks, and only a declared one', () => {
    const future = { from: '2026-10-09T16:00:00Z', to: '2026-10-09T17:00:00Z' };
    expect(periodFactProblem(future, { direction: 'past' }, NOW)).toBe('time-future');
    expect(periodFactProblem(future, {}, NOW)).toBeUndefined();
    const morning = { from: '2026-10-09T06:00:00-07:00', to: '2026-10-09T07:00:00-07:00' };
    expect(periodFactProblem(morning, { direction: 'future' }, NOW)).toBe('time-past');
    const old = { from: '2026-08-01T00:00:00Z', to: '2026-08-02T00:00:00Z' };
    expect(periodFactProblem(old, { retention: '30d' }, NOW)).toBe('beyond-retention');
    // Partly inside retention: taken — the result's `held` decides.
    const straddles = { from: '2026-09-01T00:00:00Z', to: '2026-09-20T00:00:00Z' };
    expect(periodFactProblem(straddles, { retention: '30d' }, NOW)).toBeUndefined();
    expect(periodFactProblem(straddles, { maxRange: '24h' }, NOW)).toBe('over-max-range');
  });

  it("reads the tool's step, one minute when none is declared", () => {
    expect(granularityMsOf({ granularity: '5s' })).toBe(5000);
    expect(granularityMsOf(undefined)).toBe(60_000);
  });
});
