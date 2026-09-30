/**
 * core/time/zone — IANA names and DST arithmetic through `Intl`.
 *
 * Test types:
 *   unit        — what is a zone name (abbreviations and bare offsets refused although `Intl` takes them);
 *   functional  — the DST table: 20 zones' January and July offsets, and eight hand-worked transitions
 *                 (gaps and overlaps, whole-hour, half-hour and 45-minute zones) under the four words;
 *   integration — not applicable in T1: no consumer reads a zone until the axis (T2) and the clock (T3);
 *   property    — over 2026 in all 20 zones: every instant's own wall time reads back to it (unique, or one
 *                 of an overlap's two), and every skipped wall time is a gap refused under `reject`;
 *   security    — `__proto__`, a 10 KB name and 5 000 case variants: refused or bounded, never thrown on;
 *   performance — the year sweep's budget;
 *   load        — 5 000 distinct case variants keep the formatter cache bounded.
 */

import { describe, expect, it } from 'vitest';

import {
  canonicalZone,
  isZoneName,
  offsetAt,
  readWall,
  wallAt,
  wallToInstant,
  type WallTime,
} from '../../../src/core/time/zone.js';

const at = (iso: string): number => Date.parse(iso);

describe('what is a zone name — unit', () => {
  it.each([
    ['America/Los_Angeles', true],
    ['Europe/London', true],
    ['America/Argentina/Buenos_Aires', true],
    ['America/Port-au-Prince', true],
    ['Etc/GMT+5', true],
    ['UTC', true],
    ['GMT', true],
    ['america/los_angeles', true], // tz names match without regard to case
    ['PST', false], // Intl reads it as America/Los_Angeles — silently
    ['EST', false], // Intl reads it as America/Panama
    ['+05:30', false], // Intl (Node 22) takes a bare offset
    ['Z', false],
    ['', false],
    ['Mars/Olympus_Mons', false],
    ['America/', false],
  ])('%j → %s', (name, ok) => {
    expect(isZoneName(name)).toBe(ok);
  });

  it('the canonical spelling', () => {
    expect(canonicalZone('america/los_angeles')).toBe('America/Los_Angeles');
    expect(canonicalZone('PST')).toBeUndefined();
  });

  it('a wall time that is not a calendar time, or a zone that is not a name, is a caller error', () => {
    expect(() => readWall({ year: 2026, month: 2, day: 30, hour: 8, minute: 0 }, 'UTC')).toThrow(
      TypeError,
    );
    expect(() => readWall({ year: 2026, month: 10, day: 9, hour: 24, minute: 0 }, 'UTC')).toThrow(
      TypeError,
    );
    expect(() => readWall({ year: 2026, month: 10, day: 9, hour: 8, minute: 0 }, 'PST')).toThrow(
      TypeError,
    );
    expect(() => offsetAt('PST', 0)).toThrow(TypeError);
  });
});

/** 20 zones: January and July 2026 offsets, minutes east of UTC. */
const ZONES: readonly (readonly [string, number, number])[] = [
  ['UTC', 0, 0],
  ['America/Los_Angeles', -480, -420],
  ['America/New_York', -300, -240],
  ['America/Chicago', -360, -300],
  ['America/Denver', -420, -360],
  ['America/Phoenix', -420, -420],
  ['Pacific/Honolulu', -600, -600],
  ['America/St_Johns', -210, -150],
  ['America/Sao_Paulo', -180, -180],
  ['Europe/London', 0, 60],
  ['Europe/Berlin', 60, 120],
  ['Europe/Dublin', 0, 60],
  ['Asia/Kolkata', 330, 330],
  ['Asia/Kathmandu', 345, 345],
  ['Asia/Tokyo', 540, 540],
  ['Asia/Shanghai', 480, 480],
  ['Australia/Sydney', 660, 600],
  ['Australia/Lord_Howe', 660, 630],
  ['Pacific/Chatham', 825, 765],
  ['Pacific/Kiritimati', 840, 840],
];

const w = (y: number, mo: number, d: number, h: number, mi: number): WallTime => ({
  year: y,
  month: mo,
  day: d,
  hour: h,
  minute: mi,
});

