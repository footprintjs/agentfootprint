/**
 * core/time/reader + core/time/resolve + the `time-reading` row — the reader
 * port's checks, the resolver over FIXED parts, the v1 policy and the fixed
 * laws (the time design § 5.1, § 5.5, § 11, step T6a). No English is read
 * here: every case hands the resolver the parts a fixture reader would
 * return. End to end through real agents: reader-run.test.ts.
 *
 * Test types:
 *   unit        — every candidate for `10/09/26` (MDY, DMY, YMD, each a calendar day, the century
 *                 noted); a bare `8:40` → am and pm; `20:40` → one; a fall-back overlap → both
 *                 instants noted `dst-overlap`; a spring-forward gap → both readings noted
 *                 `dst-gap`; a range read to the end of its grain; `yesterday`; a look-back;
 *                 a said IANA zone, a said offset, an abbreviation (asked, never mapped); the
 *                 unsupported parts named; `chooseReading` under the policy (`only`, `policy`,
 *                 `open` with its questions, `none`); the `model`-reading rule (`said: []`,
 *                 always confirmed);
 *   functional  — `readerIssue` / `checkReading`: an out-of-text quote is refused and keeps no
 *                 text; malformed parts are refused; a reading that is not `{ mentions: [] }`
 *                 throws naming the reader; `timeReadingRows` files one row per mention (or one
 *                 `mentions: 0` row) and the checkpoint door accepts each and refuses each field
 *                 broken;
 *   property    — 2 000 generated fixed dates + 24-hour wall times in five zones: every
 *                 candidate is a strict half-open range, `from` shows the said wall time in
 *                 the zone (or is one of a DST pair), and `to − from` is the grain;
 *   security    — hostile parts (`__proto__` keys, huge numbers, nested ranges, 1 MB tokens)
 *                 are refused as malformed, never thrown on;
 *   performance — 5 000 resolutions of a range with every ambiguity inside a COUNTED budget:
 *                 one formatter, and `Intl` asked at most once per (zone, instant);
 *   load        — not applicable: pure functions (the zone memo is a cache, not state; the per-turn reading's
 *                 load case is in reader-run.test.ts).
 */

import { describe, expect, it, vi } from 'vitest';

import { checkReading, readerIssue, type TimeParts } from '../../../src/core/time/reader.js';
import {
  chooseReading,
  DEFAULT_TIME_POLICY,
  readPolicy,
  resolveMention,
  type TimeCandidate,
  type TimePolicy,
} from '../../../src/core/time/resolve.js';
import { timeRowIsWellFormed } from '../../../src/core/time/rows.js';
import { timeReadingRows } from '../../../src/core/time/rowsBuild.js';
import { tzdataVersion, wallAt } from '../../../src/core/time/zone.js';
import { int, pick, prng } from './fixtures/generate.js';

const LA = 'America/Los_Angeles';
const CLOCK = { now: '2026-10-09T15:40:00Z', zone: LA };
const RULE = { id: 'fixture', kind: 'rule' as const };
const MODEL = { id: 'fixture-model', kind: 'model' as const };

const resolve = (parts: TimeParts | TimeParts[], clock = CLOCK, reader = RULE) =>
  resolveMention(Array.isArray(parts) ? parts : [parts], clock, reader);
const ranges = (cs: readonly TimeCandidate[]) => cs.map((c) => `${c.range.from}/${c.range.to}`);

const MDY: TimePolicy = { dateOrder: 'MDY', year: 'ask' };

// ─── The resolver ────────────────────────────────────────────────────────

