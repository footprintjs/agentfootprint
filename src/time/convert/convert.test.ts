import { describe, expect, it } from 'vitest';

import { convertExact, convertForTool, readBack, type PeriodForm } from '../convert.js';

describe('public period conversion composition', () => {
  it('rounds negative epoch seconds outward without changing frozen declarations or input', () => {
    const range = Object.freeze({
      from: '1969-12-31T23:59:58.250Z',
      to: '1969-12-31T23:59:59.750Z',
    });
    const window = Object.freeze({ range });
    const form: PeriodForm = Object.freeze({
      kind: 'joined',
      argument: 'window',
      as: 'epoch-s',
      joiner: '..',
      edge: 'inclusive',
    });
    const forms = Object.freeze([form]);
    const ctx = Object.freeze({ now: '1970-01-01T00:00:00Z', zone: 'UTC', granularityMs: 1 });
    const done = convertForTool(window, forms, undefined, ctx);
    expect(done).toEqual({ conversion: { form: 0, values: { window: '-2..-1' }, rounded: true } });
    if ('refused' in done) throw new Error(done.refused);
    expect(readBack(done.conversion.values, form, ctx)).toEqual({
      from: '1969-12-31T23:59:58Z',
      to: '1970-01-01T00:00:00Z',
    });
    expect(window.range).toBe(range);
    expect(forms[0]).toBe(form);
    expect(range.to).toBe('1969-12-31T23:59:59.750Z');
  });

  it('widens to the 23-hour spring day and reads back the same declared-zone range', () => {
    const form: PeriodForm = { kind: 'day', argument: 'day', zone: { argument: 'tz' } };
    const ctx = { now: '2026-03-09T00:00:00Z', zone: 'America/Los_Angeles', granularityMs: 60_000 };
    const done = convertForTool(
      {
        range: {
          from: '2026-03-08T10:15:00Z',
          to: '2026-03-08T11:15:00Z',
        },
      },
      [form],
      { maxRange: '23h' },
      ctx,
    );
    const sent = { from: '2026-03-08T08:00:00Z', to: '2026-03-09T07:00:00Z' };
    expect(done).toEqual({
      conversion: {
        form: 0,
        values: { day: '2026-03-08', tz: 'America/Los_Angeles' },
        sent,
        extra: [
          { from: sent.from, to: '2026-03-08T10:15:00Z' },
          { from: '2026-03-08T11:15:00Z', to: sent.to },
        ],
      },
    });
    if ('refused' in done) throw new Error(done.refused);
    expect(readBack(done.conversion.values, form, ctx)).toEqual(sent);
  });

  it('keeps the original form index when caps reject a look-back and retention is partial', () => {
    const forms: readonly PeriodForm[] = [
      { kind: 'lookback', argument: 'window', signed: false, maxRange: '30m' },
      {
        kind: 'bounds',
        from: { argument: 'start', as: 'epoch-ms' },
        to: { argument: 'end', as: 'epoch-ms', edge: 'exclusive' },
        maxRange: '2h',
      },
    ];
    const range = { from: '2026-10-09T15:00:00Z', to: '2026-10-09T16:00:00Z' };
    const ctx = { now: '2026-10-09T17:00:00Z', zone: 'UTC', granularityMs: 60_000 };
    const done = convertForTool({ range }, forms, { retention: '90m' }, ctx);
    expect(done).toEqual({
      conversion: {
        form: 1,
        values: { start: Date.parse(range.from), end: Date.parse(range.to) },
      },
      partlyBeyondRetention: true,
    });
    if ('refused' in done) throw new Error(done.refused);
    expect(readBack(done.conversion.values, forms[1]!, ctx)).toEqual(range);
  });
});

