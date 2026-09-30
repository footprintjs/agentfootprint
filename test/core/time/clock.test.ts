/**
 * core/time/clock + core/time/rows — the run clock's readers and the rows it
 * files (the time design § 4, step T3). End to end through real agents:
 * test/core/time/clock-run.test.ts.
 *
 * Test types:
 *   unit        — `readRunTime`, `readTimeOptions`, `draftClock` (run zone wins, builder fallback,
 *                 neither → 'no-zone'), `completeClock` (`nowSource`), `clockChange` (only a
 *                 differing value counts); the row builders and `clockOf`;
 *   functional  — the checkpoint door's arm (`timeRowIsWellFormed`) accepts every row the
 *                 builders file and refuses each field missing or malformed;
 *   property    — 2 000 generated `now` strings: accepted exactly when the strict instant
 *                 profile accepts them, and kept as written;
 *   security    — hostile inputs (class instances, `__proto__` keys, 1 MB strings, an
 *                 abbreviation, a bare offset, an invalid Date) are refused by name, never thrown
 *                 on as a TypeError from inside, and never reach a row;
 *   performance — 10 000 reads inside a budget;
 *   load        — not applicable: pure functions with no shared state (the per-call row's load
 *                 case is in clock-run.test.ts).
 */

import { describe, expect, it } from 'vitest';

import {
  clockChange,
  completeClock,
  draftClock,
  readRunTime,
  readTimeOptions,
} from '../../../src/core/time/clock.js';
import { instantOf } from '../../../src/core/time/instant.js';
import {
  callRow,
  clockOf,
  clockRow,
  isTimeRowKind,
  presentationZoneOf,
  timeRowIsWellFormed,
} from '../../../src/core/time/rows.js';
import { instantish, prng } from './fixtures/generate.js';

const LA = 'America/Los_Angeles';
const NOW = '2026-10-09T15:40:00Z';
const WINDOW = { from: '2026-10-09T08:00:00-07:00', to: '2026-10-09T08:41:00-07:00' };

const valueOf = <T>(read: { value: T } | { problem: string }): T => {
  if ('problem' in read) throw new Error(`unexpected problem: ${read.problem}`);
  return read.value;
};
const problemOf = (read: { value: unknown } | { problem: string }): string => {
  if (!('problem' in read)) throw new Error('expected a problem');
  return read.problem;
};

describe('readRunTime — the run input, checked', () => {
  it('reads nothing as nothing', () => {
    expect(valueOf(readRunTime(undefined))).toBeUndefined();
    expect(valueOf(readRunTime({}))).toEqual({});
  });

  it('keeps a strict instant as written, spells a Date in UTC at fixed width', () => {
    expect(valueOf(readRunTime({ now: '2026-10-09T08:40:00-07:00' }))).toEqual({
      now: '2026-10-09T08:40:00-07:00',
    });
    expect(valueOf(readRunTime({ now: new Date(Date.UTC(2026, 9, 9, 15, 40)) }))).toEqual({
      now: '2026-10-09T15:40:00.000Z',
    });
  });

  it('keeps the zone as written (never an older link), and refuses an abbreviation or a bare offset', () => {
    expect(valueOf(readRunTime({ zone: 'Asia/Kolkata' }))).toEqual({ zone: 'Asia/Kolkata' });
    expect(valueOf(readRunTime({ zone: LA }))).toEqual({ zone: LA });
    for (const zone of ['PST', 'EST', '+05:30', 'utc-7', '', 42]) {
      expect(problemOf(readRunTime({ zone }))).toMatch(/IANA zone name/);
    }
  });

  it('reads a control window as two strict instants, from before to', () => {
    expect(valueOf(readRunTime({ window: WINDOW }))).toEqual({ window: WINDOW });
    for (const window of [
      { from: WINDOW.to, to: WINDOW.from },
      { from: WINDOW.from, to: WINDOW.from },
      { from: '2026-10-09 08:00', to: WINDOW.to },
      { from: WINDOW.from },
      { ...WINDOW, source: 'control' },
      `${WINDOW.from}/${WINDOW.to}`,
    ]) {
      expect(problemOf(readRunTime({ window }))).toMatch(/time\.window/);
    }
  });

  it('refuses a non-object and an unknown key, by name', () => {
    for (const value of [null, 'now', 5, [NOW], new Map()]) {
      expect(problemOf(readRunTime(value))).toMatch(/time must be an object/);
    }
    expect(problemOf(readRunTime({ now: NOW, zon: LA }))).toMatch(/unknown key 'zon'/);
  });

  it('refuses a now with no zone, a lower-case t, a leap second, or an invalid Date', () => {
    for (const now of [
      '2026-10-09T15:40:00',
      '2026-10-09t15:40:00z',
      '2026-10-09T23:59:60Z',
      '2026-02-30T08:00Z',
      1_728_488_400_000,
      new Date(Number.NaN),
      new Date(8.64e15),
    ]) {
      expect(problemOf(readRunTime({ now }))).toMatch(/now/);
    }
  });
});

