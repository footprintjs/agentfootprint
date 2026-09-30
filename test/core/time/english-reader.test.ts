/**
 * The careful English reader (time design § 5.3, step T6b) — a tokenizer over
 * the v1 phrases, "unreadable" for every other time phrase it recognises. The
 * field sentences are the table; what `resolve.ts`, the policy and the ask
 * make of the parts is asserted beside them.
 *
 * Law: the reader TOKENIZES — parts and a verbatim quote, never an instant, a
 * date order, a zone mapping or a refusal of the future; a phrase v1 does not
 * read is one `unreadable` mention quoting the whole phrase, never a partial
 * reading.
 *
 * Test types:
 *   functional  — every v1 row of § 5.3 → its parts; every non-v1 row → "unreadable"; the field
 *                 sentences end to end through resolve, choose and the ask ("10/09/26 8 AM to
 *                 8:40 AM PST" → a zone ask for `PST`, then three date orders, `MDY` → PDT;
 *                 "yesterday"; a future date refused by a `past` tool's facts);
 *   clause rule — every spelling a recheck found, and a generated matrix (v1 phrase × separator ×
 *                 opener × time-like tail, reversed, `between`, seeded fillers): read whole or not at all;
 *   boundary    — impossible clock times and dates are not read (or resolve to nothing), a
 *                 bare hour is a time only as a range's first side, a modifier taints, 16
 *                 mentions at most;
 *   property    — over 2,000 seeded texts: every quote is a verbatim substring, the port's
 *                 checks accept every reading, the same text always reads the same;
 *   security    — the leaf law holds for `readers/` (it imports only the port); hostile input
 *                 (long digit/slash runs, unicode) never throws and never quotes text it did not see;
 *   performance — a 100 000-character message reads inside a budget;
 *   integration, byte identity — english-run.test.ts.
 */

import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

import { englishTimeReader } from '../../../src/index.js';
import { checkReading, MAX_MENTIONS, type TimeParts } from '../../../src/core/time/reader.js';
import {
  chooseReading,
  DEFAULT_TIME_POLICY,
  resolveMention,
  withZoneAnswered,
} from '../../../src/core/time/resolve.js';
import { timeAskOf } from '../../../src/core/time/ask.js';
import { timeReadingRows } from '../../../src/core/time/rows.js';
import { periodFactProblem } from '../../../src/core/time/convert.js';
import { defaultTimeAskMessages } from '../../../src/locales/timeAsk.js';
import { int, pick, prng } from './fixtures/generate.js';

const reader = englishTimeReader();
const read = (text: string) =>
  reader.read(text, { locale: 'en-US' }) as ReturnType<typeof reader.read> & {
    mentions: { quote: string; parses: TimeParts[]; problem?: 'unreadable' }[];
  };

const LA = 'America/Los_Angeles';
const CLOCK = { now: '2026-10-09T15:40:00Z', zone: LA };
const RULE = { id: 'agentfootprint/english', kind: 'rule' as const };

// ─── functional: the v1 rows ─────────────────────────────────────────