describe('frozen look-back conversion', () => {
  const relative = { kind: 'lookback', argument: 'duration', signed: false } as const;
  const absolute = {
    kind: 'bounds',
    from: { argument: 'start', as: 'iso' },
    to: { argument: 'end', as: 'iso', edge: 'exclusive' },
  } as const;
  const wall = { ...absolute, to: { ...absolute.to, as: 'wall' } } as const;
  const coarse = {
    kind: 'object',
    argument: 'range',
    keys: { from: 'start', to: 'end' },
    as: 'epoch-s',
    edge: 'exclusive',
  } as const;
  const range = { from: '2026-11-13T10:00:00-08:00', to: '2026-11-13T12:00:00-08:00' };
  const window = { range, lookback: '2h', freezeLookback: true } as const;
  const ctx = {
    now: '2026-11-13T21:00:00Z',
    zone: 'America/Los_Angeles',
    granularityMs: 1,
  } as const;
  const values = { start: '2026-11-13T18:00:00Z', end: '2026-11-13T20:00:00Z' };

  it('sends the stored UTC bounds in either declared order and retains the original index', () => {
    expect(convertForTool(window, [relative, absolute], undefined, ctx)).toEqual({
      conversion: { form: 1, values },
    });
    expect(convertForTool(window, [absolute, relative], undefined, ctx)).toEqual({
      conversion: { form: 0, values },
    });
    expect(convertExact(window, [relative, absolute], ctx)).toEqual({ form: 1, values });
  });

  it('reads a length-only form as a look-back to lengthen at dispatch, and refuses calendar and wall forms alone', () => {
    // The clock is an hour past the window's end: the look-back that reaches its start is 3h.
    const covering = { form: 0, values: { duration: '3h' }, coversAtDispatch: true };
    expect(convertForTool(window, [relative], undefined, ctx)).toEqual({ conversion: covering });
    expect(
      convertForTool(window, [relative, wall, { kind: 'day', argument: 'date' }], undefined, ctx),
    ).toEqual({ conversion: covering });
    expect(
      convertForTool(window, [wall, { kind: 'day', argument: 'date' }], undefined, ctx),
    ).toEqual({ refused: 'no-form-holds' });
    expect(convertForTool({ range, lookback: '2h' }, [relative, absolute], undefined, ctx)).toEqual(
      {
        conversion: { form: 0, values: { duration: '2h' } },
      },
    );
  });

  it('skips a capped absolute form, prefers another absolute form, and only then the look-back', () => {
    const short = { ...absolute, maxRange: '1h' } as const;
    expect(convertForTool(window, [relative, short, absolute], undefined, ctx)).toEqual({
      conversion: { form: 2, values },
    });
    expect(convertForTool(window, [relative, short], undefined, ctx)).toEqual({
      conversion: { form: 0, values: { duration: '3h' }, coversAtDispatch: true },
    });
    // The look-back's own cap still holds: a length past it is not read.
    expect(
      convertForTool(window, [{ ...relative, maxRange: '2h' }, short], undefined, ctx),
    ).toEqual({ refused: 'no-form-holds' });
  });

  it('prefers an exact form and records actual widening if only an epoch-second form can hold it', () => {
    const ragged = {
      ...window,
      range: { from: '2026-11-13T10:00:00.250-08:00', to: '2026-11-13T12:00:00.750-08:00' },
    };
    expect(convertForTool(ragged, [coarse, absolute], undefined, ctx)).toEqual({
      conversion: {
        form: 1,
        values: { start: '2026-11-13T18:00:00.25Z', end: '2026-11-13T20:00:00.75Z' },
      },
    });
    expect(convertForTool(ragged, [relative, coarse], undefined, ctx)).toEqual({
      conversion: {
        form: 1,
        values: {
          range: { start: Date.parse(values.start) / 1000, end: Date.parse(values.end) / 1000 + 1 },
        },
        rounded: true,
        sent: { from: values.start, to: '2026-11-13T20:00:01Z' },
        extra: [
          { from: values.start, to: '2026-11-13T18:00:00.25Z' },
          { from: '2026-11-13T20:00:00.75Z', to: '2026-11-13T20:00:01Z' },
        ],
      },
    });
    expect(convertForTool(ragged, [relative, coarse], { maxRange: '2h' }, ctx)).toEqual({
      refused: 'over-max-range',
    });
  });

  it('skips absolute bounds whose rounded read is past the cap, and holds the look-back to the same cap', () => {
    const ragged = {
      ...window,
      range: { from: '2026-11-13T18:00:00.75Z', to: '2026-11-13T20:00:00.25Z' },
    };
    // The epoch-second bounds round outward past two hours; the look-back's own length fits.
    const atCutoff = { ...ctx, now: '2026-11-13T20:00:00.25Z' };
    expect(convertForTool(ragged, [relative, coarse], { maxRange: '2h' }, atCutoff)).toEqual({
      conversion: { form: 0, values: { duration: '2h' }, rounded: true, coversAtDispatch: true },
    });
    // An hour later the covering look-back is 3h, past the same cap: nothing reads it.
    expect(convertForTool(ragged, [relative, coarse], { maxRange: '2h' }, ctx)).toEqual({
      refused: 'no-form-holds',
    });
    expect(convertForTool(ragged, [coarse], { maxRange: '2h' }, atCutoff)).toEqual({
      refused: 'no-form-holds',
    });
  });
});