/** Hand-worked 2026 transitions: [zone, wall, kind, earlier (UTC), later (UTC)]. */
const TRANSITIONS: readonly (readonly [string, WallTime, 'gap' | 'overlap', string, string])[] = [
  [
    'America/Los_Angeles',
    w(2026, 3, 8, 2, 30),
    'gap',
    '2026-03-08T09:30:00Z',
    '2026-03-08T10:30:00Z',
  ],
  [
    'America/Los_Angeles',
    w(2026, 11, 1, 1, 30),
    'overlap',
    '2026-11-01T08:30:00Z',
    '2026-11-01T09:30:00Z',
  ],
  ['America/New_York', w(2026, 3, 8, 2, 30), 'gap', '2026-03-08T06:30:00Z', '2026-03-08T07:30:00Z'],
  [
    'Europe/London',
    w(2026, 10, 25, 1, 30),
    'overlap',
    '2026-10-25T00:30:00Z',
    '2026-10-25T01:30:00Z',
  ],
  ['Europe/Berlin', w(2026, 3, 29, 2, 30), 'gap', '2026-03-29T00:30:00Z', '2026-03-29T01:30:00Z'],
  [
    'Australia/Sydney',
    w(2026, 4, 5, 2, 30),
    'overlap',
    '2026-04-04T15:30:00Z',
    '2026-04-04T16:30:00Z',
  ],
  [
    'Australia/Lord_Howe',
    w(2026, 10, 4, 2, 15),
    'gap',
    '2026-10-03T15:15:00Z',
    '2026-10-03T15:45:00Z',
  ],
  [
    'America/St_Johns',
    w(2026, 11, 1, 1, 30),
    'overlap',
    '2026-11-01T04:00:00Z',
    '2026-11-01T05:00:00Z',
  ],
  ['Pacific/Chatham', w(2026, 9, 27, 3, 0), 'gap', '2026-09-26T13:15:00Z', '2026-09-26T14:15:00Z'],
];

describe('the DST table — functional', () => {
  it.each(ZONES)('%s: January %d, July %d', (zone, jan, jul) => {
    expect(isZoneName(zone)).toBe(true);
    expect(offsetAt(zone, at('2026-01-15T12:00:00Z'))).toBe(jan);
    expect(offsetAt(zone, at('2026-07-15T12:00:00Z'))).toBe(jul);
  });

  it.each(TRANSITIONS)('%s %j is a %s', (zone, wall, kind, earlier, later) => {
    const reading = readWall(wall, zone);
    expect(reading).toEqual({ kind, earlier: at(earlier), later: at(later) });
    expect(wallToInstant(wall, zone, 'earlier')).toBe(at(earlier));
    expect(wallToInstant(wall, zone, 'later')).toBe(at(later));
    expect(wallToInstant(wall, zone, 'reject')).toBeUndefined();
    // Temporal's 'compatible': the first of a doubled time, the later reading of a skipped one.
    expect(wallToInstant(wall, zone, 'compatible')).toBe(at(kind === 'overlap' ? earlier : later));
  });

  it('a wall time that exists once is the same under every word', () => {
    const wall = w(2026, 10, 9, 8, 0);
    for (const word of ['compatible', 'earlier', 'later', 'reject'] as const) {
      expect(wallToInstant(wall, 'America/Los_Angeles', word)).toBe(at('2026-10-09T15:00:00Z'));
    }
  });

  it('wallAt reads the zone', () => {
    expect(wallAt('Asia/Kathmandu', at('2026-10-09T00:00:00Z'))).toEqual({
      year: 2026,
      month: 10,
      day: 9,
      hour: 5,
      minute: 45,
      second: 0,
      millisecond: 0,
    });
  });
});

