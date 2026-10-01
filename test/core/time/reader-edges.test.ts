/**
 * The reader's edges (time follow-ups, packet "reader"): where a range ENDS,
 * which meridiem a bare first side takes, a 24-hour form, a zone named by
 * place or by an abbreviation the app maps, and a bare first side the grammar
 * does not read. Every item was found on a real bench record and pinned here
 * before the fix.
 *
 * Laws pinned:
 *   - `resolve.ts` owns the end edge: a range end said as an o'clock hour
 *     ends AT that instant ("8 AM to 9 AM" is `[08:00, 09:00)`, no
 *     `end-of-grain`); a minute, second or day end, and a lone point, keep
 *     end-of-grain. "Was the end widened?" has ONE answer,
 *     `resolveRecord.ts` · `widenedGrain` — the said end asks it; the label asks
 *     `shownGrain` (that, or a look-back's grain: it ends AT now, never +1 ms).
 *   - the reader returns zone-less parts: a zone after a day word or named
 *     by place (`London time`) is a TOKEN as written; `resolve.ts` ·
 *     `zoneReadsOf` maps it, to the one zone the tz database names, else asks.
 *   - an abbreviation names a zone only through the app's map, read BOTH ways
 *     when its zone and its letters disagree — never corrected, never guessed.
 *   - every reading stays a proposal (`said: []`, open with `confirm`).
 *
 * Test types:
 *   unit        — each fixed item, and the guards that keep each fix from spreading;
 *   property    — seeded ranges of clock times: an o'clock end is exact, a minute end is +1 min,
 *                 a bare first side takes the second side's meridiem unless that runs backwards;
 *                 every zone the runtime lists by a unique last segment is found by its place;
 *   G13         — two sides with no meridiem share one (`8:45 to 8:55` → AM–AM, PM–PM), crossing
 *                 the half-day only when neither runs forward (`11 to 1` → 11 AM – 1 PM and
 *                 11 PM – 1 AM the next day); unit table, the reader run, a seeded property;
 *   boundary    — `8 AM to 8 AM` is no window; `11 to 1 PM` falls back to 11 AM; an abbreviation
 *                 whose zone agrees with its letters (PST in January) is one reading;
 *   security    — hostile policy maps, place tokens and built-in-name zone tokens
 *                 (`constructor`, `__proto__`) are refused or asked, never thrown on;
 *   byte identity — a policy without `abbreviations` reads to the v1 bytes; with no map `PST` is
 *                 still asked (no map ships).
 *   integration / functional through real agents: english-run.test.ts ("reader edges").
 */

import { describe, expect, it } from 'vitest';

import { englishTimeReader } from '../../../src/index.js';
import { checkReading, type TimeParts } from '../../../src/core/time/reader.js';
import {
  chooseReading,
  DEFAULT_TIME_POLICY,
  readPolicy,
  resolveMention,
  widenedGrain,
  withZoneAnswered,
  type TimeCandidate,
  type TimePolicy,
} from '../../../src/core/time/resolve.js';
import { candidateIsWellFormed, choiceIsWellFormed } from '../../../src/core/time/resolveRecord.js';
import { timeAskOf } from '../../../src/core/time/readingAsk.js';
import { timeReadingRows } from '../../../src/core/time/rowsBuild.js';
import { timeRowIsWellFormed } from '../../../src/core/time/rows.js';
import { timeFormsOf } from '../../../src/core/time/forms.js';
import { canonicalZone, fixedOffsetZone, zoneOfPlace } from '../../../src/core/time/zone.js';
import { defaultTimeAskMessages } from '../../../src/locales/timeAsk.js';
import { int, pick, prng } from './fixtures/generate.js';

const LA = 'America/Los_Angeles';
const CLOCK = { now: '2026-10-09T15:40:00Z', zone: LA };
const RULE = { id: 'agentfootprint/english', kind: 'rule' as const };
const reader = englishTimeReader();
const read = (text: string) =>
  reader.read(text, { locale: 'en-US' }) as ReturnType<typeof reader.read> & {
    mentions: { quote: string; parses: TimeParts[]; problem?: 'unreadable' }[];
  };

const PST_MAP: TimePolicy = {
  ...DEFAULT_TIME_POLICY,
  abbreviations: { PST: { zone: LA, offset: '-08:00' } },
};

const resolve = (parts: TimeParts, clock = CLOCK, policy?: TimePolicy) =>
  resolveMention([parts], clock, RULE, true, policy);
