import { describe, expect, it } from 'vitest';

import { convertForTool, readBack, type PeriodForm } from '../convert.js';

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