describe('resolveMention — every candidate of the parts', () => {
  it('10/09/26 → MDY, DMY and YMD, each a whole calendar day in the clock zone', () => {
    const res = resolve({ date: { kind: 'numeric', fields: [10, 9, 26] } });
    expect(res.candidates.map((c) => c.reading)).toEqual([
      { dateOrder: 'MDY', year: 'said' },
      { dateOrder: 'DMY', year: 'said' },
      { dateOrder: 'YMD', year: 'said' },
    ]);
    expect(ranges(res.candidates)).toEqual([
      '2026-10-09T00:00:00-07:00/2026-10-10T00:00:00-07:00',
      '2026-09-10T00:00:00-07:00/2026-09-11T00:00:00-07:00',
      '2010-09-26T00:00:00-07:00/2010-09-27T00:00:00-07:00',
    ]);
    for (const c of res.candidates) {
      expect(c).toMatchObject({
        grain: 'day',
        zone: LA,
        said: ['year', 'month', 'day'],
        implied: ['zone'],
        anchor: 'none',
        reader: RULE,
        parse: 0,
      });
      expect(c.notes).toContainEqual({ kind: 'century-implied', century: 2000 });
      expect(c.notes).toContainEqual({ kind: 'end-of-grain' });
    }
    expect(chooseReading(res, DEFAULT_TIME_POLICY, 'rule')).toEqual({
      by: 'open',
      remaining: [0, 1, 2],
      open: ['date-order'],
    });
    expect(chooseReading(res, { dateOrder: 'DMY', year: 'ask' }, 'rule')).toEqual({
      by: 'policy',
      candidate: 1,
      policy: { dateOrder: 'DMY' },
    });
  });

  it('a date no order makes a calendar day is no candidate; one that reads the same both ways settles', () => {
    // 13/09/26: month 13 is no month; DMY and YMD (2013-09-26) remain.
    expect(
      resolve({ date: { kind: 'numeric', fields: [13, 9, 26] } }).candidates.map(
        (c) => c.reading.dateOrder,
      ),
    ).toEqual(['DMY', 'YMD']);
    // 12/12/2026 with a four-digit year: MDY and DMY are the same day — nothing to ask.
    const same = resolve({ date: { kind: 'numeric', fields: [12, 12, 2026], yearDigits: 4 } });
    expect(same.candidates).toHaveLength(2);
    expect(chooseReading(same, DEFAULT_TIME_POLICY, 'rule')).toEqual({ by: 'only', candidate: 0 });
    // A policy that removes only same-window readings decided nothing, so it
    // is not recorded as assumed: DMY keeps the DMY reading, same day.
    expect(chooseReading(same, { dateOrder: 'DMY', year: 'ask' }, 'rule')).toEqual({
      by: 'only',
      candidate: 1,
    });
    // 30 February under every order.
    const none = resolve({ date: { kind: 'fixed', year: 2026, month: 2, day: 30 } });
    expect(none.candidates).toEqual([]);
    expect(chooseReading(none, DEFAULT_TIME_POLICY, 'rule')).toEqual({
      by: 'none',
      why: 'no-candidate',
    });
  });

  it('a bare 8:40 → am and pm on the clock’s day; 20:40 → one', () => {
    const res = resolve({ wall: { h: 8, m: 40 } });
    expect(ranges(res.candidates)).toEqual([
      '2026-10-09T08:40:00-07:00/2026-10-09T08:41:00-07:00',
      '2026-10-09T20:40:00-07:00/2026-10-09T20:41:00-07:00',
    ]);
    expect(res.candidates.map((c) => c.reading.meridiem)).toEqual(['am', 'pm']);
    expect(res.candidates[0]).toMatchObject({
      grain: 'minute',
      said: ['hour', 'minute'],
      implied: ['year', 'month', 'day', 'zone'],
      anchor: 'message',
    });
    expect(chooseReading(res, DEFAULT_TIME_POLICY, 'rule')).toEqual({
      by: 'open',
      remaining: [0, 1],
      open: ['meridiem'],
    });
    const evening = resolve({ wall: { h: 20, m: 40 } });
    expect(ranges(evening.candidates)).toEqual([
      '2026-10-09T20:40:00-07:00/2026-10-09T20:41:00-07:00',
    ]);
    expect(chooseReading(evening, DEFAULT_TIME_POLICY, 'rule')).toEqual({
      by: 'only',
      candidate: 0,
    });
    // A said meridiem settles it; 12 AM is midnight; 13 PM is no time.
    expect(ranges(resolve({ wall: { h: 12, meridiem: 'am' } }).candidates)).toEqual([
      '2026-10-09T00:00:00-07:00/2026-10-09T01:00:00-07:00',
    ]);
    expect(resolve({ wall: { h: 13, meridiem: 'pm' } }).candidates).toEqual([]);
  });

  it('a wall time the clocks go back through → both instants, each noted, and the person is asked', () => {
    const res = resolve({
      date: { kind: 'fixed', year: 2026, month: 11, day: 1 },
      wall: { h: 1, m: 30, meridiem: 'am' },
    });
    expect(ranges(res.candidates)).toEqual([
      '2026-11-01T01:30:00-07:00/2026-11-01T01:31:00-07:00',
      '2026-11-01T01:30:00-08:00/2026-11-01T01:31:00-08:00',
    ]);
    expect(res.candidates.map((c) => c.notes.find((n) => n.kind === 'dst-overlap'))).toEqual([
      { kind: 'dst-overlap', which: 'earlier' },
      { kind: 'dst-overlap', which: 'later' },
    ]);
    // The policy has no DST switch: an overlap is always asked (Temporal's `reject`).
    expect(chooseReading(res, MDY, 'rule')).toEqual({
      by: 'open',
      remaining: [0, 1],
      open: ['dst'],
    });
  });

  it('a wall time the clocks skip → the two readings Temporal names, noted dst-gap', () => {
    const res = resolve({
      date: { kind: 'fixed', year: 2026, month: 3, day: 8 },
      wall: { h: 2, m: 30, meridiem: 'am' },
    });
    expect(res.candidates.map((c) => c.notes.find((n) => n.kind === 'dst-gap'))).toEqual([
      { kind: 'dst-gap', which: 'earlier' },
      { kind: 'dst-gap', which: 'later' },
    ]);
    expect(chooseReading(res, DEFAULT_TIME_POLICY, 'rule')).toMatchObject({
      by: 'open',
      open: ['dst'],
    });
  });

  it('a range runs to the END of its last grain, and the policy picks the order', () => {
    const parts: TimeParts = {
      date: { kind: 'numeric', fields: [10, 9, 26] },
      rangeOf: [{ wall: { h: 8, meridiem: 'am' } }, { wall: { h: 8, m: 40, meridiem: 'am' } }],
    };
    const res = resolve(parts);
    // The day is shared by both sides, so the sides agree on its order: three, not nine.
    expect(res.candidates).toHaveLength(3);
    const choice = chooseReading(res, MDY, 'rule');
    expect(choice).toEqual({ by: 'policy', candidate: 0, policy: { dateOrder: 'MDY' } });
    expect(res.candidates[0]).toMatchObject({
      window: {
        kind: 'range',
        range: { from: '2026-10-09T08:00:00-07:00', to: '2026-10-09T08:41:00-07:00' },
      },
      grain: 'minute',
      said: ['year', 'month', 'day', 'hour', 'minute', 'meridiem'],
    });
    expect(res.candidates[0]?.notes).toContainEqual({ kind: 'end-of-grain' });
  });

  it('a range whose end says no meridiem → one candidate per combination that runs forward', () => {
    const res = resolve({
      rangeOf: [{ wall: { h: 8, meridiem: 'am' } }, { wall: { h: 8, m: 40 } }],
    });
    expect(ranges(res.candidates)).toEqual([
      '2026-10-09T08:00:00-07:00/2026-10-09T08:41:00-07:00',
      '2026-10-09T08:00:00-07:00/2026-10-09T20:41:00-07:00',
    ]);
    expect(res.candidates.map((c) => c.reading.endMeridiem)).toEqual(['am', 'pm']);
    expect(chooseReading(res, DEFAULT_TIME_POLICY, 'rule')).toMatchObject({
      by: 'open',
      open: ['meridiem'],
    });
    // A range that runs backwards is no candidate.
    expect(
      resolve({ rangeOf: [{ wall: { h: 21 } }, { wall: { h: 8, meridiem: 'am' } }] }).candidates,
    ).toEqual([]);
  });

  it('a said zone: an IANA name is used, an offset is kept, an abbreviation is ASKED', () => {
    const ny = resolve({ wall: { h: 20, m: 0 }, zoneToken: 'America/New_York' });
    expect(ranges(ny.candidates)).toEqual(['2026-10-09T20:00:00-04:00/2026-10-09T20:01:00-04:00']);
    expect(ny.candidates[0]).toMatchObject({
      zone: 'America/New_York',
      implied: ['year', 'month', 'day'],
    });
    expect(ny.candidates[0]?.said).toContain('zone');
    const offset = resolve({
      date: { kind: 'fixed', year: 2026, month: 10, day: 9 },
      wall: { h: 20 },
      zoneToken: '-07:00',
    });
    expect(ranges(offset.candidates)).toEqual([
      '2026-10-09T20:00:00-07:00/2026-10-09T21:00:00-07:00',
    ]);
    expect(offset.candidates[0]?.notes).toContainEqual({ kind: 'offset-said', offset: '-07:00' });
    expect(offset.candidates[0]?.zone).toBe(LA);
    // The three offset spellings are said; a colon with no minutes is not one of them.
    for (const token of ['-07', '-0700', '-07:00']) {
      expect(
        resolve({
          date: { kind: 'fixed', year: 2026, month: 10, day: 9 },
          wall: { h: 20 },
          zoneToken: token,
        }).candidates[0]?.notes,
      ).toContainEqual({ kind: 'offset-said', offset: '-07:00' });
    }
    expect(resolve({ wall: { h: 20 }, zoneToken: '-07:' })).toEqual({
      candidates: [],
      needsZone: true,
      unsupported: [],
    });
    // PST: no abbreviation map ships in v1 — never guessed to a zone.
    const pst = resolve({ wall: { h: 20 }, zoneToken: 'PST' });
    expect(pst).toEqual({ candidates: [], needsZone: true, unsupported: [] });
    expect(chooseReading(pst, DEFAULT_TIME_POLICY, 'rule')).toEqual({
      by: 'open',
      remaining: [],
      open: ['zone'],
    });
  });

  it('a range whose zone is said on one side reads both sides in it', () => {
    const res = resolve({
      date: { kind: 'fixed', year: 2026, month: 10, day: 9 },
      rangeOf: [{ wall: { h: 20 } }, { wall: { h: 21, m: 0 }, zoneToken: 'UTC' }],
    });
    expect(ranges(res.candidates)).toEqual(['2026-10-09T20:00:00Z/2026-10-09T21:01:00Z']);
  });

  it('yesterday → the calendar day before the clock’s, in the clock zone, anchored on the message', () => {
    const res = resolve({ relative: { unit: 'day', offset: -1 } });
    expect(res.candidates).toHaveLength(1);
    expect(res.candidates[0]).toMatchObject({
      range: { from: '2026-10-08T00:00:00-07:00', to: '2026-10-09T00:00:00-07:00' },
      anchor: 'message',
      said: ['day'],
      implied: ['year', 'month', 'zone'],
    });
    // In Tokyo the clock's moment is already 10 October.
    const tokyo = resolve(
      { relative: { unit: 'day', offset: 0 } },
      { now: CLOCK.now, zone: 'Asia/Tokyo' },
    );
    expect(tokyo.candidates[0]?.range).toEqual({
      from: '2026-10-10T00:00:00+09:00',
      to: '2026-10-11T00:00:00+09:00',
    });
  });

  it('last 40 minutes → a look-back until the clock’s now', () => {
    const res = resolve({ relative: { unit: 'minute', count: 40 } });
    expect(res.candidates[0]).toMatchObject({
      window: { kind: 'lookback', duration: '40m' },
      range: { from: '2026-10-09T15:00:00Z', to: '2026-10-09T15:40:00.001Z' },
      grain: 'minute',
      said: ['duration'],
      anchor: 'message',
    });
    expect(chooseReading(res, DEFAULT_TIME_POLICY, 'rule')).toEqual({ by: 'only', candidate: 0 });
  });

  it('a date with no year → the clock’s and the one before; year: current assumes, recorded', () => {
    const res = resolve({ date: { kind: 'fixed', month: 1, day: 2 } });
    expect(res.candidates.map((c) => c.reading.year)).toEqual(['current', 'previous']);
    expect(res.candidates[0]?.implied).toContain('year');
    expect(chooseReading(res, DEFAULT_TIME_POLICY, 'rule')).toEqual({
      by: 'open',
      remaining: [0, 1],
      open: ['year'],
    });
    expect(chooseReading(res, { dateOrder: 'ask', year: 'current' }, 'rule')).toEqual({
      by: 'policy',
      candidate: 0,
      policy: { year: 'current' },
    });
  });

  it('parts v1 does not resolve are named, never guessed', () => {
    for (const parts of [
      { partOfDay: 'morning' },
      { relative: { unit: 'week' as const, offset: -1 } },
      { anchor: 'previous' as const, wall: { h: 8 } },
      { zoneToken: 'UTC' },
    ]) {
      const res = resolve(parts);
      expect(res.candidates).toEqual([]);
      expect(res.unsupported.length).toBe(1);
      expect(chooseReading(res, DEFAULT_TIME_POLICY, 'rule')).toEqual({
        by: 'none',
        why: 'unsupported',
      });
    }
    expect(chooseReading(resolve([]), DEFAULT_TIME_POLICY, 'rule', 'unreadable')).toEqual({
      by: 'none',
      why: 'unreadable',
    });
  });

  it('a policy that removes every reading says so', () => {
    // 13/09/2026 under MDY: month 13.
    const res = resolve({ date: { kind: 'numeric', fields: [13, 9, 2026], yearDigits: 4 } });
    expect(chooseReading(res, MDY, 'rule')).toEqual({ by: 'none', why: 'excluded-by-policy' });
  });

  it('two parses of one mention are both kept, and the split is asked', () => {
    const res = resolve([{ wall: { h: 20 } }, { relative: { unit: 'day', offset: 0 } }]);
    expect(res.candidates.map((c) => c.parse)).toEqual([0, 1]);
    expect(chooseReading(res, DEFAULT_TIME_POLICY, 'rule')).toMatchObject({
      by: 'open',
      open: ['parse'],
    });
  });
});