const ranges = (cs: readonly TimeCandidate[]) => cs.map((c) => `${c.range.from}/${c.range.to}`);
const am = (h: number, m?: number) => ({
  h,
  ...(m !== undefined && { m }),
  meridiem: 'am' as const,
});
const pm = (h: number, m?: number) => ({
  h,
  ...(m !== undefined && { m }),
  meridiem: 'pm' as const,
});

/** The rows seed files for a message, under a policy. */
const rowsOf = (text: string, policy: TimePolicy = DEFAULT_TIME_POLICY, now = CLOCK.now) =>
  timeReadingRows({
    mentions: checkReading(text, read(text), reader.id),
    clock: { now, nowSource: 'app', zone: LA, zoneSource: 'app' } as never,
    policy,
    reader: { id: reader.id, version: reader.version, kind: 'rule', locale: 'en-US' },
    tzdata: 'test',
    at: { turn: 1, iteration: 1 },
  });

// ─── reader-end-edge ─────────────────────────────────────────────────────

describe('the end edge — an o’clock end is a boundary, owned by resolve.ts', () => {
  it('“8 AM to 9 AM” is one hour: [08:00, 09:00), no end-of-grain', () => {
    const [c, ...rest] = resolve({ rangeOf: [{ wall: am(8) }, { wall: am(9) }] }).candidates;
    expect(rest).toEqual([]);
    expect(ranges([c!])).toEqual(['2026-10-09T08:00:00-07:00/2026-10-09T09:00:00-07:00']);
    expect(c!.notes).not.toContainEqual({ kind: 'end-of-grain' });
    expect(widenedGrain(c!)).toBeUndefined();
    expect(candidateIsWellFormed(c)).toBe(true);
  });

  it('BOUNDARY: “8 AM to 8 AM” names no window', () => {
    expect(resolve({ rangeOf: [{ wall: am(8) }, { wall: am(8) }] }).candidates).toEqual([]);
  });

  it('GUARD: a minute end keeps end-of-grain (“to 8:40” → 08:41)', () => {
    const [c] = resolve({ rangeOf: [{ wall: am(8) }, { wall: am(8, 40) }] }).candidates;
    expect(ranges([c!])).toEqual(['2026-10-09T08:00:00-07:00/2026-10-09T08:41:00-07:00']);
    expect(c!.notes).toContainEqual({ kind: 'end-of-grain' });
    expect(widenedGrain(c!)).toBe('minute');
  });

  it('GUARD: a day end keeps its whole day (“10/01/26 to 10/09/26” ends 10-10)', () => {
    const res = resolve({
      rangeOf: [
        { date: { kind: 'numeric', fields: [10, 1, 26], yearDigits: 2 } },
        { date: { kind: 'numeric', fields: [10, 9, 26], yearDigits: 2 } },
      ],
    });
    const mdy = res.candidates.find((c) => c.reading.dateOrder === 'MDY')!;
    expect(ranges([mdy])).toEqual(['2026-10-01T00:00:00-07:00/2026-10-10T00:00:00-07:00']);
    expect(widenedGrain(mdy)).toBe('day');
  });

  it('GUARD: a lone “9 AM” is still the 9 o’clock hour, [09:00, 10:00), noted', () => {
    const [c] = resolve({ wall: am(9) }).candidates;
    expect(ranges([c!])).toEqual(['2026-10-09T09:00:00-07:00/2026-10-09T10:00:00-07:00']);
    expect(widenedGrain(c!)).toBe('hour');
  });

  it('the confirmation shows the window as it is: “8:00 – 9:00 AM”, never 9:59', () => {
    const [row] = rowsOf('Any errors yesterday 8 AM to 9 AM?');
    const ask = timeAskOf(row!, defaultTimeAskMessages)!;
    expect(ask.field.enum).toEqual(['2026-10-08T08:00:00-07:00/2026-10-08T09:00:00-07:00']);
    expect(ask.field.labels![0]!.replace(/\s/g, ' ')).toBe(
      'I read “yesterday 8 AM to 9 AM” as Thu, Oct 8, 2026, 8:00 – 9:00 AM PDT in America/Los_Angeles — is that right?',
    );
    // A widened end is still shown as said.
    const [minute] = rowsOf('errors 8 AM to 8:40 AM');
    expect(
      timeAskOf(minute!, defaultTimeAskMessages)!.field.labels![0]!.replace(/\s/g, ' '),
    ).toContain('8:00 – 8:40 AM');
  });

  it('a look-back’s confirmation ends at the clock’s now, at its grain — never the +1 ms edge', () => {
    // A look-back is [now − L, now + 1 ms): its end is not widened to a grain, but the
    // label still shows the last instant inside it — now — at the grain the person counted in.
    const label = (text: string) =>
      timeAskOf(rowsOf(text)[0]!, defaultTimeAskMessages)!.field.labels![0]!.replace(/\s/g, ' ');
    expect(label('errors in the last 40 minutes')).toBe(
      'I read “last 40 minutes” as Fri, Oct 9, 2026, 8:00 – 8:40 AM PDT in America/Los_Angeles — is that right?',
    );
    const week = label('errors in the past week');
    expect(week).toContain('Oct 2');
    expect(week).toContain('Oct 9');
    expect(week).not.toMatch(/\.00\d|:00:00/);
  });

  it('the said end of a confirmed o’clock range is 9 AM (forms.ts asks widenedGrain)', () => {
    const { said } = timeFormsOf({
      window: {
        source: 'answered',
        answer: 'confirmed',
        range: { from: '2026-10-09T08:00:00-07:00', to: '2026-10-09T09:00:00-07:00' },
        zone: LA,
        reading: { said: ['hour', 'meridiem'], grain: 'hour', notes: [] },
      },
    });
    expect(said).toEqual(expect.arrayContaining(['8:00', '08:00', '9:00', '09:00', '9:00am']));
  });

  it('property: 600 seeded ranges — an o’clock end is exact, a minute end runs one minute on', () => {
    const r = prng(0x51ed6e);
    for (let i = 0; i < 600; i++) {
      const h1 = int(r, 1, 11);
      const h2 = int(r, h1 + 1, 12);
      const m2 = r() < 0.5 ? undefined : int(r, 0, 59);
      const mer = pick(r, ['am', 'pm'] as const);
      const side = (h: number, m?: number) => ({ h, ...(m !== undefined && { m }), meridiem: mer });
      const res = resolve({ rangeOf: [{ wall: side(h1) }, { wall: side(h2, m2) }] });
      const to24 = (h: number) => (h % 12) + (mer === 'pm' ? 12 : 0);
      if (to24(h2) * 60 + (m2 ?? 0) <= to24(h1) * 60) {
        expect(res.candidates, `${h1}–${h2}:${m2}${mer}`).toEqual([]);
        continue;
      }
      expect(res.candidates, `${h1}–${h2}:${m2}${mer}`).toHaveLength(1);
      const c = res.candidates[0]!;
      const endMs = Date.parse(c.range.to);
      const saidMs = Date.parse(
        `2026-10-09T${String(to24(h2)).padStart(2, '0')}:${String(m2 ?? 0).padStart(
          2,
          '0',
        )}:00-07:00`,
      );
      expect(endMs - saidMs, `${h1}–${h2}:${m2}${mer}`).toBe(m2 === undefined ? 0 : 60_000);
      expect(widenedGrain(c)).toBe(m2 === undefined ? undefined : 'minute');
    }
  });
});