describe('the v1 rows of § 5.3 — the parts, never an instant', () => {
  const table: readonly [string, string, TimeParts][] = [
    [
      'ISO date',
      'errors on 2026-10-09',
      { date: { kind: 'fixed', year: 2026, month: 10, day: 9 } },
    ],
    [
      'ISO instant with its offset',
      'at 2026-10-09T08:00-07:00',
      {
        date: { kind: 'fixed', year: 2026, month: 10, day: 9 },
        wall: { h: 8, m: 0 },
        zoneToken: '-07:00',
      },
    ],
    [
      'numeric date',
      'on 10/09/26',
      { date: { kind: 'numeric', fields: [10, 9, 26], yearDigits: 2 } },
    ],
    ['numeric date, no year', 'on 10/9', { date: { kind: 'numeric', fields: [10, 9] } }],
    ['a clock time with a meridiem', 'at 8 AM', { wall: { h: 8, meridiem: 'am' } }],
    ['a clock time, no meridiem', 'at 8:40', { wall: { h: 8, m: 40 } }],
    ['a 24-hour clock time', 'at 20:40', { wall: { h: 20, m: 40 } }],
    ['a dotted meridiem', 'at 8:40 p.m.', { wall: { h: 8, m: 40, meridiem: 'pm' } }],
    [
      'a range of two clock times',
      'from 8 AM to 8:40 AM',
      { rangeOf: [{ wall: { h: 8, meridiem: 'am' } }, { wall: { h: 8, m: 40, meridiem: 'am' } }] },
    ],
    [
      'a range with an en dash',
      '08:00–08:40',
      { rangeOf: [{ wall: { h: 8, m: 0 } }, { wall: { h: 8, m: 40 } }] },
    ],
    [
      'a bare first side',
      'between 8 and 9 AM',
      { rangeOf: [{ wall: { h: 8 } }, { wall: { h: 9, meridiem: 'am' } }] },
    ],
    ['an IANA zone', '8 AM America/Los_Angeles', { wall: { h: 8, meridiem: 'am' }, zoneToken: LA }],
    ['a UTC offset', '20:40 UTC-07:00', { wall: { h: 20, m: 40 }, zoneToken: '-07:00' }],
    [
      'an abbreviation, as written',
      '8 AM PST',
      { wall: { h: 8, meridiem: 'am' }, zoneToken: 'PST' },
    ],
    ['today', 'errors today?', { relative: { unit: 'day', offset: 0 } }],
    ['yesterday', 'errors yesterday?', { relative: { unit: 'day', offset: -1 } }],
    ['tomorrow', 'on call tomorrow?', { relative: { unit: 'day', offset: 1 } }],
    ['a look-back', 'in the last 40 minutes', { relative: { unit: 'minute', count: 40 } }],
    ['a look-back, past', 'past 2 hours', { relative: { unit: 'hour', count: 2 } }],
    [
      'a day word and a range',
      'today 8 AM to 9 AM',
      {
        relative: { unit: 'day', offset: 0 },
        rangeOf: [{ wall: { h: 8, meridiem: 'am' } }, { wall: { h: 9, meridiem: 'am' } }],
      },
    ],
    [
      'an ISO interval',
      '2026-10-09T08:00Z/2026-10-09T09:00Z',
      {
        rangeOf: [
          {
            date: { kind: 'fixed', year: 2026, month: 10, day: 9 },
            wall: { h: 8, m: 0 },
            zoneToken: 'Z',
          },
          {
            date: { kind: 'fixed', year: 2026, month: 10, day: 9 },
            wall: { h: 9, m: 0 },
            zoneToken: 'Z',
          },
        ],
      },
    ],
  ];
  for (const [name, text, parts] of table) {
    it(`${name}: “${text}”`, () => {
      const mentions = read(text).mentions;
      expect(mentions).toHaveLength(1);
      expect(mentions[0]!.problem).toBeUndefined();
      expect(mentions[0]!.parses).toEqual([parts]);
      expect(text.includes(mentions[0]!.quote)).toBe(true);
    });
  }

  it('a text with no time words reads no mention', () => {
    expect(read('port 8080 on host 10.0.0.1, 3 servers').mentions).toEqual([]);
  });

  it('two phrases in two clauses are two mentions, in order', () => {
    expect(read('last 2 hours. Then yesterday').mentions.map((m) => m.quote)).toEqual([
      'last 2 hours',
      'yesterday',
    ]);
  });
});

// ─── functional: the non-v1 rows ─────────────────────────────────────

