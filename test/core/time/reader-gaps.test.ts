/**
 * The English reader's gaps an app's field phrasings found (time follow-ups,
 * packet "gaps"): a day word before `between` split the range in two, compact
 * look-backs (`last 24h`, `past 6h`) read no mention at all, and a date with a
 * NAMED month (`11 September`, `Sept 29`) read "unreadable".
 *
 * Law: the reader tokenizes a small closed set — and a phrase it does read is
 * ONE mention whose parts say exactly what was written (a named month fixes
 * the order; the year, when not written, is the policy's or the person's, as
 * for `10/9`). Every reading stays a proposal the person confirms.
 *
 * Test types:
 *   functional  — each field phrasing → one mention and its parts, then the window `resolve.ts`
 *                 makes of them at the clock;
 *   boundary    — a month named alone (`in September`) stays unreadable; `may` in lower case is
 *                 the verb, never May; a compact unit the reader does not read (`30s`, `3mo`) and
 *                 a compact look-ahead (`next 2h`) are ONE unreadable mention, never none;
 *   property    — every new phrase × a sentence frame: the quote is a verbatim substring and the
 *                 port's checks accept it.
 */

import { describe, expect, it } from 'vitest';

import { englishTimeReader } from '../../../src/index.js';
import { checkReading, type TimeParts } from '../../../src/core/time/reader.js';
import {
  chooseReading,
  DEFAULT_TIME_POLICY,
  resolveMention,
} from '../../../src/core/time/resolve.js';

const reader = englishTimeReader();
const read = (text: string) =>
  reader.read(text, { locale: 'en-US' }) as {
    mentions: { quote: string; parses: TimeParts[]; problem?: 'unreadable' }[];
  };

const LA = 'America/Los_Angeles';
const CLOCK = { now: '2026-10-09T16:00:00Z', zone: LA }; // Fri 9 Oct 2026, 09:00 PDT
const RULE = { id: 'agentfootprint/english', kind: 'rule' as const };

/** The windows a mention's parts resolve to, `from/to`, under the default policy. */
function windowsOf(text: string): string[] {
  const [m] = read(text).mentions;
  const res = resolveMention(m!.parses, CLOCK, RULE);
  return res.candidates.map((c) => `${c.range.from}/${c.range.to}`);
}

describe('G4 — a day word before `between` is one range, not two mentions', () => {
  it('“today between 1 pm and 2 pm” → one mention, today 13:00–14:00', () => {
    expect(read('show errors today between 1 pm and 2 pm').mentions).toEqual([
      {
        quote: 'today between 1 pm and 2 pm',
        parses: [
          {
            relative: { unit: 'day', offset: 0 },
            rangeOf: [{ wall: { h: 1, meridiem: 'pm' } }, { wall: { h: 2, meridiem: 'pm' } }],
          },
        ],
      },
    ]);
    expect(windowsOf('today between 1 pm and 2 pm')).toEqual([
      '2026-10-09T13:00:00-07:00/2026-10-09T14:00:00-07:00',
    ]);
  });

  it('“yesterday between 8 and 9 AM” → one mention, yesterday 08:00–09:00 (the bare 8 takes AM)', () => {
    const [m] = read('who connected yesterday between 8 and 9 AM?').mentions;
    expect(m).toMatchObject({ quote: 'yesterday between 8 and 9 AM' });
    expect(m!.problem).toBeUndefined();
    expect(windowsOf('yesterday between 8 and 9 AM')).toEqual([
      '2026-10-08T08:00:00-07:00/2026-10-08T09:00:00-07:00',
    ]);
  });

  it('a date before `between` too: “10/09 between 8 AM and 9 AM” is one range', () => {
    expect(read('10/09 between 8 AM and 9 AM').mentions).toHaveLength(1);
  });
});

describe('G5 — compact look-backs read', () => {
  for (const [text, quote, count, unit] of [
    ['errors in the last 24h', 'last 24h', 24, 'hour'],
    ['anything for the past 6h?', 'past 6h', 6, 'hour'],
    ['past 6 hours', 'past 6 hours', 6, 'hour'],
    ['last 30m please', 'last 30m', 30, 'minute'],
    ['last 2d', 'last 2d', 2, 'day'],
    ['past 1w', 'past 1w', 1, 'week'],
    ['last 3 hrs', 'last 3 hrs', 3, 'hour'],
  ] as const) {
    it(`“${text}” → a look-back of ${count} ${unit}`, () => {
      expect(read(text).mentions).toEqual([{ quote, parses: [{ relative: { unit, count } }] }]);
    });
  }

  it('“last 24h” resolves to the look-back [now − 24h, now]', () => {
    expect(windowsOf('last 24h')).toEqual(['2026-10-08T16:00:00Z/2026-10-09T16:00:00.001Z']);
  });

  for (const [text, quote] of [
    ['next 2h', 'next 2h'],
    ['last 30s', 'last 30s'],
    ['past 3mo', 'past 3mo'],
    ['last 3 months', 'last 3 months'],
  ] as const) {
    it(`“${text}” → ONE unreadable mention, never none`, () => {
      expect(read(text).mentions).toEqual([{ quote, parses: [], problem: 'unreadable' }]);
    });
  }
});