describe('a bare first side takes the second side’s meridiem (English’s own rule)', () => {
  it('“between 8 and 9 PM” is 8 PM – 9 PM — one window, not a 14-hour one', () => {
    const [row] = rowsOf('errors between 8 and 9 PM');
    expect(ranges(row!.candidates!)).toEqual([
      '2026-10-09T20:00:00-07:00/2026-10-09T21:00:00-07:00',
    ]);
    expect(row!.choice).toEqual({ by: 'open', remaining: [0], open: ['confirm'] });
  });

  it('“8-9am” is 8 AM – 9 AM', () => {
    expect(ranges(resolve({ rangeOf: [{ wall: { h: 8 } }, { wall: am(9) }] }).candidates)).toEqual([
      '2026-10-09T08:00:00-07:00/2026-10-09T09:00:00-07:00',
    ]);
  });

  it('BOUNDARY: “11 to 1 PM” falls back to 11 AM (11 PM would run backwards)', () => {
    expect(ranges(resolve({ rangeOf: [{ wall: { h: 11 } }, { wall: pm(1) }] }).candidates)).toEqual(
      ['2026-10-09T11:00:00-07:00/2026-10-09T13:00:00-07:00'],
    );
  });

  it('GUARD: both sides with no meridiem still leave the meridiem open (AM–AM and PM–PM, G13)', () => {
    const res = resolve({ rangeOf: [{ wall: { h: 8 } }, { wall: { h: 9, m: 40 } }] });
    expect(ranges(res.candidates)).toEqual([
      '2026-10-09T08:00:00-07:00/2026-10-09T09:41:00-07:00',
      '2026-10-09T20:00:00-07:00/2026-10-09T21:41:00-07:00',
    ]);
    expect(chooseReading(res, DEFAULT_TIME_POLICY, 'rule', undefined, true)).toMatchObject({
      open: ['meridiem', 'confirm'],
    });
  });

  it('property: 400 seeded bare-first ranges — the second side’s meridiem when it runs forward', () => {
    const r = prng(0xbea7);
    for (let i = 0; i < 400; i++) {
      const h1 = int(r, 1, 12);
      const h2 = int(r, 1, 12);
      const mer = pick(r, ['am', 'pm'] as const);
      const res = resolve({ rangeOf: [{ wall: { h: h1 } }, { wall: { h: h2, meridiem: mer } }] });
      const end = (h2 % 12) + (mer === 'pm' ? 12 : 0);
      const same = (h1 % 12) + (mer === 'pm' ? 12 : 0);
      const other = (h1 % 12) + (mer === 'pm' ? 0 : 12);
      const want = same < end ? same : other < end ? other : undefined;
      const label = `${h1} to ${h2} ${mer}`;
      if (want === undefined) {
        expect(res.candidates, label).toEqual([]);
        continue;
      }
      expect(res.candidates, label).toHaveLength(1);
      expect(new Date(res.candidates[0]!.range.from).getTime(), label).toBe(
        Date.parse(`2026-10-09T${String(want).padStart(2, '0')}:00:00-07:00`),
      );
    }
  });
});