describe('every non-v1 phrase reads "unreadable" — the whole phrase, never a part', () => {
  const table: readonly [string, string][] = [
    ['what failed yesterday morning?', 'yesterday morning'], // parts of a day
    ['errors this afternoon', 'this afternoon'],
    ['in the evening', 'evening'],
    ['anything tonight?', 'tonight'], // night words
    ['the overnight batch', 'overnight'],
    ['errors last week', 'last week'], // calendar spans
    ['this month so far', 'this month'],
    ['last 3 months', 'last 3 months'],
    ['last two hours', 'last two hours'], // a span in words
    ['next 2 hours', 'next 2 hours'], // a look-ahead
    ['3 hours ago', '3 hours ago'],
    ['on Friday', 'Friday'],
    ['Oct 9 2026', 'Oct 9 2026'],
    ['9 October', '9 October'],
    ['the day before yesterday', 'the day before yesterday'],
    ['since 8 AM', 'since 8 AM'], // a modifier changes a v1 phrase
    ['around 8:40', 'around 8:40'],
    ['earlier today', 'earlier today'],
    ['from 8 AM to now', 'from 8 AM to now'],
    ['at noon', 'noon'],
    ["at 8 o'clock", "8 o'clock"],
    // A range whose other side is no v1 time — the v1 side alone would narrow the window.
    ['8:40 AM till 9', '8:40 AM till 9'],
    ['yesterday 8:40 PM to 9', 'yesterday 8:40 PM to 9'],
    ['8 to 9:30', '8 to 9:30'],
    ['between 8 and 9:30', 'between 8 and 9:30'],
    ['between 8:30 and 9', 'between 8:30 and 9'],
    ['8-9:30', '8-9:30'],
    ['14:00 to 16', '14:00 to 16'],
    ['8 and 9 AM', '8 and 9 AM'],
    ['10/9-12', '10/9-12'],
    // …whatever the far side's spelling: dotted, 4-digit, run together, a unit, words.
    ['8:40 AM till 9.30', '8:40 AM till 9.30'],
    ['8:40 till 9.30', '8:40 till 9.30'],
    ['14:00 to 1600', '14:00 to 1600'],
    ['14:00-1600', '14:00-1600'],
    ['8:40 AM to 930', '8:40 AM to 930'],
    ['8:40 AM until 9h', '8:40 AM until 9h'],
    ['8:40 AM till nine', '8:40 AM till nine'],
    ['8:40 AM to about 9 AM', '8:40 AM to about 9 AM'],
    ['1600 to 17:00', '1600 to 17:00'],
    ['nine till 8:40 AM', 'nine till 8:40 AM'],
    ['8:30 and 9 yesterday', '8:30 and 9 yesterday'], // `and` + a time word after: a range
    // A clause with a second time-like token is ONE unreadable mention quoting the clause.
    [
      'yesterday 8:40 PM till 9.30 for checkout. Thanks',
      'yesterday 8:40 PM till 9.30 for checkout',
    ],
    ['(8:40 AM till 9.30) please', '(8:40 AM till 9.30) please'],
    // More modifiers that change a v1 phrase.
    ['from 3 PM yesterday', 'from 3 PM yesterday'], // `from` with no `to`: a start, not an hour
    ['past 8 PM', 'past 8 PM'],
    ['prior to 8 AM', 'prior to 8 AM'],
    ['up to 8 AM', 'up to 8 AM'],
    ['no later than 8 AM', 'no later than 8 AM'],
    ['starting 8 AM', 'starting 8 AM'],
    ['8 AM-ish', '8 AM-ish'],
    // A meridiem the number contradicts — never the time with the meridiem dropped.
    ['at 13:00 PM', '13:00 PM'],
    ['at 13 PM', '13 PM'],
  ];
  for (const [text, quote] of table) {
    it(`“${text}” → unreadable “${quote}”`, () => {
      expect(read(text).mentions).toEqual([{ quote, parses: [], problem: 'unreadable' }]);
    });
  }

  it('an unreadable mention resolves to no window — `none / unreadable`', () => {
    const [m] = read('what failed yesterday morning?').mentions;
    const res = resolveMention(m!.parses, CLOCK, RULE);
    expect(chooseReading(res, DEFAULT_TIME_POLICY, 'rule', m!.problem)).toEqual({
      by: 'none',
      why: 'unreadable',
    });
  });
});

// ─── the clause rule: read whole or not at all ───────────────────────