describe('the model-reading rule (§ 5.5)', () => {
  it('a model reader’s candidates are never said, and even one window waits for the person', () => {
    const res = resolve({ wall: { h: 20, m: 40 } }, CLOCK, MODEL);
    expect(res.candidates[0]).toMatchObject({ said: [], reader: MODEL });
    expect(chooseReading(res, DEFAULT_TIME_POLICY, 'model')).toEqual({
      by: 'open',
      remaining: [0],
      open: ['confirm'],
    });
    const two = resolve({ wall: { h: 8, m: 40 } }, CLOCK, MODEL);
    expect(chooseReading(two, DEFAULT_TIME_POLICY, 'model')).toEqual({
      by: 'open',
      remaining: [0, 1],
      open: ['meridiem', 'confirm'],
    });
  });
});

describe('readPolicy', () => {
  it('fills the v1 defaults and refuses anything else by name', () => {
    expect(readPolicy(undefined)).toEqual({ dateOrder: 'ask', year: 'ask' });
    expect(readPolicy({ dateOrder: 'DMY' })).toEqual({ dateOrder: 'DMY', year: 'ask' });
    expect(readPolicy({ year: 'previous' })).toMatch(/policy\.year/);
    expect(readPolicy({ dateOrder: 'mdy' })).toMatch(/policy\.dateOrder/);
    expect(readPolicy({ dst: 'earlier' })).toMatch(/unknown key 'dst'/);
    expect(readPolicy([])).toMatch(/object/);
  });
});