describe('readTimeOptions — the builder fallback', () => {
  it('reads nothing as armed with no fallback, and a zone as written', () => {
    expect(valueOf(readTimeOptions(undefined))).toEqual({});
    expect(valueOf(readTimeOptions({}))).toEqual({});
    expect(valueOf(readTimeOptions({ zone: 'Europe/Paris' }))).toEqual({ zone: 'Europe/Paris' });
    expect(problemOf(readTimeOptions({ zone: 'utc' }))).toMatch(/IANA zone name/);
  });

  it('refuses the later steps’ keys until they ship, and a malformed zone', () => {
    expect(problemOf(readTimeOptions({ reader: {} }))).toMatch(/unknown key 'reader'/);
    expect(problemOf(readTimeOptions({ zone: 'PDT' }))).toMatch(/IANA zone name/);
    expect(problemOf(readTimeOptions('America/Los_Angeles'))).toMatch(/object/);
  });
});

describe('draftClock / completeClock — the zone per run, the builder a fallback', () => {
  it('the run zone wins; the builder fills in; neither is refused', () => {
    expect(draftClock({ zone: 'Asia/Kolkata' }, { zone: LA })).toEqual({
      zone: 'Asia/Kolkata',
      zoneSource: 'run',
    });
    expect(draftClock({}, { zone: LA })).toEqual({ zone: LA, zoneSource: 'builder' });
    expect(draftClock(undefined, { zone: LA })).toEqual({ zone: LA, zoneSource: 'builder' });
    expect(draftClock({ now: NOW }, {})).toBe('no-zone');
    expect(draftClock(undefined, {})).toBe('no-zone');
  });

  it('now is the app’s, else the turn’s start — admitted as a default', () => {
    const start = Date.UTC(2026, 9, 9, 15, 40, 2, 5);
    expect(completeClock({ now: NOW, zone: LA, zoneSource: 'run' }, start)).toEqual({
      now: NOW,
      nowSource: 'app',
      zone: LA,
      zoneSource: 'run',
    });
    expect(completeClock({ zone: LA, zoneSource: 'builder' }, start)).toEqual({
      now: '2026-10-09T15:40:02.005Z',
      nowSource: 'default',
      zone: LA,
      zoneSource: 'builder',
    });
  });

  it('carries a control window through the draft', () => {
    expect(draftClock({ window: WINDOW }, { zone: LA })).toEqual({
      zone: LA,
      zoneSource: 'builder',
      window: WINDOW,
    });
  });
});

describe('clockChange — a resume’s time is recorded only when it differs', () => {
  const kept = { now: NOW, zone: LA };
  it('nothing passed, or the same values, is no change', () => {
    expect(clockChange({}, kept)).toBeUndefined();
    expect(clockChange({ now: NOW, zone: LA }, kept)).toBeUndefined();
  });
  it('a later now, another zone, or a new window is a change, with the kept values', () => {
    expect(clockChange({ now: '2026-10-09T16:10:00Z' }, kept)).toEqual({
      passed: { now: '2026-10-09T16:10:00Z' },
      kept,
    });
    expect(clockChange({ zone: 'Europe/Paris', now: NOW }, kept)?.passed.zone).toBe('Europe/Paris');
    expect(clockChange({ window: WINDOW }, kept)?.kept).toEqual(kept);
    expect(clockChange({ window: WINDOW }, { ...kept, window: WINDOW })).toBeUndefined();
  });
  it('the same instant in another spelling is recorded — the record keeps spellings', () => {
    expect(clockChange({ now: '2026-10-09T08:40:00-07:00' }, kept)).toBeDefined();
  });
});

