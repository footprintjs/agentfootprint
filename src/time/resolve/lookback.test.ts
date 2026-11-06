import { describe, expect, it } from 'vitest';
import { chooseReading, resolveMention, withZoneAnswered } from '../resolve.js';
import type { TimeParts } from '../reader.js';
import { DEFAULT_TIME_POLICY } from '../resolveRecord.js';

const CLOCK = { now: '2026-11-06T18:01:00Z', zone: 'America/Los_Angeles' };
const READER = { id: 'zone-test', kind: 'rule' as const };
const RANGE = { from: '2026-11-06T17:01:00Z', to: '2026-11-06T18:01:00.001Z' };
const resolve = (parts: TimeParts, clock = CLOCK) => resolveMention([parts], clock, READER);
const relative = { unit: 'hour', count: 1 } as const;

describe('explicit zones on elapsed and calendar time', () => {
  it('uses an explicit IANA zone without moving the elapsed endpoints', () => {
    const result = resolve({ relative, zoneToken: 'America/New_York' });
    expect(result.needsZone).toBe(false);
    expect(result.unsupported).toEqual([]);
    expect(result.candidates).toHaveLength(1);
    expect(result.candidates[0]).toMatchObject({
      range: RANGE,
      zone: 'America/New_York',
      anchor: 'message',
      said: ['zone', 'duration'],
      window: { kind: 'lookback', duration: '1h' },
    });
    expect(result.candidates[0]!.range).toEqual(resolve({ relative }).candidates[0]!.range);
  });

  it('an explicit zone works when the fallback zone is unknown', () => {
    const result = resolveMention(
      [{ relative, zoneToken: 'America/New_York' }],
      { ...CLOCK, zone: 'UTC', zoneSource: 'unknown' },
      READER,
    );
    expect(result.needsZone).toBe(false);
    expect(result.candidates[0]).toMatchObject({ range: RANGE, zone: 'America/New_York' });
  });

  for (const token of ['EST', 'America/Not_A_Zone', 'India time']) {
    it(`asks for an unresolved explicit zone instead of dropping it: ${token}`, () => {
      expect(resolve({ relative, zoneToken: token })).toMatchObject({
        candidates: [],
        needsZone: true,
      });
    });
  }

  it('a place is resolved by the existing zone reader with its token provenance', () => {
    expect(resolve({ relative, zoneToken: 'London time' }).candidates[0]).toMatchObject({
      range: RANGE,
      zone: 'Europe/London',
      notes: [{ kind: 'zone-read', token: 'London time', as: 'place' }],
    });
  });

  it('a whole-hour fixed offset has its own zone and never borrows the clock zone', () => {
    expect(resolve({ relative, zoneToken: '-05:00' }).candidates[0]).toMatchObject({
      range: RANGE,
      zone: 'Etc/GMT+5',
      notes: [{ kind: 'offset-said', offset: '-05:00' }],
    });
  });

  it('a fractional fixed offset asks for a representable zone and can then settle it', () => {
    const parts = { relative, zoneToken: '+05:30' };
    const pending = resolve(parts);
    expect(pending).toMatchObject({ candidates: [], needsZone: true });
    expect(pending.unsupported.join(' ')).toMatch(/IANA/);
    expect(parts.zoneToken).toBe('+05:30');
    const answered = withZoneAnswered([parts], 'Asia/Kolkata');
    expect(answered[0]!.zoneToken).toBe('Asia/Kolkata');
    expect(resolve(answered[0]!).candidates[0]).toMatchObject({
      range: RANGE,
      zone: 'Asia/Kolkata',
    });
  });

  it('keeps mapped regional and literal meanings even when elapsed endpoints coincide', () => {
    const result = resolveMention(
      [{ relative, zoneToken: 'EST' }],
      { ...CLOCK, now: '2026-07-06T18:01:00Z' },
      READER,
      false,
      {
        ...DEFAULT_TIME_POLICY,
        abbreviations: { EST: { zone: 'America/New_York', offset: '-05:00' } },
      },
    );
    expect(result.candidates).toHaveLength(2);
    expect(result.candidates.map((c) => [c.zone, c.reading.abbreviation])).toEqual([
      ['America/New_York', 'zone'],
      ['Etc/GMT+5', 'literal'],
    ]);
    expect(result.candidates[0]!.range).toEqual(result.candidates[1]!.range);
  });

  it('a fractional mapped literal is asked rather than silently discarding one meaning', () => {
    const policy = {
      ...DEFAULT_TIME_POLICY,
      abbreviations: { NST: { zone: 'America/St_Johns', offset: '-03:30' } },
    };
    const parts = { relative, zoneToken: 'NST' };
    const result = resolveMention([parts], CLOCK, READER, false, policy);
    expect(result).toMatchObject({ candidates: [], needsZone: true });
    const answered = withZoneAnswered([parts], 'America/St_Johns', policy);
    expect(answered[0]!.zoneToken).toBe('America/St_Johns');
  });

  it('does not admit other parts merely because a relative span now accepts a zone', () => {
    const result = resolve({ relative, zoneToken: 'UTC', wall: { h: 8 } });
    expect(result.candidates).toEqual([]);
    expect(result.unsupported).toContain('a look-back with other parts');
  });

  it('leaves plain lookback endpoints and metadata unchanged', () => {
    expect(resolve({ relative }).candidates[0]).toMatchObject({
      range: RANGE,
      zone: CLOCK.zone,
      anchor: 'message',
      said: ['duration'],
      implied: [],
      notes: [],
      reading: {},
    });
  });

  it('a New York calendar day across the spring gap is 23 hours, not an elapsed day', () => {
    const clock = { ...CLOCK, now: '2026-03-08T12:00:00Z' };
    const day = resolve(
      { relative: { unit: 'day', offset: 0 }, zoneToken: 'America/New_York' },
      clock,
    );
    expect(day.candidates[0]!.range).toEqual({
      from: '2026-03-08T00:00:00-05:00',
      to: '2026-03-09T00:00:00-04:00',
    });
    const elapsed = resolve(
      { relative: { unit: 'day', count: 1 }, zoneToken: 'America/New_York' },
      clock,
    );
    expect(elapsed.candidates).toHaveLength(1);
    expect(elapsed.candidates[0]!.range).toEqual({
      from: '2026-03-07T12:00:00Z',
      to: '2026-03-08T12:00:00.001Z',
    });
  });
});

