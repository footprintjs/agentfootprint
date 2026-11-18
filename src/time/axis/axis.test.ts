import { describe, expect, it } from 'vitest';

import { describeTimeAxis, normaliseInstants, readTimeAxis } from '../axis.js';

describe('the axis facade composes its private helpers', () => {
  it('keeps negative fractional epochs exact, ties stable and frozen rows untouched', () => {
    const rows = Object.freeze([
      Object.freeze({ at: 1.234567 }),
      Object.freeze({ at: -1.234567 }),
      Object.freeze({ at: -1.234567 }),
    ]);

    expect(normaliseInstants(rows, { column: 'at', unit: 'epoch-ms' })).toEqual({
      status: 'instants',
      precision: 'nanosecond',
      points: [
        { row: 1, at: '1969-12-31T23:59:59.998765433Z' },
        { row: 2, at: '1969-12-31T23:59:59.998765433Z' },
        { row: 0, at: '1970-01-01T00:00:00.001234567Z' },
      ],
      notes: [],
      counts: { naive: 0, dstAmbiguous: 0, dstGap: 0, unreadable: 0, missing: 0 },
    });
    expect(rows.map((row) => row.at)).toEqual([1.234567, -1.234567, -1.234567]);
  });

  it('keeps nanoseconds and occurrence notes across the wall-clock overlap', () => {
    const value = '2026-11-01T01:30:00.000000001';
    expect(
      normaliseInstants([{ at: value }, { at: value }], {
        column: 'at',
        unit: 'iso',
        zone: 'America/Los_Angeles',
      }),
    ).toEqual({
      status: 'instants',
      precision: 'nanosecond',
      points: [
        { row: 0, at: '2026-11-01T08:30:00.000000001Z' },
        { row: 1, at: '2026-11-01T09:30:00.000000001Z' },
      ],
      notes: [
        { kind: 'dst-overlap', resolvedBy: 'row-order', row: 0, which: 'earlier' },
        { kind: 'dst-overlap', resolvedBy: 'row-order', row: 1, which: 'later' },
      ],
      counts: { naive: 0, dstAmbiguous: 0, dstGap: 0, unreadable: 0, missing: 0 },
    });
  });

  it('shares declaration identity and the existing aggregate wording', () => {
    const axis = Object.freeze({
      column: 'at',
      unit: 'epoch-ms' as const,
      interval: '5m',
      aggregate: Object.freeze({
        mean: 'avg' as const,
        peak: 'max' as const,
        other: 'avg' as const,
      }),
    });
    const reading = readTimeAxis({ timeAxis: axis });
    expect(reading.status).toBe('declared');
    if (reading.status === 'declared') expect(reading.axis).toBe(axis);
    expect(describeTimeAxis(axis)).toBe('5-minute avg and max');
  });
});