describe('the clause rule — a clause with a second time-like token is read whole or not at all', () => {
  // Every spelling a recheck found leaking a partial reading through a list of connectors.
  const CITED = [
    // `between` with a day or a date on the near side
    'between yesterday and 1600', 'between today and nine', 'between 10/01/26 and 10.09.26',
    'between 2026-10-01 and 10.09.26',
    // connectors no list held
    '8:40 AM til 9.30', "8:40 AM 'til 9.30", '8:40 AM ’til 9.30', '8:40 AM through to 9.30',
    '8:40 AM up to 9.30', '8:40 AM up until 9.30', '8:40 AM -> 9.30', '8:40 AM → 9.30',
    '8:40 AM ~ 9.30', '8:40 AM ～ 9.30', '8:40 AM .. 9.30', '8:40 AM ... 9.30', '8:40 AM ‐ 9.30',
    '8:40 AM ‒ 9.30', '8:40 AM ― 9.30', '8:40 AM − 9.30', '8:40 AM onto 9.30',
    // words and marks between the connector and the number
    '8:40 AM to a quarter past nine', '8:40 AM to a quarter to ten', '8:40 AM to approx. 9.30',
    '8:40 AM to ca. 9.30', '8:40 AM to c. 9.30', '8:40 AM to like 9.30', '8:40 AM to probably 9.30',
    '8:40 AM to just before 9.30', '8:40 AM to sometime around 9.30', '8:40 AM to (9.30)',
    '8:40 AM to "9.30"', '8:40 AM to [9.30]', '8:40 AM to: 9.30', '8:40 AM to (9:30 AM)',
    // a far side that begins with a word and still names a time
    '8:40 AM to right now', '8:40 AM to just now', '8:40 AM till nowish', '8:40 AM until the present',
    '8:40 AM to present', '8:40 AM to EOD', '8:40 AM to end of day', '8:40 AM to close of business',
    '8:40 AM to lunch', '8:40 AM to sunset', '8:40 AM to noonish',
    // an unreadable first side ending in a meridiem or a unit
    '9.30 AM to 10:15', '9.30 a.m. to 10:15', 'nine AM to 10:15', '1600 hrs to 17:00',
    'T09:30 to 10:15 PM',
    // the next day, a decimal tail, other scripts and spellings
    '8:40 PM to 2:00 AM the day after', '8:40 AM to 9:30 the day after', '8:40 PM to 2:00 AM (+1)',
    '8:40 AM to 9:30.5', '8:40 AM to ９:３０', '8:40 AM to +1h', '8:40 AM to T09:30',
    '8:30 and half nine', '8:30 and 9.30 in the logs',
    // a comma or a line break before a lower-case word continues the clause
    '8:40 AM, to 9.30', 'yesterday, between 8 and 9', '8:40 AM\nto 9.30', '8 a.m. to 9',
    // the owner-approved price: a time beside an unrelated number is asked, not read
    '9 AM and 3 retries', '8 AM and 9 AM', 'the 5 slowest calls yesterday',
    'which one failed yesterday',
  ] as const; // prettier-ignore
  for (const text of CITED) {
    it(`${JSON.stringify(text)} → one unreadable mention quoting the clause`, () => {
      expect(read(text).mentions).toEqual([{ quote: text, parses: [], problem: 'unreadable' }]);
    });
  }

  // The generator's dimensions: a v1 phrase, a separator, an opener, a time-like tail.
  const NEAR = [
    '8:40 AM', '8:40AM', '8:40', '20:40', '14:00', 'yesterday 8:40 PM', 'yesterday 20:40',
    '10/09/26 8 AM', '8 AM PST', '2026-10-09T08:00', 'yesterday', 'today', '10/01/26',
    '2026-10-01', 'last 40 minutes',
  ] as const; // prettier-ignore
  const SEPARATORS = [
    ' to ', ' until ', ' till ', ' through ', ' thru ', '-', ' - ', '–', ' – ', '—', ' — ',
    ' til ', " 'til ", ' ’til ', ' through to ', ' up to ', ' up until ', ' onto ', ' -> ', ' → ',
    ' ~ ', ' ～ ', ' .. ', ' ... ', '‐', '‒', '―', '−', ' ‐ ', ' − ', ' and ', ', ', ', to ',
    ' or ', ' ', '\n', ' + ', ' then ',
  ] as const; // prettier-ignore
  const OPENERS = [
    '', 'a ', 'an ', 'about ', 'approx. ', 'ca. ', 'c. ', 'like ', 'probably ', 'just before ',
    'sometime around ', '(', '"', '[', ': ', 'the ', 'right ',
  ] as const; // prettier-ignore
  /** Tails no v1 row reads on their own — every one carries a time-like token. */
  const TAILS = [
    '9', '21', '09', '9.30', '21.30', '930', '0930', '1600', '21h30', '9h', '9hrs', '9 hours',
    'nine', 'nine thirty', 'half past nine', 'quarter to ten', 'quarter past nine', 'the 9th',
    '9ish', '9:30.5', '９:３０', '+1h', 'T09:30', '3 retries', 'now', 'nowish', 'present', 'EOD',
    'end of day', 'close of business', 'lunch', 'sunset', 'noonish', 'the day after',
    'tomorrow morning', 'Friday', 'noon', 'midnight', 'one', 'twelve', 'May 3', '10.09.26',
  ] as const; // prettier-ignore
  /** [the text after the clause, what of it the quote keeps] */
  const ENDS: readonly [string, string][] = [
    ['', ''],
    ['.', ''],
    ['?', ''],
    [', thanks', ', thanks'],
    [' for checkout. Then stop', ' for checkout'],
  ];
  /** A bare hyphen run into an ISO phrase is part of its token (`…T08:00-09` is an offset), not a separator. */
  const offsetRun = (near: string, sep: string, opener: string) =>
    /^\d{4}-\d{2}-\d{2}/.test(near) && sep === '-' && opener === '';

  /**
   * Read whole or not at all: ONE mention holding the whole phrase — unreadable
   * (quoting the clause, or the phrase itself when a modifier or a phrase v1 does
   * not read already made it one: `8:40 AM to now`), or read as a range of both
   * sides quoting exactly the phrase (`9 to 8:40 AM`, a bare first side). Never
   * a mention that holds one side only.
   */
  const wrongOf = (
    phrase: string,
    end: string,
    kept: string,
    sides: readonly string[],
  ): string | undefined => {
    const text = `Show client activity ${phrase}${end}`;
    const mentions = read(text).mentions;
    const [m] = mentions;
    const clause = `Show client activity ${phrase}${kept}`;
    const holdsBoth = m !== undefined && sides.every((side) => m.quote.includes(side));
    const whole =
      mentions.length === 1 &&
      m !== undefined &&
      holdsBoth &&
      clause.includes(m.quote) &&
      (m.problem === 'unreadable'
        ? m.parses.length === 0
        : m.parses.length === 1 && m.parses[0]!.rangeOf?.length === 2);
    return whole ? undefined : `${JSON.stringify(text)} → ${JSON.stringify(mentions)}`;
  };

  it('every v1 phrase × separator × time-like tail (and reversed): read whole or not at all', () => {
    const wrong: string[] = [];
    let n = 0;
    for (const near of NEAR) {
      for (const sep of SEPARATORS) {
        for (const tail of TAILS) {
          if (offsetRun(near, sep, '')) continue;
          for (const [end, kept] of ENDS) {
            n++;
            const w1 = wrongOf(`${near}${sep}${tail}`, end, kept, [near, tail]);
            if (w1 !== undefined) wrong.push(w1);
            const w2 = wrongOf(`${tail}${sep}${near}`, end, kept, [near, tail]);
            if (w2 !== undefined) wrong.push(w2);
          }
        }
      }
    }
    expect(n).toBeGreaterThan(30_000);
    expect(wrong).toEqual([]);
  });

  it('every opener between the separator and the tail: read whole or not at all', () => {
    const wrong: string[] = [];
    for (const near of ['8:40 AM', '14:00', 'yesterday 8:40 PM', '10/09/26 8 AM', 'yesterday']) {
      for (const sep of SEPARATORS) {
        for (const opener of OPENERS) {
          for (const tail of TAILS) {
            if (offsetRun(near, sep, opener)) continue;
            const w = wrongOf(`${near}${sep}${opener}${tail}`, '', '', [near, tail]);
            if (w !== undefined) wrong.push(w);
          }
        }
      }
    }
    expect(wrong).toEqual([]);
  });

  it('`between` with a day or a date on the near side, any tail: read whole or not at all', () => {
    const wrong: string[] = [];
    for (const near of ['yesterday', 'today', '10/01/26', '2026-10-01', '8:30', '8 AM']) {
      for (const opener of OPENERS) {
        for (const tail of TAILS) {
          const w = wrongOf(`between ${near} and ${opener}${tail}`, '', '', [near, tail]);
          if (w !== undefined) wrong.push(w);
        }
      }
    }
    expect(wrong).toEqual([]);
  });

  it('seeded clauses with filler words: no mention ever reads one side alone', () => {
    const r = prng(0x7c1a);
    const FILLER = ['please', 'the', 'logs', 'for', 'just', 'like', 'maybe', 'errors', 'then'];
    const wrong: string[] = [];
    for (let i = 0; i < 3000; i++) {
      const words = Array.from({ length: int(r, 0, 2) }, () => pick(r, FILLER));
      const near = pick(r, NEAR);
      const sep = pick(r, SEPARATORS);
      if (offsetRun(near, sep, '')) continue;
      const tail = pick(r, TAILS);
      const far = [...words, pick(r, OPENERS) + tail].join(' ');
      const clause = r() < 0.5 ? `${near}${sep}${far}` : `${far}${sep}${near}`;
      const [end, kept] = pick(r, ENDS);
      const w = wrongOf(clause, end, kept, [near, tail]);
      if (w !== undefined) wrong.push(w);
    }
    expect(wrong).toEqual([]);
  });

  it('a v1 far side over the grammar’s connectors reads the whole range — the rule never taints it', () => {
    for (const near of ['8:40 AM', '14:00', 'yesterday 8:40 PM']) {
      for (const c of [
        ' to ',
        ' until ',
        ' till ',
        ' through ',
        ' thru ',
        '-',
        ' - ',
        '–',
        ' – ',
        '—',
        ' — ',
      ]) {
        const [m, ...rest] = read(`Show client activity ${near}${c}9:30 PM`).mentions;
        expect(rest, `${near}${c}9:30 PM`).toEqual([]);
        expect(m!.problem, `${near}${c}9:30 PM`).toBeUndefined();
        expect(m!.parses[0]!.rangeOf).toHaveLength(2);
      }
    }
  });

  it('…and over any other separator, the two v1 phrases are one unreadable clause — never one side', () => {
    for (const sep of [' til ', ' → ', ' ~ ', '‐', ' − ', ' .. ', ' and ', ', ', ' ']) {
      const text = `8:40 AM${sep}9:30 PM`;
      expect(read(text).mentions, text).toEqual([
        { quote: text, parses: [], problem: 'unreadable' },
      ]);
    }
  });

  it('a clause with no second time-like token still reads; a capitalised non-time word ends a clause', () => {
    expect(read('yesterday to compare').mentions).toEqual([
      { quote: 'yesterday', parses: [{ relative: { unit: 'day', offset: -1 } }] },
    ]);
    expect(read('I am checking yesterday’s errors, what failed?').mentions).toEqual([
      { quote: 'yesterday', parses: [{ relative: { unit: 'day', offset: -1 } }] },
    ]);
    expect(read('Errors at 8 AM. Then at 9 AM.').mentions.map((m) => m.quote)).toEqual([
      '8 AM',
      '9 AM',
    ]);
    expect(read('between yesterday and 9:30 PM').mentions).toEqual([
      {
        quote: 'yesterday and 9:30 PM',
        parses: [
          {
            rangeOf: [
              { relative: { unit: 'day', offset: -1 } },
              { wall: { h: 9, m: 30, meridiem: 'pm' } },
            ],
          },
        ],
      },
    ]);
  });
});