// ─── The port's checks ───────────────────────────────────────────────────

const fixture = (over: Record<string, unknown> = {}) => ({
  id: 'fixture',
  version: '1.0.0',
  locale: 'en-US',
  kind: 'rule',
  read: () => ({ mentions: [] }),
  ...over,
});

describe('readerIssue / checkReading — shape, never meaning', () => {
  it('a reader names its id, version, locale, kind and read', () => {
    expect(readerIssue(fixture())).toBeUndefined();
    expect(readerIssue(fixture({ id: '' }))).toMatch(/reader\.id/);
    expect(readerIssue(fixture({ version: 3 }))).toMatch(/reader\.version/);
    expect(readerIssue(fixture({ locale: undefined }))).toMatch(/reader\.locale/);
    expect(readerIssue(fixture({ kind: 'llm' }))).toMatch(/reader\.kind/);
    expect(readerIssue(fixture({ read: 'yes' }))).toMatch(/reader\.read/);
    expect(readerIssue(null)).toMatch(/TimeReader/);
  });

  it('an out-of-text quote is refused and keeps no text; a verbatim one passes', () => {
    const text = 'errors 10/09/26 8 AM to 8:40 AM PST';
    const parts = { date: { kind: 'numeric', fields: [10, 9, 26] } };
    expect(
      checkReading(
        text,
        {
          mentions: [
            { quote: '10/09/26', parses: [parts] },
            { quote: '10/09/2026', parses: [parts] },
            { quote: '', parses: [parts] },
          ],
        },
        'fixture',
      ),
    ).toEqual([
      { quote: '10/09/26', parses: [parts] },
      { refused: 'quote-not-in-text' },
      { refused: 'quote-not-in-text' },
    ]);
  });

  it('malformed parts are refused; unreadable carries no parses', () => {
    const bad: unknown[] = [
      { quote: 'x', parses: [] },
      { quote: 'x', parses: [{}] },
      { quote: 'x', parses: [{ wall: { h: 24 } }] },
      { quote: 'x', parses: [{ wall: { h: 8, s: 5 } }] },
      { quote: 'x', parses: [{ date: { kind: 'numeric', fields: [1] } }] },
      { quote: 'x', parses: [{ date: { kind: 'fixed', month: 13, day: 1 } }] },
      { quote: 'x', parses: [{ relative: { unit: 'fortnight', offset: 1 } }] },
      { quote: 'x', parses: [{ relative: { unit: 'day', count: 0 } }] },
      { quote: 'x', parses: [{ rangeOf: [{ wall: { h: 1 } }] }] },
      { quote: 'x', parses: [{ rangeOf: [{ rangeOf: [{}, {}] }, { wall: { h: 1 } }] }] },
      { quote: 'x', parses: [{ wall: { h: 8 }, extra: true }] },
      { quote: 'x', parses: [{ wall: { h: 8 } }], problem: 'unreadable' },
      { quote: 'x', parses: [], problem: 'vague' },
      { quote: 'x', parses: Array(5).fill({ wall: { h: 8 } }) },
      'x',
    ];
    for (const m of bad) {
      expect(checkReading('x', { mentions: [m] }, 'fixture')).toEqual([{ refused: 'malformed' }]);
    }
    expect(
      checkReading('x', { mentions: [{ quote: 'x', parses: [], problem: 'unreadable' }] }, 'f'),
    ).toEqual([{ quote: 'x', parses: [], problem: 'unreadable' }]);
  });

  it('a reading that is not { mentions: [] } throws, naming the reader', () => {
    expect(() => checkReading('x', undefined, 'my-reader')).toThrow(/'my-reader'.*no reading/);
    expect(() => checkReading('x', { mentions: Array(17).fill({}) }, 'my-reader')).toThrow(
      /too many mentions/,
    );
  });

  it('security: hostile parts are refused as malformed, never thrown on', () => {
    const hostile: unknown[] = [
      JSON.parse('{"__proto__": {"polluted": true}, "wall": {"h": 8}}'),
      { wall: { h: 1e308 } },
      { zoneToken: 'x'.repeat(1_000_000) },
      { partOfDay: '' },
      { relative: { unit: 'day', offset: 1e9 } },
      { date: { kind: 'numeric', fields: [-1, 2, 3] } },
      Object.create({ wall: { h: 8 } }),
    ];
    for (const parts of hostile) {
      expect(checkReading('q', { mentions: [{ quote: 'q', parses: [parts] }] }, 'f')).toEqual([
        { refused: 'malformed' },
      ]);
    }
    expect(({} as Record<string, unknown>).polluted).toBeUndefined();
  });

  it('the resolver refuses a clock that is not one', () => {
    expect(() =>
      resolveMention([{ wall: { h: 8 } }], { now: '2026-10-09 15:40', zone: LA }, RULE),
    ).toThrow(/strict instant/);
    expect(() =>
      resolveMention([{ wall: { h: 8 } }], { now: CLOCK.now, zone: 'PST' }, RULE),
    ).toThrow(/IANA zone name/);
  });
});