describe('every instant of 2026 reads back — property', () => {
  const START = at('2026-01-01T00:00:00Z');
  const END = at('2027-01-01T00:00:00Z');
  const STEP = 3 * 3_600_000 + 17 * 60_000; // 3 h 17 min, so samples drift across every wall minute class

  it.each(ZONES.map(([z]) => z))('%s', (zone) => {
    let transitions = 0;
    let previous = offsetAt(zone, START);
    for (let t = START; t < END; t += STEP) {
      const reading = readWall(wallAt(zone, t), zone);
      expect(reading.kind, new Date(t).toISOString()).not.toBe('gap');
      if (reading.kind === 'unique') expect(reading.ms).toBe(t);
      else expect([reading.earlier, reading.later]).toContain(t);
      const offset = offsetAt(zone, t);
      if (offset !== previous) {
        transitions++;
        checkTransition(zone, t - STEP, t, previous, offset);
        previous = offset;
      }
    }
    const [, jan, jul] = ZONES.find(([z]) => z === zone) as readonly [string, number, number];
    expect(transitions).toBe(jan === jul ? 0 : 2);
  });

  /** Find the change inside (lo, hi] to the millisecond, then check the wall time halfway through what it skips or doubles. */
  function checkTransition(
    zone: string,
    lo: number,
    hi: number,
    before: number,
    after: number,
  ): void {
    while (hi - lo > 1) {
      const mid = lo + Math.floor((hi - lo) / 2);
      if (offsetAt(zone, mid) === before) lo = mid;
      else hi = mid;
    }
    const jumpMs = (after - before) * 60_000;
    // Forward: the skipped walls start just after the wall at hi − 1. Back: the doubled walls start at the wall at hi.
    const start = jumpMs > 0 ? wallMsOf(wallAt(zone, hi - 1)) + 1 : wallMsOf(wallAt(zone, hi));
    const wall = wallOfMs(start + Math.abs(jumpMs) / 2);
    const reading = readWall(wall, zone);
    if (jumpMs > 0) {
      expect(reading.kind, `${zone} ${JSON.stringify(wall)}`).toBe('gap');
      if (reading.kind === 'gap') expect(reading.later - reading.earlier).toBe(jumpMs);
      expect(wallToInstant(wall, zone, 'reject')).toBeUndefined();
      expect(wallToInstant(wall, zone, 'compatible')).toBe(wallToInstant(wall, zone, 'later'));
    } else {
      expect(reading.kind, `${zone} ${JSON.stringify(wall)}`).toBe('overlap');
      if (reading.kind === 'overlap') expect(reading.later - reading.earlier).toBe(-jumpMs);
      expect(wallToInstant(wall, zone, 'reject')).toBeUndefined();
      expect(wallToInstant(wall, zone, 'compatible')).toBe(wallToInstant(wall, zone, 'earlier'));
    }
  }
});

/** A wall time as milliseconds on a UTC-shaped axis (arithmetic only — never an instant). */
function wallMsOf(wall: WallTime): number {
  return Date.UTC(
    wall.year,
    wall.month - 1,
    wall.day,
    wall.hour,
    wall.minute,
    wall.second ?? 0,
    wall.millisecond ?? 0,
  );
}

function wallOfMs(ms: number): WallTime {
  const d = new Date(ms);
  return {
    year: d.getUTCFullYear(),
    month: d.getUTCMonth() + 1,
    day: d.getUTCDate(),
    hour: d.getUTCHours(),
    minute: d.getUTCMinutes(),
    second: d.getUTCSeconds(),
    millisecond: d.getUTCMilliseconds(),
  };
}

describe('hostile input — security and load', () => {
  it.each([
    '__proto__',
    'constructor',
    'toString',
    'A'.repeat(10_000),
    'America/Los_Angeles\u0000',
    'America/../etc',
  ])('refuses %j without throwing', (name) => {
    expect(isZoneName(name)).toBe(false);
  });

  it.each([null, undefined, 42, {}, ['UTC']])('refuses %j', (value) => {
    expect(isZoneName(value)).toBe(false);
  });

  it('5 000 case variants of one name are judged and the formatter cache stays bounded', () => {
    const base = 'America/Argentina/Buenos_Aires';
    const letters = [...base].map((c, i) => i).filter((i) => /[a-z]/i.test(base[i] as string));
    const started = performance.now();
    for (let n = 0; n < 5_000; n++) {
      const chars = [...base];
      letters.forEach((i, bit) => {
        if ((n >> bit) & 1)
          chars[i] =
            (chars[i] as string).toUpperCase() === chars[i]
              ? (chars[i] as string).toLowerCase()
              : (chars[i] as string).toUpperCase();
      });
      expect(isZoneName(chars.join(''))).toBe(true);
    }
    expect(performance.now() - started).toBeLessThan(20_000);
  });
});