// ─── functional: the field sentences end to end ──────────────────────

describe('the field sentences — parts, then resolve, the policy and the ask', () => {
  const FIELD = 'Show client activity 10/09/26 8 AM to 8:40 AM PST';

  it('“10/09/26 8 AM to 8:40 AM PST” → the zone is asked for `PST` (no map ships)', () => {
    const [m] = read(FIELD).mentions;
    expect(m).toEqual({
      quote: '10/09/26 8 AM to 8:40 AM PST',
      parses: [
        {
          date: { kind: 'numeric', fields: [10, 9, 26], yearDigits: 2 },
          zoneToken: 'PST',
          rangeOf: [{ wall: { h: 8, meridiem: 'am' } }, { wall: { h: 8, m: 40, meridiem: 'am' } }],
        },
      ],
    });
    const [row] = timeReadingRows({
      mentions: checkReading(FIELD, read(FIELD), reader.id),
      clock: { ...CLOCK, nowSource: 'app', zoneSource: 'run' },
      policy: DEFAULT_TIME_POLICY,
      reader: { id: reader.id, version: reader.version, kind: 'rule', locale: reader.locale },
      tzdata: 'test',
      at: { turn: 1, iteration: 1 },
    });
    expect(row!.choice).toEqual({ by: 'open', remaining: [], open: ['zone'] });
    expect(timeAskOf(row!, defaultTimeAskMessages)).toEqual({
      question: 'Which time zone did you mean by “PST” in “10/09/26 8 AM to 8:40 AM PST”?',
      field: { id: 'time', type: 'string', required: true, format: 'zone' },
    });
  });

  it('…the zone answered: three date orders asked; `MDY` gives 9 Oct in PDT (−07:00), not PST', () => {
    const parses = withZoneAnswered(read(FIELD).mentions[0]!.parses, LA);
    const res = resolveMention(parses, CLOCK, RULE);
    expect(res.candidates.map((c) => [c.reading.dateOrder, c.range.from, c.range.to])).toEqual([
      ['MDY', '2026-10-09T08:00:00-07:00', '2026-10-09T08:41:00-07:00'],
      ['DMY', '2026-09-10T08:00:00-07:00', '2026-09-10T08:41:00-07:00'],
      ['YMD', '2010-09-26T08:00:00-07:00', '2010-09-26T08:41:00-07:00'],
    ]);
    expect(chooseReading(res, DEFAULT_TIME_POLICY, 'rule')).toMatchObject({
      by: 'open',
      open: ['date-order'],
    });
    expect(chooseReading(res, { dateOrder: 'MDY', year: 'ask' }, 'rule')).toEqual({
      by: 'policy',
      candidate: 0,
      policy: { dateOrder: 'MDY' },
    });
  });

  it('“yesterday” → one window, the whole of 8 October in the person’s zone', () => {
    const [m] = read('what failed yesterday?').mentions;
    const res = resolveMention(m!.parses, CLOCK, RULE);
    expect(chooseReading(res, DEFAULT_TIME_POLICY, 'rule')).toEqual({ by: 'only', candidate: 0 });
    expect(res.candidates[0]!.range).toEqual({
      from: '2026-10-08T00:00:00-07:00',
      to: '2026-10-09T00:00:00-07:00',
    });
  });

  it('a future date is read as written; a `past` tool’s facts refuse it (the reader never does)', () => {
    const [m] = read('client activity on 10/20/26').mentions;
    const res = resolveMention(m!.parses, CLOCK, RULE);
    // 20 is no month, so only MDY is a day: one window, settled without the policy.
    expect(chooseReading(res, DEFAULT_TIME_POLICY, 'rule')).toEqual({ by: 'only', candidate: 0 });
    const range = res.candidates[0]!.range;
    expect(range.from).toBe('2026-10-20T00:00:00-07:00');
    expect(periodFactProblem(range, { direction: 'past' }, CLOCK.now)).toBe('time-future');
  });
});