// ─── The row ─────────────────────────────────────────────────────────────

const STAMP = { id: 'fixture', version: '1.0.0', kind: 'rule' as const, locale: 'en-US' };
const clockFor = {
  now: CLOCK.now,
  nowSource: 'app' as const,
  zone: LA,
  zoneSource: 'run' as const,
};

describe('timeReadingRows + the checkpoint door', () => {
  const rows = timeReadingRows({
    mentions: [
      { quote: '10/09/26', parses: [{ date: { kind: 'numeric', fields: [10, 9, 26] } }] },
      { refused: 'quote-not-in-text' },
      { quote: 'soonish', parses: [], problem: 'unreadable' },
    ],
    clock: clockFor,
    policy: DEFAULT_TIME_POLICY,
    reader: STAMP,
    tzdata: '2025b',
    at: { turn: 1, iteration: 1 },
  });

  it('one row per mention, the refused one keeping only why', () => {
    expect(rows).toHaveLength(3);
    expect(rows[0]).toMatchObject({
      kind: 'time-reading',
      turn: 1,
      iteration: 1,
      reader: STAMP,
      tzdata: '2025b',
      mentions: 3,
      mention: 0,
      quote: '10/09/26',
      choice: { by: 'open', remaining: [0, 1, 2], open: ['date-order'] },
    });
    expect(rows[1]).toEqual({
      kind: 'time-reading',
      turn: 1,
      iteration: 1,
      reader: STAMP,
      tzdata: '2025b',
      mentions: 3,
      mention: 1,
      refused: 'quote-not-in-text',
    });
    expect(rows[2]).toMatchObject({
      problem: 'unreadable',
      candidates: [],
      choice: { by: 'none' },
    });
    for (const row of rows) expect(timeRowIsWellFormed(row as never)).toBe(true);
  });

  it('a reading with no mention files ONE row saying so', () => {
    const none = timeReadingRows({
      mentions: [],
      clock: clockFor,
      policy: DEFAULT_TIME_POLICY,
      reader: STAMP,
      tzdata: 'unknown',
      at: { turn: 2, iteration: 1 },
    });
    expect(none).toEqual([
      {
        kind: 'time-reading',
        turn: 2,
        iteration: 1,
        reader: STAMP,
        tzdata: 'unknown',
        mentions: 0,
      },
    ]);
    expect(timeRowIsWellFormed(none[0] as never)).toBe(true);
  });

  it('the door refuses each field broken', () => {
    const good = rows[0] as unknown as Record<string, unknown>;
    const broken: Record<string, unknown>[] = [
      { ...good, reader: { ...STAMP, kind: 'llm' } },
      { ...good, reader: { ...STAMP, extra: 1 } },
      { ...good, tzdata: '' },
      { ...good, mentions: -1 },
      { ...good, mention: 3 },
      { ...good, quote: '' },
      { ...good, parses: [{ wall: { h: 99 } }] },
      { ...good, candidates: [{ ...(good.candidates as object[])[0], zone: 'PST' }] },
      { ...good, choice: { by: 'only', candidate: 7 } },
      { ...good, choice: { by: 'open', remaining: [0], open: [] } },
      { ...good, choice: { by: 'policy', candidate: 0, policy: { dateOrder: 'mdy' } } },
      { ...good, refused: 'malformed' },
      { ...(rows[1] as unknown as Record<string, unknown>), quote: 'smuggled' },
      {
        kind: 'time-reading',
        turn: 1,
        iteration: 1,
        reader: STAMP,
        tzdata: 'x',
        mentions: 0,
        quote: 'q',
      },
    ];
    for (const row of broken) expect(timeRowIsWellFormed(row)).toBe(false);
  });
});