// ─── G13: two sides with no meridiem share one ──────────────────────────

describe('G13 — a range whose two sides say no meridiem shares one (never AM → PM across the half-day)', () => {
  const D = '2026-10-09';
  const N = '2026-10-10';
  const at = (day: string, hm: string) => `${day}T${hm}:00-07:00`;
  const span = (a: string, b: string, c: string, d: string) => `${at(a, b)}/${at(c, d)}`;
  const wall = (h: number, m?: number) => ({ wall: { h, ...(m !== undefined && { m }) } });

  for (const [said, l, r, want] of [
    [
      '8:45 to 8:55',
      wall(8, 45),
      wall(8, 55),
      [span(D, '08:45', D, '08:56'), span(D, '20:45', D, '20:56')],
    ],
    [
      '8 to 9:30',
      wall(8),
      wall(9, 30),
      [span(D, '08:00', D, '09:31'), span(D, '20:00', D, '21:31')],
    ],
    ['8 to 9', wall(8), wall(9), [span(D, '08:00', D, '09:00'), span(D, '20:00', D, '21:00')]],
    ['12 to 1', wall(12), wall(1), [span(D, '00:00', D, '01:00'), span(D, '12:00', D, '13:00')]],
    ['11 to 1', wall(11), wall(1), [span(D, '11:00', D, '13:00'), span(D, '23:00', N, '01:00')]],
    [
      '11:15 to 12:30',
      wall(11, 15),
      wall(12, 30),
      [span(D, '11:15', D, '12:31'), span(D, '23:15', N, '00:31')],
    ],
    ['8 to 8', wall(8), wall(8), [span(D, '08:00', D, '20:00'), span(D, '20:00', N, '08:00')]],
  ] as const) {
    it(`“${said}” → ${want.length} readings, each AM–AM / PM–PM unless the right side is earlier on the clock`, () => {
      const res = resolve({ rangeOf: [l, r] });
      expect(ranges(res.candidates)).toEqual(want);
      for (const c of res.candidates) expect(candidateIsWellFormed(c)).toBe(true);
      expect(chooseReading(res, DEFAULT_TIME_POLICY, 'rule', undefined, true)).toMatchObject({
        by: 'open',
        open: ['meridiem', 'confirm'],
      });
    });
  }

  it('each reading records the meridiem it shares — or the half-day it crosses', () => {
    const shared = resolve({ rangeOf: [wall(8, 45), wall(8, 55)] }).candidates;
    expect(shared.map((c) => [c.reading.meridiem, c.reading.endMeridiem])).toEqual([
      ['am', 'am'],
      ['pm', 'pm'],
    ]);
    const crossing = resolve({ rangeOf: [wall(11), wall(1)] }).candidates;
    expect(crossing.map((c) => [c.reading.meridiem, c.reading.endMeridiem])).toEqual([
      ['am', 'pm'],
      ['pm', 'am'],
    ]);
  });

  it('the reader run: “September 29 8:45 to 8:55” is offered AM–AM and PM–PM for each year, never 8:45 AM – 8:55 PM', () => {
    const [row] = rowsOf('any SMB September 29 8:45 to 8:55');
    expect(row!.quote).toBe('September 29 8:45 to 8:55');
    expect(ranges(row!.candidates!)).toEqual([
      '2026-09-29T08:45:00-07:00/2026-09-29T08:56:00-07:00',
      '2026-09-29T20:45:00-07:00/2026-09-29T20:56:00-07:00',
      '2025-09-29T08:45:00-07:00/2025-09-29T08:56:00-07:00',
      '2025-09-29T20:45:00-07:00/2025-09-29T20:56:00-07:00',
    ]);
    expect(row!.choice).toMatchObject({ by: 'open', open: ['year', 'meridiem', 'confirm'] });
    expect(timeRowIsWellFormed(row)).toBe(true);
  });

  it('the reader run: “today 11:00 to 1:00” crosses the half-day — 11 AM – 1 PM, and overnight to 1 AM tomorrow', () => {
    const [row] = rowsOf('errors today 11:00 to 1:00');
    expect(ranges(row!.candidates!)).toEqual([
      '2026-10-09T11:00:00-07:00/2026-10-09T13:01:00-07:00',
      '2026-10-09T23:00:00-07:00/2026-10-10T01:01:00-07:00',
    ]);
  });

  it('BOUNDARY: a right side with a day of its own is never moved to the next day', () => {
    const day = { kind: 'fixed', month: 10, day: 9 } as const;
    const res = resolve({
      rangeOf: [
        { date: day, wall: { h: 11 } },
        { date: day, wall: { h: 1 } },
      ],
    } as TimeParts);
    expect(ranges(res.candidates)).toEqual([
      '2026-10-09T11:00:00-07:00/2026-10-09T13:00:00-07:00',
      '2025-10-09T11:00:00-07:00/2025-10-09T13:00:00-07:00',
    ]);
  });

  it('GUARD (9.132): a bare first side still takes the second side’s said meridiem', () => {
    expect(ranges(resolve({ rangeOf: [wall(8), { wall: pm(9) }] }).candidates)).toEqual([
      span(D, '20:00', D, '21:00'),
    ]);
    expect(ranges(resolve({ rangeOf: [wall(11), { wall: pm(1) }] }).candidates)).toEqual([
      span(D, '11:00', D, '13:00'),
    ]);
  });

  it('GUARD: a side that says its meridiem, or a 24-hour hour, is read as before', () => {
    // A said first side leaves a bare second side read both ways ("9 AM to 5" may be 5 PM).
    expect(ranges(resolve({ rangeOf: [{ wall: am(8) }, wall(9)] }).candidates)).toEqual([
      span(D, '08:00', D, '09:00'),
      span(D, '08:00', D, '21:00'),
    ]);
    expect(ranges(resolve({ rangeOf: [wall(8), wall(13)] }).candidates)).toEqual([
      span(D, '08:00', D, '13:00'),
    ]);
    expect(
      ranges(resolve({ rangeOf: [{ wall: { h: 8, clock: '24h' } }, wall(9)] }).candidates),
    ).toEqual([span(D, '08:00', D, '09:00'), span(D, '08:00', D, '21:00')]);
  });

  it('property: 600 seeded bare ranges — every reading shares a meridiem, or crosses only when none can', () => {
    const r = prng(0x613);
    const mins = (h: number, m: number) => (h % 12) * 60 + m;
    for (let i = 0; i < 600; i++) {
      const [h1, h2] = [int(r, 1, 12), int(r, 1, 12)];
      const m1 = r() < 0.5 ? undefined : int(r, 0, 59);
      const m2 = r() < 0.5 ? undefined : int(r, 0, 59);
      const label = `${h1}:${m1} to ${h2}:${m2}`;
      const res = resolve({ rangeOf: [wall(h1, m1), wall(h2, m2)] });
      // The shared reading runs forward when the end (an o'clock end AT it, else a minute on)
      // comes after the start on the 12-hour face.
      const end = mins(h2, m2 ?? 0) + (m2 === undefined ? 0 : 1);
      const sharedForward = end > mins(h1, m1 ?? 0);
      const pairs = res.candidates.map((c) => `${c.reading.meridiem}-${c.reading.endMeridiem}`);
      expect(pairs, label).toEqual(sharedForward ? ['am-am', 'pm-pm'] : ['am-pm', 'pm-am']);
      for (const c of res.candidates) {
        expect(Date.parse(c.range.from) < Date.parse(c.range.to), label).toBe(true);
        // Never a window longer than the half-day it may cross.
        expect(Date.parse(c.range.to) - Date.parse(c.range.from), label).toBeLessThanOrEqual(
          12 * 3_600_000,
        );
      }
    }
  });
});