// ─── boundary ────────────────────────────────────────────────────────

describe('boundary', () => {
  it('impossible clock times are not read; an impossible date resolves to nothing', () => {
    expect(read('at 25:00').mentions).toEqual([]);
    expect(read('at 8:61').mentions).toEqual([]);
    const [m] = read('on 02/30/26').mentions;
    expect(resolveMention(m!.parses, CLOCK, RULE).candidates).toEqual([]);
  });

  it('a bare hour is a time only as a range’s first side', () => {
    expect(read('8 servers').mentions).toEqual([]);
    expect(read('8 to 9 AM').mentions[0]!.parses).toEqual([
      { rangeOf: [{ wall: { h: 8 } }, { wall: { h: 9, meridiem: 'am' } }] },
    ]);
  });

  it('`from … to` and `from <day>` still read; a number beside a time is asked (the clause rule)', () => {
    expect(read('9 AM and 3 retries').mentions).toEqual([
      { quote: '9 AM and 3 retries', parses: [], problem: 'unreadable' },
    ]);
    expect(read('from 8 AM to 9 AM').mentions[0]).toMatchObject({ quote: '8 AM to 9 AM' });
    expect(read('from 8 AM to 9 AM').mentions[0]!.problem).toBeUndefined();
    expect(read('logs from yesterday').mentions).toEqual([
      { quote: 'yesterday', parses: [{ relative: { unit: 'day', offset: -1 } }] },
    ]);
    expect(read('errors 500-503 yesterday').mentions).toEqual([
      { quote: 'errors 500-503 yesterday', parses: [], problem: 'unreadable' },
    ]);
  });

  it('an abbreviation outside the closed list is not a zone', () => {
    expect(read('8 AM NAS').mentions[0]!.parses).toEqual([{ wall: { h: 8, meridiem: 'am' } }]);
  });

  it(`at most ${MAX_MENTIONS} mentions — the port's bound`, () => {
    const text = Array.from({ length: 30 }, (_, i) => `Then at ${(i % 12) + 1} PM;`).join(' ');
    const mentions = read(text).mentions;
    expect(mentions).toHaveLength(MAX_MENTIONS);
    expect(mentions[0]!.quote).toBe('1 PM');
  });

  it('the reader is frozen and names itself', () => {
    expect(reader).toMatchObject({
      id: 'agentfootprint/english',
      version: '1.0.0',
      locale: 'en-US',
      kind: 'rule',
    });
    expect(Object.isFrozen(reader)).toBe(true);
    expect(englishTimeReader({ locale: 'en-GB' }).locale).toBe('en-GB');
  });
});