// ─── Property ────────────────────────────────────────────────────────────

describe('tzdataVersion — the runtime\u2019s own zone data, never a constant', () => {
  it('on Node it is process.versions.tz', () => {
    expect(process.versions.tz).toEqual(expect.any(String));
    expect(tzdataVersion()).toBe(process.versions.tz);
  });
});

describe('property — a fixed date and a 24-hour time resolve to their own wall time', () => {
  it('2 000 cases in five zones', () => {
    const r = prng(606);
    const zones = [LA, 'UTC', 'Asia/Kolkata', 'Europe/London', 'Australia/Lord_Howe'];
    for (let i = 0; i < 2000; i += 1) {
      const zone = pick(r, zones);
      const year = int(r, 1990, 2040);
      const month = int(r, 1, 12);
      const day = int(r, 1, 28);
      const h = pick(r, [0, 13, 14, 15, 16, 17, 18, 19, 20, 21, 22, 23]);
      const m = int(r, 0, 59);
      const res = resolveMention(
        [{ date: { kind: 'fixed', year, month, day }, wall: { h, m } }],
        { now: CLOCK.now, zone },
        RULE,
      );
      expect(res.candidates.length).toBeGreaterThanOrEqual(1);
      expect(res.candidates.length).toBeLessThanOrEqual(2);
      for (const c of res.candidates) {
        const from = Date.parse(c.range.from);
        expect(Date.parse(c.range.to) - from).toBe(60_000);
        const shown = wallAt(zone, from);
        const inGap = c.notes.some((n) => n.kind === 'dst-gap');
        if (!inGap) {
          expect([shown.year, shown.month, shown.day, shown.hour, shown.minute]).toEqual([
            year,
            month,
            day,
            h,
            m,
          ]);
        }
      }
    }
  });
});

