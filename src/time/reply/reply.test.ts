import { describe, expect, it } from 'vitest';
import { timeReplyOf, type TimeReplyInput } from '../reply.js';
import { chooseReading, resolveMention, type ResolveClock, type TimePolicy } from '../resolve.js';
import { spellRange } from '../range.js';
import type { TimeParts } from '../reader.js';
import type { TimeReadingRow } from '../rows.js';

const CLOCK: ResolveClock = { now: '2026-11-03T17:00:00Z', zone: 'UTC' };
const POLICY: TimePolicy = {
  year: 'current',
  dateOrder: 'ask',
  abbreviations: { EST: { zone: 'America/New_York', offset: '-05:00' } },
};

function rowOf(parses: readonly TimeParts[], quote = 'yesterday', clock = CLOCK): TimeReadingRow {
  const reader = { id: 'fixture', version: '1', kind: 'rule' as const, locale: 'en-US' };
  const resolution = resolveMention(parses, clock, reader, true, POLICY);
  return {
    kind: 'time-reading',
    turn: 1,
    iteration: 0,
    reader,
    tzdata: 'test',
    mentions: 1,
    mention: 0,
    quote,
    parses,
    candidates: resolution.candidates,
    choice: chooseReading(resolution, POLICY, 'rule', undefined, true),
  };
}

function input(changes: Partial<TimeReplyInput> = {}): TimeReplyInput {
  return {
    row: rowOf([{ relative: { unit: 'day', offset: -1 } }]),
    clock: CLOCK,
    policy: POLICY,
    ...changes,
  };
}

describe('the pure time reply facade', () => {
  it('returns a typed decision synchronously', () => {
    expect(timeReplyOf(input({ correction: 'yesterday' })).kind).toBe('reask');
  });
  it('keeps the existing ISO enum answer confirmed with its offered zone', () => {
    const current = input();
    const candidate = current.row.candidates![0];
    const range = spellRange(candidate.range);
    expect(timeReplyOf({ ...current, range })).toEqual({
      kind: 'range',
      range: candidate.range,
      zone: candidate.zone,
      how: 'confirmed',
      rule: 'range-confirmed',
    });
  });

  it('uses the actual pending offered pairs rather than reordering equal ranges from the bank', () => {
    const current = input();
    const range = current.row.candidates![0].range;
    expect(
      timeReplyOf({
        ...current,
        range: spellRange(range),
        offered: [{ range, zone: 'Asia/Kolkata' }],
      }),
    ).toMatchObject({ kind: 'range', how: 'confirmed', zone: 'Asia/Kolkata' });
  });

  it('accepts full-interval correction as an edit without claiming an inferred zone', () => {
    const correction = '2026-11-01T12:00:00Z/2026-11-01T13:00:00Z';
    expect(timeReplyOf(input({ correction }))).toEqual({
      kind: 'range',
      range: { from: '2026-11-01T12:00:00Z', to: '2026-11-01T13:00:00Z' },
      how: 'edited',
      rule: 'interval-corrected',
    });
    expect(timeReplyOf(input({ range: 'EST time zone' }))).toMatchObject({
      kind: 'hold',
      rule: 'invalid-range',
    });
  });

  it('replaces an already known old zone and reconfirms the calendar window at the saved anchor', () => {
    const row = rowOf([{ relative: { unit: 'day', offset: -1 }, zoneToken: 'Asia/Kolkata' }]);
    const before = structuredClone(row);
    const result = timeReplyOf(input({ row, correction: 'Please present it in EST time zone' }));
    expect(result.kind).toBe('reask');
    if (result.kind !== 'reask') throw new Error('expected the time proposal');
    expect(result.rule).toBe('zone-corrected');
    expect(result.row.choice).toMatchObject({ by: 'open', open: ['confirm'] });
    expect(result.row.parses?.[0].zoneToken).toBe('EST');
    expect(result.row.candidates?.length).toBeGreaterThan(0);
    expect(
      result.row.candidates?.every(
        (candidate) =>
          candidate.range.from === '2026-11-02T00:00:00-05:00' &&
          candidate.range.to === '2026-11-03T00:00:00-05:00',
      ),
    ).toBe(true);
    expect(row).toEqual(before);
  });

  it('keeps corrected time words as a proposal with their real quote, not the old quote', () => {
    const result = timeReplyOf(input({ correction: 'last 2 hours' }));
    expect(result.kind).toBe('reask');
    if (result.kind !== 'reask') throw new Error('expected the time proposal');
    expect(result.rule).toBe('time-words-corrected');
    expect(result.row.quote).toBe('last 2 hours');
    expect(result.row.choice).toMatchObject({ by: 'open', open: ['confirm'] });
    expect(result.row.candidates?.[0].range).toEqual({
      from: '2026-11-03T15:00:00Z',
      to: '2026-11-03T17:00:00.001Z',
    });
    expect(result).not.toHaveProperty('rawCorrection');
  });

  it('does not silently settle a calendar correction whose abbreviation has no caller map', () => {
    const result = timeReplyOf(
      input({
        policy: { year: 'current', dateOrder: 'ask' },
        correction: 'EST time zone',
      }),
    );
    expect(result.kind).toBe('reask');
    if (result.kind !== 'reask') throw new Error('expected a zone question');
    expect(result.row.choice).toMatchObject({ by: 'open', open: ['zone'] });
    expect(result.row.candidates).toEqual([]);
  });

  it('keeps opposite session clocks separate and never changes either supplied anchor', () => {
    const west = { now: CLOCK.now, zone: 'America/Los_Angeles' };
    const east = { now: CLOCK.now, zone: 'Asia/Kolkata' };
    const a = input({ clock: west, correction: 'yesterday' });
    const b = input({ clock: east, correction: 'yesterday' });
    const before = structuredClone([a, b]);
    const one = timeReplyOf(a),
      two = timeReplyOf(b);
    expect(one.kind).toBe('reask');
    expect(two.kind).toBe('reask');
    if (one.kind !== 'reask' || two.kind !== 'reask') throw new Error('expected proposals');
    expect(one.row.candidates?.[0].zone).toBe(west.zone);
    expect(two.row.candidates?.[0].zone).toBe(east.zone);
    expect(one.row.candidates?.[0].range).not.toEqual(two.row.candidates?.[0].range);
    expect([a, b]).toEqual(before);
  });

  it('holds no/both/neither without projecting reply text into reasons', () => {
    for (const values of [{}, { range: 'a', correction: 'b' }, { correction: 'no' }]) {
      const result = timeReplyOf(input(values));
      expect(result.kind).toBe('hold');
      expect(Object.keys(result).sort()).toEqual(['kind', 'reason', 'rule']);
    }
  });
});