// ─── property ────────────────────────────────────────────────────────

const WORDS = [
  'errors', 'on', 'at', 'to', 'yesterday', 'today', 'tomorrow', 'morning', 'last', 'past', 'next',
  'week', '40', 'minutes', 'hours', '8', 'AM', 'PM', '8:40', '20:40', '10/09/26', '10/9',
  '2026-10-09', 'PST', 'UTC-07:00', 'America/Los_Angeles', 'since', 'between', 'and', '-', '–',
  'Friday', 'Oct', '9', 'ago', ',', '.', 'now', 'the', 'day', 'before', 'o’clock',
] as const; // prettier-ignore

function sentence(r: () => number): string {
  const n = int(r, 1, 14);
  return Array.from({ length: n }, () => pick(r, WORDS)).join(pick(r, [' ', ' ', '  ', '']));
}

describe('property — over seeded texts', () => {
  const r = prng(0x7e61);
  const texts = Array.from({ length: 2000 }, () => sentence(r));

  it('every quote is a verbatim substring, and the port’s checks accept every reading', () => {
    for (const text of texts) {
      const reading = read(text);
      for (const m of reading.mentions) expect(text.includes(m.quote)).toBe(true);
      const checked = checkReading(text, reading, reader.id);
      expect(checked.every((c) => !('refused' in c))).toBe(true);
    }
  });

  it('the same text always reads the same', () => {
    for (const text of texts.slice(0, 300)) {
      expect(JSON.stringify(read(text))).toBe(JSON.stringify(read(text)));
    }
  });

  it('a readable mention always resolves without throwing', () => {
    for (const text of texts) {
      for (const m of read(text).mentions) {
        if (m.problem === 'unreadable') continue;
        expect(() => resolveMention(m.parses, CLOCK, RULE)).not.toThrow();
      }
    }
  });
});