describe('a bare first side the grammar does not read — the whole phrase is unreadable', () => {
  for (const [text, quote] of [
    ['errors 8 to 9:30', '8 to 9:30'],
    ['errors from 8 to 9:30', 'from 8 to 9:30'],
    ['errors between 8 and 9:30', 'between 8 and 9:30'],
    ['errors 8-9:30', '8-9:30'],
  ] as const) {
    it(`${JSON.stringify(
      text,
    )} → one unreadable mention quoting “${quote}”, never the point 9:30`, () => {
      expect(read(text).mentions).toEqual([{ quote, parses: [], problem: 'unreadable' }]);
    });
  }

  it('GUARD: a far side with a meridiem is still read (“8 to 9 AM”)', () => {
    expect(read('errors 8 to 9 AM').mentions).toEqual([
      { quote: '8 to 9 AM', parses: [{ rangeOf: [{ wall: { h: 8 } }, { wall: am(9) }] }] },
    ]);
  });
});

describe('a 24-hour form says its hour — an ISO instant is never also pm', () => {
  it('the reader marks the ISO clock; resolve gives one reading and no meridiem question', () => {
    const [m] = read('errors 2026-10-08T08:00-07:00').mentions;
    expect(m!.parses[0]!.wall).toEqual({ h: 8, m: 0, clock: '24h' });
    const [row] = rowsOf('errors 2026-10-08T08:00-07:00');
    expect(ranges(row!.candidates!)).toEqual([
      '2026-10-08T08:00:00-07:00/2026-10-08T08:01:00-07:00',
    ]);
    expect(row!.choice).toEqual({ by: 'open', remaining: [0], open: ['confirm'] });
  });

  it('an ISO range is one window, not three', () => {
    const [row] = rowsOf('errors 2026-10-08T08:00-07:00 to 2026-10-08T09:00-07:00');
    expect(row!.candidates).toHaveLength(1);
    expect(row!.choice).toMatchObject({ open: ['confirm'] });
  });

  it('SECURITY: the port refuses a 24-hour mark beside a meridiem, or any other value', () => {
    for (const wall of [
      { h: 8, meridiem: 'am', clock: '24h' },
      { h: 8, clock: '12h' },
    ]) {
      expect(
        checkReading('x', { mentions: [{ quote: 'x', parses: [{ wall }] }] }, 'fixture'),
      ).toEqual([{ refused: 'malformed' }]);
    }
  });
});