describe('G3 — a date with a named month', () => {
  for (const [text, quote, date] of [
    ['on 11 September', '11 September', { kind: 'fixed', month: 9, day: 11 }],
    ['Sept 29', 'Sept 29', { kind: 'fixed', month: 9, day: 29 }],
    ['September 29', 'September 29', { kind: 'fixed', month: 9, day: 29 }],
    ['Sep. 29, 2026', 'Sep. 29, 2026', { kind: 'fixed', month: 9, day: 29, year: 2026 }],
    ['29 September 2025', '29 September 2025', { kind: 'fixed', month: 9, day: 29, year: 2025 }],
    ['on the 29th of September', '29th of September', { kind: 'fixed', month: 9, day: 29 }],
    ['May 3', 'May 3', { kind: 'fixed', month: 5, day: 3 }],
    ['oct 9', 'oct 9', { kind: 'fixed', month: 10, day: 9 }],
  ] as const) {
    it(`“${text}” → ${JSON.stringify(date)}`, () => {
      expect(read(text).mentions).toEqual([{ quote, parses: [{ date }] }]);
    });
  }

  it('the year is the policy’s: `year: ask` offers this year and the last; `current` keeps this year', () => {
    const [m] = read('Sept 29').mentions;
    const res = resolveMention(m!.parses, CLOCK, RULE);
    expect(res.candidates.map((c) => c.range.from)).toEqual([
      '2026-09-29T00:00:00-07:00',
      '2025-09-29T00:00:00-07:00',
    ]);
    expect(chooseReading(res, { ...DEFAULT_TIME_POLICY, year: 'current' }, 'rule')).toEqual({
      by: 'policy',
      candidate: 0,
      policy: { year: 'current' },
    });
  });

  it('the field sentence: “between 14:15 and 14:40 on 11 September” → one range on 11 Sep', () => {
    const field = 'what does it show for SMB on 10.1.2.3 between 14:15 and 14:40 on 11 September';
    const [m] = read(field).mentions;
    expect(m).toMatchObject({ quote: '14:15 and 14:40 on 11 September' });
    expect(m!.problem).toBeUndefined();
    expect(windowsOf(field)).toEqual([
      '2026-09-11T14:15:00-07:00/2026-09-11T14:41:00-07:00',
      '2025-09-11T14:15:00-07:00/2025-09-11T14:41:00-07:00',
    ]);
  });

  it('boundary: a month alone is unreadable; lower-case `may` is the verb; day 32 is no date', () => {
    expect(read('anything in September?').mentions).toEqual([
      { quote: 'September', parses: [], problem: 'unreadable' },
    ]);
    expect(read('it may 3 times fail').mentions).toEqual([]);
    expect(
      read('Sept 32').mentions.every((m) => m.problem === 'unreadable' || m.parses.length > 0),
    ).toBe(true);
    expect(
      read('Sept 32').mentions.some((m) => m.parses.some((p) => p.date?.kind === 'fixed')),
    ).toBe(false);
  });

  it('property: every new phrase in a frame is quoted verbatim and passes the port’s checks', () => {
    const phrases = [
      'today between 1 pm and 2 pm', 'yesterday between 8 and 9 AM', 'last 24h', 'past 6h',
      '11 September', 'Sept 29', 'September 29, 2026', '14:15 and 14:40 on 11 September',
    ]; // prettier-ignore
    const frames = ['%', 'show me % please', 'what happened %?', '(%)', 'errors, %, and more'];
    for (const p of phrases) {
      for (const f of frames) {
        const text = f.replace('%', p);
        const out = read(text);
        for (const m of out.mentions) expect(text.includes(m.quote)).toBe(true);
        const checked = checkReading(text, out, reader.id);
        expect(checked.every((c) => !('refused' in c) || c.refused === undefined)).toBe(true);
        expect(read(text)).toEqual(out);
      }
    }
  });
});