// ─── security ────────────────────────────────────────────────────────

describe('security', () => {
  it('the leaf law: `readers/` imports only the port', () => {
    const dir = join(__dirname, '..', '..', '..', 'src', 'core', 'time', 'readers');
    for (const file of readdirSync(dir).filter((f) => f.endsWith('.ts'))) {
      const text = readFileSync(join(dir, file), 'utf8');
      const specifiers = [
        ...text.matchAll(/^\s*(?:import|export)[^'"]*from\s+['"]([^'"]+)['"]/gm),
      ].map((m) => m[1] as string);
      for (const spec of specifiers) expect(spec, `${file} imports ${spec}`).toBe('../reader.js');
    }
  });

  it('hostile input never throws and never quotes what it did not see', () => {
    const hostile = [
      '1/'.repeat(5000),
      '8:'.repeat(5000),
      '2026-10-09T'.repeat(500),
      'last '.repeat(3000) + '40 minutes',
      '\u0000‮10/09/26‭ 8 AM',
      '８ AM 10／09／26', // full-width digits are not ASCII digits
    ];
    for (const text of hostile) {
      const reading = read(text);
      for (const m of reading.mentions) expect(text.includes(m.quote)).toBe(true);
      expect(reading.mentions.length).toBeLessThanOrEqual(MAX_MENTIONS);
    }
  });
});

// ─── performance ─────────────────────────────────────────────────────

describe('performance', () => {
  it('a 100 000-character message reads inside a budget', () => {
    const text = 'errors on 10/09/26 8 AM to 8:40 AM PST and more words here. '.repeat(1700);
    const t0 = performance.now();
    read(text);
    expect(performance.now() - t0).toBeLessThan(1500);
  });
});