// ─── reader-zones-and-dates ─────────────────────────────────────────────

describe('a zone the person named in words is a PROPOSAL, never dropped and never the app’s', () => {
  it('“yesterday London time” — the reader quotes it all and keeps the words as written', () => {
    expect(read('Show client activity yesterday London time').mentions).toEqual([
      {
        quote: 'yesterday London time',
        parses: [{ relative: { unit: 'day', offset: -1 }, zoneToken: 'London time' }],
      },
    ]);
    for (const [text, token] of [
      ['errors yesterday UTC', 'UTC'],
      ['errors yesterday Europe/London', 'Europe/London'],
      ['errors yesterday in Asia/Kolkata', 'Asia/Kolkata'],
      ['errors yesterday PST', 'PST'],
      ['errors 8 AM New York time', 'New York time'],
      ['errors 10/08/26 London time', 'London time'],
    ] as const) {
      expect(read(text).mentions[0]!.parses[0]!.zoneToken, text).toBe(token);
    }
  });

  it('GUARD: lower-case words before “time” are no zone', () => {
    expect(read('errors yesterday at the same time').mentions).toEqual([
      { quote: 'yesterday', parses: [{ relative: { unit: 'day', offset: -1 } }] },
    ]);
  });

  it('the London day is proposed in Europe/London (+01:00), noted, never said', () => {
    const [row] = rowsOf('Show client activity yesterday London time');
    expect(timeRowIsWellFormed(row)).toBe(true);
    const [c, ...rest] = row!.candidates!;
    expect(rest).toEqual([]);
    expect(c).toMatchObject({
      range: { from: '2026-10-08T00:00:00+01:00', to: '2026-10-09T00:00:00+01:00' },
      zone: 'Europe/London',
      said: [],
      implied: ['year', 'month'],
    });
    expect(c!.notes).toContainEqual({ kind: 'zone-read', token: 'London time', as: 'place' });
    expect(row!.choice).toEqual({ by: 'open', remaining: [0], open: ['confirm'] });
    const label = timeAskOf(row!, defaultTimeAskMessages)!.field.labels![0]!;
    expect(label).toContain('in Europe/London — is that right?');
  });

  it('a place the tz database names never, or more than once, is ASKED with the words', () => {
    for (const token of ['India time', 'Pacific time', 'Server time', 'Eastern time']) {
      const res = resolve({ relative: { unit: 'day', offset: -1 }, zoneToken: token });
      expect(res, token).toEqual({ candidates: [], needsZone: true, unsupported: [] });
    }
    const [row] = rowsOf('errors yesterday India time');
    expect(timeAskOf(row!, defaultTimeAskMessages)!.question).toBe(
      'Which time zone did you mean by “India time” in “yesterday India time”?',
    );
  });

  it('zone.ts · zoneOfPlace — the tz database’s own data, compared by canonical name', () => {
    expect(zoneOfPlace('London')).toBe('Europe/London');
    expect(zoneOfPlace('New York')).toBe('America/New_York');
    expect(zoneOfPlace('new york')).toBe('America/New_York');
    for (const place of [
      'India',
      'Pacific',
      'Eastern',
      'US',
      'Etc',
      '',
      ' ',
      'a/b',
      'x'.repeat(40),
    ]) {
      expect(zoneOfPlace(place), place).toBeUndefined();
    }
  });

  it('property: every zone the runtime lists under a unique last segment is found by that place', () => {
    const names = Intl.supportedValuesOf('timeZone').filter((z) =>
      /^(Africa|America|Antarctica|Asia|Atlantic|Australia|Europe|Indian|Pacific)\//.test(z),
    );
    const last = (z: string) => z.slice(z.lastIndexOf('/') + 1).toLowerCase();
    const count = new Map<string, number>();
    for (const z of names) count.set(last(z), (count.get(last(z)) ?? 0) + 1);
    let checked = 0;
    for (const z of names) {
      if (count.get(last(z)) !== 1) continue;
      const place = z.slice(z.lastIndexOf('/') + 1).replace(/_/g, ' ');
      const found = zoneOfPlace(place);
      // A link under another area may make it ambiguous; when found, it is this zone.
      if (found !== undefined) expect(found, place).toBe(canonicalZone(z));
      checked += found === undefined ? 0 : 1;
    }
    expect(checked).toBeGreaterThan(300);
  });

  it('zone.ts · fixedOffsetZone — whole hours only, POSIX signs', () => {
    expect(fixedOffsetZone(-480)).toBe('Etc/GMT+8');
    expect(fixedOffsetZone(60)).toBe('Etc/GMT-1');
    expect(fixedOffsetZone(0)).toBe('UTC');
    expect(fixedOffsetZone(330)).toBeUndefined();
    expect(fixedOffsetZone(15 * 60)).toBeUndefined();
  });
});