// ─── Performance ─────────────────────────────────────────────────────────

describe('performance', () => {
  // Counted, not timed: a wall-clock budget measures the CI machine. `Intl` is
  // the whole cost of a resolution (core/time/zone.ts · "Cost"), so the budget
  // is how often it is asked. One cold resolution of this range asks 65 times;
  // before the zone memo and `readWall`'s fast path, EVERY resolution asked 90
  // times (450 000 readings for this loop — 1.4 s locally, 5–7 s on CI).
  it('5 000 resolutions of a range with every ambiguity build one formatter and read each instant once', () => {
    const parts: TimeParts = {
      date: { kind: 'numeric', fields: [10, 9] },
      rangeOf: [{ wall: { h: 8 } }, { wall: { h: 9, m: 40 } }],
    };
    const Real = Intl.DateTimeFormat;
    let built = 0;
    class Counting extends Real {
      constructor(...args: ConstructorParameters<typeof Real>) {
        super(...args);
        built += 1;
      }
    }
    const spy = vi.spyOn(Real.prototype, 'formatToParts');
    let reads = 0;
    (Intl as { DateTimeFormat: typeof Real }).DateTimeFormat = Counting as typeof Real;
    try {
      for (let i = 0; i < 5000; i += 1) {
        chooseReading(resolveMention([parts], CLOCK, RULE), DEFAULT_TIME_POLICY, 'rule');
      }
    } finally {
      (Intl as { DateTimeFormat: typeof Real }).DateTimeFormat = Real;
      reads = spy.mock.calls.length;
      spy.mockRestore();
    }
    expect(built).toBeLessThanOrEqual(1);
    expect(reads).toBeLessThanOrEqual(90);
  });
});