describe('fixed and regional zones at the autumn clock change', () => {
  const policy = {
    ...DEFAULT_TIME_POLICY,
    abbreviations: { EST: { zone: 'America/New_York', offset: '-05:00' } },
  };
  const dayBefore = { relative: { unit: 'day', offset: -1 }, zoneToken: 'EST' } as const;
  const read = (parts: TimeParts, anchor: string) =>
    resolveMention([parts], { ...CLOCK, now: anchor }, READER, false, policy);
  const bounds = (range: { from: string; to: string }) => [
    new Date(range.from).toISOString(),
    new Date(range.to).toISOString(),
  ];

  it('compares both boundaries of the previous civil day, including the repeated hour', () => {
    const result = read(dayBefore, '2026-11-02T17:00:00Z');
    expect(result.candidates).toHaveLength(2);
    expect(result.candidates.map((candidate) => bounds(candidate.range))).toEqual([
      ['2026-11-01T04:00:00.000Z', '2026-11-02T05:00:00.000Z'],
      ['2026-11-01T05:00:00.000Z', '2026-11-02T05:00:00.000Z'],
    ]);
    expect(
      result.candidates.map(
        (candidate) =>
          (Date.parse(candidate.range.to) - Date.parse(candidate.range.from)) / 3_600_000,
      ),
    ).toEqual([25, 24]);
    expect(chooseReading(result, policy, 'rule')).toMatchObject({
      by: 'open',
      remaining: [0, 1],
      open: ['abbreviation'],
    });
  });

  it('keeps the ordinary following-day control as equal complete intervals', () => {
    const result = read(dayBefore, '2026-11-03T17:00:00Z');
    expect(result.candidates).toHaveLength(2);
    expect(result.candidates.map((candidate) => bounds(candidate.range))).toEqual([
      ['2026-11-02T05:00:00.000Z', '2026-11-03T05:00:00.000Z'],
      ['2026-11-02T05:00:00.000Z', '2026-11-03T05:00:00.000Z'],
    ]);
  });

  it('keeps elapsed endpoints independent of the two display readings', () => {
    const result = read({ relative, zoneToken: 'EST' }, '2026-11-02T17:00:00Z');
    expect(result.candidates).toHaveLength(2);
    expect(result.candidates.map((candidate) => bounds(candidate.range))).toEqual([
      ['2026-11-02T16:00:00.000Z', '2026-11-02T17:00:00.001Z'],
      ['2026-11-02T16:00:00.000Z', '2026-11-02T17:00:00.001Z'],
    ]);
  });
});