describe('an abbreviation names a zone only through the APP’s map — both readings when they disagree', () => {
  it('BYTE IDENTITY: no map → PST is asked as a zone, exactly as v1', () => {
    expect(resolve({ wall: am(8), zoneToken: 'PST' })).toEqual({
      candidates: [],
      needsZone: true,
      unsupported: [],
    });
    expect(JSON.stringify(readPolicy({ dateOrder: 'MDY' }))).toBe(
      '{"dateOrder":"MDY","year":"ask"}',
    );
    expect(readPolicy(undefined)).toBe(DEFAULT_TIME_POLICY);
    expect('abbreviations' in DEFAULT_TIME_POLICY).toBe(false);
  });

  it('PST on 9 October → its zone (−07:00) AND its letters (−08:00), one confirmation', () => {
    const res = resolve({ wall: am(8), zoneToken: 'PST' }, CLOCK, PST_MAP);
    expect(ranges(res.candidates)).toEqual([
      '2026-10-09T08:00:00-07:00/2026-10-09T09:00:00-07:00',
      '2026-10-09T08:00:00-08:00/2026-10-09T09:00:00-08:00',
    ]);
    expect(res.candidates.map((c) => c.zone)).toEqual([LA, 'Etc/GMT+8']);
    expect(res.candidates.map((c) => c.reading.abbreviation)).toEqual(['zone', 'literal']);
    expect(res.candidates[0]!.notes).toContainEqual({
      kind: 'zone-read',
      token: 'PST',
      as: 'abbreviation',
    });
    expect(res.candidates[1]!.notes).toContainEqual({
      kind: 'zone-read',
      token: 'PST',
      as: 'abbreviation-literal',
    });
    const choice = chooseReading(res, PST_MAP, 'rule', undefined, true);
    expect(choice).toEqual({ by: 'open', remaining: [0, 1], open: ['abbreviation', 'confirm'] });
    expect(choiceIsWellFormed(choice, 2)).toBe(true);
    expect(res.candidates.every(candidateIsWellFormed)).toBe(true);
  });

  it('BOUNDARY: PST in January agrees with its zone — one reading', () => {
    const winter = { now: '2026-01-15T18:00:00Z', zone: LA };
    const res = resolve({ wall: am(8), zoneToken: 'PST' }, winter, PST_MAP);
    expect(ranges(res.candidates)).toEqual(['2026-01-15T08:00:00-08:00/2026-01-15T09:00:00-08:00']);
    expect(chooseReading(res, PST_MAP, 'rule', undefined, true)).toEqual({
      by: 'open',
      remaining: [0],
      open: ['confirm'],
    });
  });

  it('a range reads both sides the same way — never zone on one side, letters on the other', () => {
    const res = resolve(
      {
        date: { kind: 'numeric', fields: [10, 9, 26], yearDigits: 2 },
        zoneToken: 'PST',
        rangeOf: [{ wall: am(8) }, { wall: am(8, 40) }],
      },
      CLOCK,
      { ...PST_MAP, dateOrder: 'MDY' },
    );
    const mdy = res.candidates.filter((c) => c.reading.dateOrder === 'MDY');
    expect(ranges(mdy)).toEqual([
      '2026-10-09T08:00:00-07:00/2026-10-09T08:41:00-07:00',
      '2026-10-09T08:00:00-08:00/2026-10-09T08:41:00-08:00',
    ]);
  });

  it('an abbreviation missing from the map is still asked; a person’s zone answer replaces only it', () => {
    expect(resolve({ wall: am(8), zoneToken: 'CET' }, CLOCK, PST_MAP).needsZone).toBe(true);
    expect(
      withZoneAnswered(
        [
          {
            rangeOf: [
              { wall: am(8), zoneToken: 'PST' },
              { wall: am(9), zoneToken: 'CET' },
            ],
          },
        ],
        'Europe/Paris',
        PST_MAP,
      ),
    ).toEqual([
      {
        rangeOf: [
          { wall: am(8), zoneToken: 'PST' },
          { wall: am(9), zoneToken: 'Europe/Paris' },
        ],
      },
    ]);
  });

  it('readPolicy reads the map and refuses what is no map', () => {
    expect(readPolicy({ abbreviations: { PST: { zone: LA, offset: '-0800' } } })).toEqual({
      dateOrder: 'ask',
      year: 'ask',
      abbreviations: { PST: { zone: LA, offset: '-08:00' } },
    });
    for (const bad of [
      null,
      [],
      {},
      { PST: LA },
      { PST: { zone: 'PST', offset: '-08:00' } },
      { PST: { zone: LA, offset: '8' } },
      { PST: { zone: LA } },
      { PST: { zone: LA, offset: '-08:00', extra: 1 } },
      { 'P S T': { zone: LA, offset: '-08:00' } },
      { __proto__x: { zone: LA, offset: '-08:00' } },
    ]) {
      expect(typeof readPolicy({ abbreviations: bad }), JSON.stringify(bad)).toBe('string');
    }
    expect(typeof readPolicy({ abbreviationMismatch: 'ask' })).toBe('string');
  });

  it('SECURITY: a zone token that is a built-in property name is asked, never thrown on', () => {
    // A `model` or custom reader passes any non-empty token; the map is looked up by OWN key only.
    const withMap = readPolicy({ abbreviations: { PST: { zone: LA, offset: '-08:00' } } });
    expect(typeof withMap).not.toBe('string');
    for (const token of ['constructor', 'toString', '__proto__', 'hasOwnProperty', 'valueOf']) {
      for (const policy of [PST_MAP, withMap as TimePolicy]) {
        const parts: TimeParts = {
          wall: am(8),
          relative: { unit: 'day', offset: -1 },
          zoneToken: token,
        };
        expect(resolve(parts, CLOCK, policy), token).toEqual({
          candidates: [],
          needsZone: true,
          unsupported: [],
        });
      }
    }
  });
});

describe('a numeric date is declared ambiguous — the app’s order policy, else every reading offered', () => {
  it('default (`ask`): the confirmation offers every calendar reading, nothing guessed', () => {
    const [row] = rowsOf('Show client activity on 10/08/26');
    expect(row!.choice).toEqual({
      by: 'open',
      remaining: [0, 1, 2],
      open: ['date-order', 'confirm'],
    });
    expect(timeAskOf(row!, defaultTimeAskMessages)!.field.enum).toHaveLength(3);
  });

  it('`MDY`: one reading left, the order recorded as the policy’s — still confirmed', () => {
    const [row] = rowsOf('Show client activity on 10/08/26', {
      ...DEFAULT_TIME_POLICY,
      dateOrder: 'MDY',
    });
    expect(row!.choice).toEqual({
      by: 'open',
      remaining: [0],
      open: ['confirm'],
      policy: { dateOrder: 'MDY' },
    });
  });
});