describe('rows — built, read back, and judged by the checkpoint door', () => {
  const clock = completeClock({ now: NOW, zone: LA, zoneSource: 'run' }, 0);
  const at = { turn: 2, iteration: 1 };
  const stamp = clockRow(clock, at, WINDOW);
  const call = callRow({ toolCallId: 'c1', toolName: 'search_logs' }, at, Date.UTC(2026, 9, 9, 16));
  const onResume = {
    kind: 'clock-on-resume',
    turn: 2,
    iteration: 1,
    passed: { now: '2026-10-09T16:10:00Z' },
    kept: { now: NOW, zone: LA },
  };

  it('builds the three kinds', () => {
    expect(stamp).toEqual({
      kind: 'clock',
      turn: 2,
      iteration: 1,
      now: NOW,
      nowSource: 'app',
      zone: LA,
      zoneSource: 'run',
      window: { ...WINDOW, source: 'control' },
    });
    expect(clockRow(clock, at)).not.toHaveProperty('window');
    expect(call).toEqual({
      kind: 'call',
      turn: 2,
      iteration: 1,
      toolCallId: 'c1',
      toolName: 'search_logs',
      dispatchedAt: '2026-10-09T16:00:00.000Z',
    });
  });

  it('clockOf reads the LAST clock row; nothing when none was filed', () => {
    const later = { ...stamp, turn: 3, zone: 'UTC' };
    expect(clockOf([stamp, call, later, call])).toBe(later);
    expect(clockOf([call])).toBeUndefined();
    expect(clockOf(undefined)).toBeUndefined();
    expect(clockOf([null, 5, 'clock'])).toBeUndefined();
    expect(presentationZoneOf([stamp])).toBe(LA);
  });

  it('the door accepts every row the builders file', () => {
    for (const row of [stamp, clockRow(clock, at), call, onResume]) {
      expect(isTimeRowKind(row.kind)).toBe(true);
      expect(timeRowIsWellFormed(row as never)).toBe(true);
    }
  });

  it('the door refuses a row the builders never file', () => {
    const broken: Record<string, unknown>[] = [
      { ...stamp, turn: '2' },
      { ...stamp, iteration: -1 },
      { ...stamp, now: '2026-10-09T15:40:00' },
      { ...stamp, nowSource: 'guessed' },
      { ...stamp, zone: 'PST' },
      { ...stamp, zoneSource: 'server' },
      { ...stamp, window: WINDOW },
      { ...stamp, window: { ...WINDOW, source: 'answered' } },
      { ...call, toolCallId: 7 },
      { ...call, dispatchedAt: 'yesterday' },
      { ...onResume, passed: {} },
      { ...onResume, passed: { now: NOW, extra: 1 } },
      { ...onResume, kept: { now: NOW } },
      { ...onResume, kept: { now: NOW, zone: LA, window: { from: NOW, to: NOW } } },
      { ...stamp, kind: 'clocks' },
    ];
    for (const row of broken) expect(timeRowIsWellFormed(row)).toBe(false);
  });
});

describe('property — a now is accepted exactly when the strict profile accepts it', () => {
  it('2 000 generated strings', () => {
    const r = prng(0x7133);
    for (let i = 0; i < 2000; i++) {
      const now = instantish(r);
      const read = readRunTime({ now });
      const strict = instantOf(now, 'strict') !== undefined;
      expect('value' in read, `case ${i}: ${now}`).toBe(strict);
      if ('value' in read) expect(read.value?.now).toBe(now);
    }
  });
});

describe('security — hostile inputs are refused by name, never thrown on', () => {
  class Time {
    zone = LA;
  }
  const hostile: unknown[] = [
    new Time(),
    Object.create({ zone: LA }),
    JSON.parse('{"__proto__": {"zone": "UTC"}}'),
    { zone: 'x'.repeat(1_000_000) },
    { now: '2026-10-09T15:40:00Z'.repeat(50_000) },
    { zone: { toString: () => LA } },
    { window: { from: { toString: () => NOW }, to: NOW } },
  ];
  it('each is a named problem, and none reaches a value', () => {
    for (const value of hostile) {
      const read = readRunTime(value);
      expect('problem' in read).toBe(true);
    }
    expect('problem' in readTimeOptions(new Time())).toBe(true);
    expect('problem' in readTimeOptions({ zone: 'x'.repeat(1_000_000) })).toBe(true);
  });
});

describe('performance', () => {
  it('10 000 run inputs read and drafted inside 500 ms', () => {
    const t0 = performance.now();
    for (let i = 0; i < 10_000; i++) {
      const read = readRunTime({ now: NOW, zone: LA, window: WINDOW });
      if ('value' in read) draftClock(read.value, {});
    }
    expect(performance.now() - t0).toBeLessThan(500);
  });
});
