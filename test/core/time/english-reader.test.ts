/**
 * The careful English reader (time design § 5.3, step T6b) — a tokenizer over
 * the v1 phrases, "unreadable" for every other time phrase it recognises. The
 * field sentences are the table; what `resolve.ts`, the policy and the ask
 * make of the parts is asserted beside them.
 *
 * Law: the reader TOKENIZES — parts and a verbatim quote, never an instant, a
 * date order, a zone mapping or a refusal of the future; a phrase v1 does not
 * read is one `unreadable` mention quoting the whole phrase; a reading is the
 * person's words only when nothing time-like is left outside every mention —
 * otherwise it names its `leftover` and is confirmed, never said.
 *
 * Test types:
 *   functional  — every v1 row of § 5.3 → its parts; every non-v1 row → "unreadable"; the field
 *                 sentences end to end through resolve, choose and the ask ("10/09/26 8 AM to
 *                 8:40 AM PST" → a zone ask for `PST`, then three date orders, `MDY` → PDT;
 *                 "yesterday"; a future date refused by a `past` tool's facts);
 *   leftover rule — every row the recheck rounds cited is confirmed or unreadable, never said (as
 *                 the RECORD files it: `rows.ts` · `confirmNeededOf` — a point time and a second
 *                 mention confirm whatever the scan found; a point × any tail is never said); a
 *                 generated matrix (v1 phrase × separator × opener × time-like tail, reversed,
 *                 seeded fillers) proves a reading is said only when an independent oracle finds
 *                 nothing time-like outside every mention; plain exact phrases stay said;
 *   position rule — an allow-listed span is said only when it ends its clause: the terminal
 *                 controls stay said, and a seeded property — any allow-listed span followed by
 *                 any non-empty tail in its clause — is never said;
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
import {
  confirmNeededOf,
  timeReadingRows,
  timeRowIsWellFormed,
} from '../../../src/core/time/rows.js';
import { periodFactProblem } from '../../../src/core/time/convert.js';
import { defaultTimeAskMessages } from '../../../src/locales/timeAsk.js';
import { int, pick, prng } from './fixtures/generate.js';

const reader = englishTimeReader();
const read = (text: string) =>
  reader.read(text, { locale: 'en-US' }) as ReturnType<typeof reader.read> & {
    mentions: { quote: string; parses: TimeParts[]; problem?: 'unreadable'; leftover?: string[] }[];
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
    // A range whose other side is no v1 time is not here: its v1 side is read and CONFIRMED
    // (the leftover rule, below) — never filed as said.
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

// ─── the leftover rule: the person's words only when nothing time-like is left ───

/** The `time-reading` rows the library files for the text, as seed would. */
const rowsOf = (text: string) =>
  timeReadingRows({
    mentions: checkReading(text, read(text), reader.id),
    clock: { now: CLOCK.now, nowSource: 'app', zone: LA, zoneSource: 'app' } as never,
    policy: DEFAULT_TIME_POLICY,
    reader: { id: reader.id, version: reader.version, kind: 'rule', locale: 'en-US' },
    tzdata: 'test',
    at: { turn: 1, iteration: 1 },
  });

/**
 * The readings that may be filed as the person's words: read, and nothing to
 * confirm — no leftover, no point time, no second mention (`rows.ts` ·
 * `confirmNeededOf`). What the record decides, not what the reader returned.
 */
function saidOf(text: string): { quote: string; parses: readonly TimeParts[] }[] {
  const mentions = checkReading(text, read(text), reader.id);
  return mentions.flatMap((m) =>
    'refused' in m || m.problem !== undefined || confirmNeededOf(m, mentions.length, 'rule')
      ? []
      : [{ quote: m.quote, parses: m.parses }],
  );
}

/** Whether a parse names one clock time with no second bound — a POINT, never a window. */
const isPoint = (p: TimeParts): boolean => p.rangeOf === undefined && p.wall !== undefined;

/** Where each mention stands in the text — quotes are in order and never overlap. */
function spansOf(text: string): { start: number; end: number }[] {
  const out: { start: number; end: number }[] = [];
  let from = 0;
  for (const m of read(text).mentions) {
    const start = text.indexOf(m.quote, from);
    out.push({ start, end: start + m.quote.length });
    from = start + m.quote.length;
  }
  return out;
}

/**
 * The ORACLE — the task's broad time-or-range set, written here independently
 * of the reader's list: any digit; one … twelve, noon, midnight, half,
 * quarter; day and relative words; week day and month names; am/pm; range
 * words; `and` after a time; a dash, arrow, tilde, `..` or `/` between tokens.
 */
const ORACLE = new RegExp(
  '\\p{Nd}' +
    '|\\b(?:one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|noon|midnight|half|quarter' +
    '|today|tomorrow|yesterday|tonight|last|next|ago|since|before|after|then|eod' +
    '|mornings?|afternoons?|evenings?|nights?|am|pm|to|until|till|til|through|thru|between|from' +
    '|(?:mon|tues|wednes|thurs|fri|satur|sun)days?|mon|tue|wed|thu|fri|sat|sun' +
    '|jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|june?|july?|aug(?:ust)?' +
    '|sep(?:t(?:ember)?)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)\\b' +
    '|(?<!\\p{L})(?:[-‐‑‒–—―−~～→/]|->|\\.\\.)|(?:[-‐‑‒–—―−~～→/]|->|\\.\\.)(?!\\p{L})',
  'iu',
);

/** What is left of the text once every mention's quote (and a read range's opener) is blanked. */
function outsideMentions(text: string): string {
  let rest = text;
  for (const s of spansOf(text)) {
    rest = rest.slice(0, s.start) + ' '.repeat(s.end - s.start) + rest.slice(s.end);
  }
  return rest.replace(/\b(?:from|between)(\s+)(?=\s)/gi, (m) => ' '.repeat(m.length));
}

describe('the leftover rule — a reading is the person’s only when nothing time-like is left', () => {
  // Every row the three recheck rounds cited: none may come back as the person's words.
  const CITED = [
    // round 1–2: connectors, openers and far sides no list held
    'between yesterday and 1600', 'between today and nine', 'between 10/01/26 and 10.09.26',
    'between 2026-10-01 and 10.09.26', '8:40 AM til 9.30', "8:40 AM 'til 9.30", '8:40 AM ’til 9.30',
    '8:40 AM through to 9.30', '8:40 AM up to 9.30', '8:40 AM up until 9.30', '8:40 AM -> 9.30',
    '8:40 AM → 9.30', '8:40 AM ~ 9.30', '8:40 AM ～ 9.30', '8:40 AM .. 9.30', '8:40 AM ... 9.30',
    '8:40 AM ‐ 9.30', '8:40 AM ‒ 9.30', '8:40 AM ― 9.30', '8:40 AM − 9.30', '8:40 AM onto 9.30',
    '8:40 AM to a quarter past nine', '8:40 AM to a quarter to ten', '8:40 AM to approx. 9.30',
    '8:40 AM to ca. 9.30', '8:40 AM to c. 9.30', '8:40 AM to like 9.30', '8:40 AM to probably 9.30',
    '8:40 AM to just before 9.30', '8:40 AM to sometime around 9.30', '8:40 AM to (9.30)',
    '8:40 AM to "9.30"', '8:40 AM to [9.30]', '8:40 AM to: 9.30', '8:40 AM to (9:30 AM)',
    '8:40 AM to right now', '8:40 AM to just now', '8:40 AM till nowish', '8:40 AM until the present',
    '8:40 AM to present', '8:40 AM to EOD', '8:40 AM to end of day', '8:40 AM to close of business',
    '8:40 AM to lunch', '8:40 AM to sunset', '8:40 AM to noonish', '9.30 AM to 10:15',
    '9.30 a.m. to 10:15', 'nine AM to 10:15', '1600 hrs to 17:00', 'T09:30 to 10:15 PM',
    '8:40 PM to 2:00 AM the day after', '8:40 AM to 9:30 the day after', '8:40 PM to 2:00 AM (+1)',
    '8:40 AM to 9:30.5', '8:40 AM to ９:３０', '8:40 AM to +1h', '8:40 AM to T09:30',
    '8:30 and half nine', '8:30 and 9.30 in the logs', '8:40 AM, to 9.30',
    'yesterday, between 8 and 9', '8:40 AM\nto 9.30', '8 a.m. to 9', '8:40 AM till 9',
    'yesterday 8:40 PM to 9', '8 to 9:30', 'between 8 and 9:30', 'between 8:30 and 9', '8-9:30',
    '14:00 to 16', '8 and 9 AM', '10/9-12', '8:40 AM till 9.30', '8:40 till 9.30', '14:00 to 1600',
    '14:00-1600', '8:40 AM to 930', '8:40 AM until 9h', '8:40 AM till nine', '8:40 AM to about 9 AM',
    '1600 to 17:00', 'nine till 8:40 AM', '8:30 and 9 yesterday',
    'yesterday 8:40 PM till 9.30 for checkout. Thanks', '(8:40 AM till 9.30) please',
    // round 3: the clause rule's own leaks
    '8:40 AM → EOD', '8:40 AM / 9.30', '8:40 AM + 50m', '8:40 AM plus fifty', '8:40 AM to Nine',
    '8:40 AM (Till 9.30)', '(Till 9.30) 8:40 AM', 'today, Tuesday', 'yesterday & today', 'yesterday … today',
    // round 4: a clause mark before a capital
    '8:40 AM, Till 9.30', '8:40 AM, Until 9.30', '8:40 AM\nTill 9.30', 'Start: 8:40 AM\nEnd: 9.30',
    '8:40 AM. Until 9.30 please', 'errors yesterday, Then 9.30 too', 'between 8 AM, And 9.30',
    // round 4: a range to an event, or left open
    '8 AM until the deploy', '8 AM to close', '8 AM till late', '8 AM until then',
    'yesterday until the outage', 'between 8 AM and the deploy', 'errors between 8 AM and',
    'errors 8 AM to', 'errors 8 AM -',
    // round 4: word-list gaps and letter case
    'today until april', 'yesterday through june', 'yesterday through august',
    'YESTERDAY THRU SAT', 'TODAY TO MAY', 'today thru sat', 'yesterday to wed', 'today through sun',
    'today until the tenth', 'yesterday to the ninth', '9 AM for an hr', '9 AM plus a min',
    '9 AM plus a sec', 'yesterday to tonite',
    // the trade-off: a time beside an unrelated number or word is confirmed
    '9 AM and 3 retries', '8 AM and 9 AM', 'the 5 slowest calls yesterday',
    'which one failed yesterday', 'errors 500-503 yesterday', 'errors in the last 2 hours to date',
    'I want to see yesterday', 'logs from yesterday', '8:40 AM ~ 9:30 PM', 'since 8 AM, and today',
    // round 5: open-range words beside a point time — a point is never a window
    'errors 8 AM forward', '8 AM going forward', 'errors 8 AM on', 'errors 8 AM on out',
    'errors 8 AM hence', 'errors 8 AM henceforth', '8 AM thereafter', 'errors 8 AM ff',
    'errors >8 AM', 'errors >= 8 AM', 'errors ≥ 8 AM', 'errors < 9 PM', 'errors newer than 8 AM',
    'errors older than 8 AM', 'errors at least 8 AM', 'errors kicking off 8 AM', 'post 8 AM errors',
    'pre 9 AM errors', 'post-8 AM', 'errors 8:40', 'errors >8:40', '8 AM', '2026-10-09T08:00',
    'yesterday 8:40 PM', 'yesterday at 8 AM',
    // round 5: two point readings with an unread range token between them — several mentions
    'Start: 8:40 AM\nEnd: 9:30 PM', 'start 8:40 AM, end 9:30 PM', 'begin 8 AM finish 9 PM',
    '8 AM start, 9 PM stop', 'window opens 8 AM, closes 9 PM', '8 AM into 9 PM', '8am > 9pm',
    '8am<9pm', '8am >= 9pm', '8 AM | 9 PM', '8 AM » 9 PM', '8 AM ➔ 9 PM', '8 AM ➜ 9 PM',
    '8 AM ⇢ 9 PM', '8 AM ⇨ 9 PM', '8 AM ⟹ 9 PM', '8 AM ▶ 9 PM', '8 AM ⁓ 9 PM', '8 AM ‥ 9 PM',
    '8 AM ･･ 9 PM', '8 AM = 9 PM', '8 AM : 9 PM', '8 AM _ 9 PM', '8 AM bis 9 PM', '8 AM à 9 PM',
    '8 AM hasta 9 PM', '8 AM 到 9 PM', 'yesterday into today', 'today vs yesterday',
    // round 5: a mark by rule, not by list, beside a whole-unit reading
    '>yesterday', 'yesterday ≥', '≤ last 2 hours', 'yesterday »', '= 2026-09-26', 'yesterday ➜',
    // round 6: a zone named in words or as an IANA name beside a calendar word or a zone-less date
    'any backup failures yesterday London time?', 'errors yesterday, Singapore time',
    'cpu spikes yesterday Sydney time', 'errors yesterday India time', 'errors yesterday server time',
    'backups 2026-09-26 London time', 'errors yesterday Europe/London', 'errors yesterday in Asia/Kolkata',
    'errors yesterday in Tokyo', 'errors yesterday Pacific time', 'errors yesterday IST',
    'errors yesterday UTC', 'errors yesterday PT', 'backups 2026-09-26 in Asia/Tokyo',
    // round 6: a look-back anchored to an event, not to now
    'logs for the last 2 hours of the outage', 'logs for the last 30 minutes of the incident',
    'show logs for the last 30 minutes of the job', 'errors in the last 15 minutes of the deploy',
    'logs for the last 2 hours of the maintenance window', 'logs the past 24 hours preceding the outage',
    'logs the last 2 hours before the outage', 'logs the last 2 hours after the deploy',
    'logs the last 2 hours leading up to the outage', 'logs the last 2 hours prior to the restart',
    // round 6: open ranges, negation, filters and comparisons
    'logs yesterday post-deploy', 'logs yesterday pre-deploy', 'errors yesterday going forward',
    'errors yesterday henceforth', 'logs excluding yesterday', 'logs except yesterday',
    'logs excluding the last 2 hours', 'errors in the last 7 days on weekdays',
    'last 7 days vs the previous 7 days', 'yesterday vs today', 'errors 2-4 yesterday',
    // round 6: every calendar word, zone-less date and clock time is confirmed, never said
    'errors today', 'errors tomorrow', 'errors on 10/09/26', '2026-09-26', 'from 8 AM to 9 AM yesterday',
    '8 to 9 AM', '2026-09-26 08:00..08:40', '2026-10-01..2026-10-09', '2026-10-09T08:00 PST',
    '2026-10-09T08:00', 'errors 8:40 AM – 9:30 PM', 'previous 7 days', 'last 30 seconds', 'last week',
    // round 7: a look-back tied to an event — any word after the span in its clause confirms
    'last 2 hours ending at the outage', 'last 2 hours ending with the outage',
    'last 2 hours ended at the incident', 'last 2 hours as of the deploy',
    'last 7 days leading into the release', 'last 2 hours leading into the outage',
    'last 7 days ahead of the release', 'last 2 hours ahead of the outage', 'last 2 hours near the outage',
    'last 7 days surrounding the release', 'logs last 2 hours surrounding the outage',
    'last 2 hours in the incident', 'last 2 hours at the incident',
    'last 2 hours in the maintenance window', 'last 7 days prerelease',
    // round 7: a look-back that excludes a period
    'last 2 hours ignoring the outage', 'last 2 hours without the outage',
    'last 2 hours but not the outage', 'last 2 hours sans outage',
    // round 7: a look-back beside a place
    'the last 3 days in London', 'last 24 hours in Kolkata', 'last 24 hours in India',
    'last 2 hours in Tokyo', 'last 2 hours Berlin', 'last 3 hours on the east coast',
    'last 3 hours West Coast', 'last 3 days per server clock',
    // round 7: an explicit instant with an open end or an approximation
    'newer than 2026-10-09T08:00Z', 'logs newer than 2026-10-09T08:00Z', 'older than 2026-10-09T08:00Z',
    'at least 2026-10-09T08:00Z', 'at most 2026-10-09T08:00Z', 'ending 2026-10-09T08:00Z',
    'ending at 2026-10-09T08:00Z', 'ended 2026-10-09T08:00Z', '2026-10-09T08:00Z give or take',
    '2026-10-09T08:00Z surrounding', '2026-10-09T08:00Z nearby', '2026-10-09T08:00Z vicinity',
    '2026-10-09T08:00Z window',
    // round 7: an explicit instant beside a place
    '2026-10-09T08:00-07:00 London', '2026-10-09T08:00-07:00 in Berlin', '2026-10-09T08:00Z in Tokyo',
    // round 7: what the position rule itself must hold — a comma is no clause end; a bending word
    // before the span, or opening the next clause, confirms
    'last 2 hours, on node 11', 'errors in the last 2 hours on node 11', 'errors (last 2 hours) on node 11',
    'excluding the last 2 hours', 'not in the last 2 hours', 'errors other than the last 2 hours',
    'errors during the last 2 hours', 'the end of the last 2 hours', 'since the past week',
    'last 2 hours. Excluding the outage', 'last 2 hours; ending at the outage',
    'last 2 hours\nwithout the outage', 'errors at 2026-10-09T08:00-07:00',
  ] as const; // prettier-ignore
  for (const text of CITED) {
    it(`${JSON.stringify(text)} → confirmed or unreadable, never said`, () => {
      const mentions = read(text).mentions;
      expect(mentions.length).toBeGreaterThan(0);
      expect(saidOf(text)).toEqual([]);
    });
  }

  it('an incomplete reading keeps its parts and names what it left, in order, verbatim', () => {
    expect(read('8:40 AM til 9.30').mentions).toEqual([
      {
        quote: '8:40 AM',
        parses: [{ wall: { h: 8, m: 40, meridiem: 'am' } }],
        leftover: ['til', '9.30'],
        confirm: true,
      },
    ]);
    expect(read('Start: 8:40 AM\nEnd: 9.30').mentions[0]!.leftover).toEqual(['9.30']);
    expect(read('YESTERDAY THRU SAT').mentions[0]!.leftover).toEqual(['THRU', 'SAT']);
    // Every reading of the message carries the message's leftover.
    expect(read('yesterday & today').mentions.map((m) => m.leftover)).toEqual([['&'], ['&']]);
  });

  it('controls — a plain, exact phrase is read whole; only an allow-listed form is the person’s words', () => {
    // [text, quote, said] — every one read whole (no leftover); `said` only on the allow-list.
    const CONTROLS: readonly [string, string, boolean][] = [
      ['from 8 AM to 9 AM yesterday', '8 AM to 9 AM yesterday', false],
      ['2026-09-26 08:00..08:40', '2026-09-26 08:00..08:40', false],
      ['2026-10-01..2026-10-09', '2026-10-01..2026-10-09', false],
      ['errors yesterday?', 'yesterday', false],
      ['Show client activity 10/09/26 8 AM to 8:40 AM PST', '10/09/26 8 AM to 8:40 AM PST', false],
      ['between yesterday and 9:30 PM', 'yesterday and 9:30 PM', false],
      ['check-in errors yesterday', 'yesterday', false],
      ['I am checking yesterday’s errors, what failed?', 'yesterday', false],
      ['8 to 9 AM', '8 to 9 AM', false],
      ['Show client activity 8:40 AM – 9:30 PM', '8:40 AM – 9:30 PM', false],
      ['Show client activity for the last 40 minutes', 'last 40 minutes', true],
      ['errors in the past 24 hours', 'past 24 hours', true],
      ['errors in the last hour', 'the last hour', true],
      ['errors over the past week', 'the past week', true],
      ['errors 2026-10-09T08:00-07:00', '2026-10-09T08:00-07:00', true],
      ['errors 2026-10-09T08:00Z/2026-10-09T09:00Z', '2026-10-09T08:00Z/2026-10-09T09:00Z', true],
      ['errors 2026-10-09T08:00 America/Los_Angeles', '2026-10-09T08:00 America/Los_Angeles', true],
    ];
    for (const [text, quote, said] of CONTROLS) {
      const mentions = read(text).mentions;
      expect(mentions, text).toHaveLength(1);
      expect(mentions[0], text).toMatchObject({ quote });
      expect(mentions[0]!.problem, text).toBeUndefined();
      expect(mentions[0]!.leftover, text).toBeUndefined();
      // …and the record files it as said only when its form is on the allow-list.
      expect(
        saidOf(text).map((r) => r.quote),
        text,
      ).toEqual(said ? [quote] : []);
    }
  });

  it('a point is not a window: a point time with ANY tail is never said', () => {
    const POINTS = [
      '8 AM', '8:40', '20:40', '8:40 p.m.', '8AM', 'yesterday 8:40 PM', '10/09/26 8 AM',
      '2026-10-09T08:00', '2026-10-09 08:00', '8 AM PST', '8 AM America/Los_Angeles',
    ] as const; // prettier-ignore
    const FIXED_TAILS = [
      '', ' forward', ' onward', ' on', ' hence', ' henceforth', ' thereafter', ' ff', ' and later',
      ' going forward', ' +', ' >', ' ≥', ' →', ' into the night', ' until the deploy', ' please',
      '?', '.', ' for the whole sprint', ' vs yesterday', ' start', ' end', ' open', ' close',
    ] as const; // prettier-ignore
    const r = prng(0x5eed);
    const ALPHABET = 'abcdefghij klmnop>=<≥≤~→…+|»_:;,.!?-/&()0123456789AMPM到à\n'.split('');
    const tails = [...FIXED_TAILS];
    for (let i = 0; i < 600; i++) {
      tails.push(Array.from({ length: int(r, 1, 12) }, () => pick(r, ALPHABET)).join(''));
    }
    const wrong: string[] = [];
    for (const point of POINTS) {
      for (const tail of tails) {
        for (const text of [`${point}${tail}`, `${tail} ${point}`, `errors ${point}${tail}`]) {
          const said = saidOf(text);
          // A said row may only ever be window-complete; the point's own reading never is.
          if (said.some((m) => m.parses.some(isPoint))) wrong.push(JSON.stringify(text));
        }
      }
    }
    expect(wrong.slice(0, 20)).toEqual([]);
    // And it lands as a confirmation: the point's row names `point`, its choice waits for the person.
    const [row] = rowsOf('errors 8 AM forward');
    expect(row).toMatchObject({
      quote: '8 AM',
      confirmNeeded: { point: true },
      choice: { by: 'open', open: ['confirm'] },
    });
    expect(timeAskOf(row!, defaultTimeAskMessages)?.field.labels?.[0]).toMatch(
      /^I read .+ — is that the window you mean\?$/,
    );
  });

  it('more than one reading is confirmed, unless it was read as one range', () => {
    expect(rowsOf('start 8:40 AM, end 9:30 PM').map((r) => r.confirmNeeded)).toEqual([
      { point: true, several: true, form: true },
      { point: true, several: true, form: true },
    ]);
    expect(rowsOf('today vs yesterday').map((r) => r.confirmNeeded)).toEqual([
      { several: true, form: true },
      { several: true, form: true },
    ]);
    // …and neither ends its clause bare: `vs` follows the first and bends the second.
    expect(rowsOf('last 2 hours vs the last hour').map((r) => r.confirmNeeded)).toEqual([
      { several: true, form: true },
      { several: true, form: true },
    ]);
    expect(saidOf('2026-10-09T08:40Z to 2026-10-09T21:30Z')).toHaveLength(1);
  });

  it('a mark by rule: any symbol but sentence punctuation, quotes and brackets is left over', () => {
    for (const mark of [
      '>',
      '<',
      '≥',
      '≤',
      '|',
      '»',
      '➔',
      '⇨',
      '⟹',
      '▶',
      '⁓',
      '‥',
      '=',
      '_',
      '#',
      '*',
    ]) {
      expect(read(`yesterday ${mark}`).mentions[0]!.leftover, mark).toEqual([mark]);
    }
    for (const text of [
      'errors (yesterday)?',
      '“yesterday”',
      'errors: yesterday!',
      'request_id yesterday',
    ]) {
      expect(read(text).mentions[0]!.leftover, text).toBeUndefined();
    }
  });

  it('the allow-list: only a look-back from now and an explicit ISO instant or range are said', () => {
    const SAID = [
      'last 2 hours', 'errors in the last 40 minutes', 'past 3 days', 'cpu over the last 2 weeks',
      'the last hour', 'errors in the past day', 'the past week', 'LAST 24 HOURS',
      '2026-10-09T08:00-07:00', '2026-10-09T08:00:30+05:30', '2026-10-09T08:00Z',
      '2026-10-09T08:00 UTC', '2026-10-09T08:00 America/Los_Angeles', '2026-10-09 08:00 (Europe/London)',
      '2026-10-09T08:00Z/2026-10-09T09:00Z', '2026-10-09T08:00Z to 2026-10-09T09:00Z',
      '2026-10-09T08:00-07:00..2026-10-09T09:00-07:00', '2026-09-26 08:00..08:40 UTC',
    ] as const; // prettier-ignore
    for (const text of SAID) {
      expect(saidOf(text), text).toHaveLength(1);
      expect(read(text).mentions[0]!.confirm, text).toBeUndefined();
    }
    // Read, but off the allow-list: `confirm` on the port, `form` on the row, offered with its zone.
    const [row] = rowsOf('errors yesterday');
    expect(row).toMatchObject({
      quote: 'yesterday',
      confirmNeeded: { form: true },
      choice: { by: 'open', open: ['confirm'] },
    });
    expect(row!.candidates!.every((c) => c.said.length === 0)).toBe(true);
    const ask = timeAskOf(row!, defaultTimeAskMessages);
    expect(ask?.question).toBe('Is this the time you meant by “yesterday”?');
    expect(ask?.field.enum).toEqual(['2026-10-08T00:00:00-07:00/2026-10-09T00:00:00-07:00']);
    expect(ask?.field.labels?.[0]?.replace(/\s/g, ' ')).toBe(
      'I read “yesterday” as Thu, Oct 8, 2026, PDT in America/Los_Angeles — is that right?',
    );
    // A span the list does not hold is not read at all.
    for (const text of ['previous 7 days', 'last 30 seconds', 'last week', 'past hour']) {
      expect(read(text).mentions[0]?.problem, text).toBe('unreadable');
    }
  });

  it('property: a message whose time content is not an allow-listed form never yields said', () => {
    const OFF_LIST = [
      'yesterday', 'today', 'tomorrow', '8:40 AM', '20:40', '8 AM to 9 AM', 'yesterday 8:40 PM',
      '10/09/26', '2026-09-26', '2026-10-09T08:00', '2026-10-09T08:00 PST', '2026-09-26 08:00..08:40',
      'between yesterday and 9:30 PM', '8 to 9 AM', '10/09/26 8 AM to 8:40 AM PST', 'YESTERDAY',
    ] as const; // prettier-ignore
    const ON_LIST = ['last 2 hours', 'the past day', '2026-10-09T08:00Z'] as const;
    const FILLER = [
      'errors', 'logs', 'please', 'the', 'for', 'in', 'London', 'time', 'server', 'of', 'outage',
      'Asia/Kolkata', 'Europe/London', 'deploy', 'vs', 'and', ',', '?', 'show', 'cpu', 'IST',
    ] as const; // prettier-ignore
    // An oracle written apart from the reader: what a said quote may look like.
    const LOOKBACK =
      /^(?:the\s+)?(?:last|past)\s+(?:\d+\s*(?:minutes?|mins?|hours?|hrs?|days?|weeks?)|hour|day|week)$/i;
    const ISO_ZONED =
      /^\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}.*(?:Z|[+-]\d{2}:?\d{2}|UTC|[A-Z][a-z]+\/[A-Za-z_]+)\)?$/;
    const r = prng(0xa110);
    const wrong: string[] = [];
    for (let i = 0; i < 3000; i++) {
      const on = r() < 0.3;
      const words: string[] = Array.from({ length: int(r, 0, 4) }, () => pick(r, FILLER));
      words.splice(int(r, 0, words.length), 0, on ? pick(r, ON_LIST) : pick(r, OFF_LIST));
      const text = words.join(' ');
      const said = saidOf(text);
      // An ISO time the generator happened to follow with an IANA name IS an allow-listed form.
      const zoned = /\d{2}:\d{2}\s+(?:Asia|Europe)\//.test(text);
      if (!on && !zoned && said.length > 0)
        wrong.push(`${JSON.stringify(text)} said with no allow-listed form`);
      for (const m of said) {
        if (!LOOKBACK.test(m.quote) && !ISO_ZONED.test(m.quote)) {
          wrong.push(`${JSON.stringify(text)} said ${JSON.stringify(m.quote)}`);
        }
      }
    }
    expect(wrong.slice(0, 20)).toEqual([]);
  });

  it('the position rule: an allow-listed span is said only when it ends its clause', () => {
    // Terminal controls — nothing but spaces and closing marks after the span, then a clause end.
    const TERMINAL = [
      'any errors in the last 2 hours?', 'show the past week.',
      '2026-09-26T08:00-07:00/2026-09-26T08:40-07:00', 'errors (last 2 hours)?', '“last 2 hours.”',
      'no errors in the last 2 hours?', 'Show the last 2 hours. Chart it by host',
      'errors from 2026-10-09T08:00Z to 2026-10-09T09:00Z', 'errors over the last 40 minutes',
    ] as const; // prettier-ignore
    for (const text of TERMINAL) expect(saidOf(text), text).toHaveLength(1);
    // `within` is no lead-in: the leftover scan counts it (`within 2 hours of the deploy`).
    expect(saidOf('errors within the last 40 minutes')).toEqual([]);
    // The trade-off: anything after the span in its clause confirms, the reading and zone shown.
    const [row] = rowsOf('errors in the last 2 hours on node 11');
    expect(row).toMatchObject({
      quote: 'last 2 hours',
      confirmNeeded: { form: true },
      choice: { by: 'open', open: ['confirm'] },
    });
    expect(timeAskOf(row!, defaultTimeAskMessages)?.question).toMatch(/“last 2 hours”/);
  });

  it('property: an allow-listed span followed by any non-empty tail in its clause is never said', () => {
    const SPANS = [
      'last 2 hours', 'the past week', 'past 30 minutes', 'the last day', 'LAST 24 HOURS',
      '2026-10-09T08:00Z', '2026-10-09T08:00-07:00', '2026-10-09T08:00 America/Los_Angeles',
      '2026-10-09T08:00Z/2026-10-09T09:00Z',
    ] as const; // prettier-ignore
    const LEADS = ['', 'errors ', 'any errors in ', 'logs for ', 'show '] as const;
    // No clause end in the tail (`.` `?` `!` `;` newline) — it stays in the span's clause.
    const ALPHABET = 'abcdefghijklmnopqrstuvwxyz ABCZ,:()"\'-/&*#+=<>~0123456789_…»→é京'.split('');
    const r = prng(0x7a11);
    const wrong: string[] = [];
    for (let i = 0; i < 4000; i++) {
      const span = pick(r, SPANS);
      const body = Array.from({ length: int(r, 1, 14) }, () => pick(r, ALPHABET)).join('');
      // Non-empty: at least one character that is no space or closing mark.
      if (!/[^\s)\]"'’”]/.test(body)) continue;
      const tail = (r() < 0.5 ? ' ' : '') + body;
      const text = `${pick(r, LEADS)}${span}${tail}${pick(r, ['', '.', '?', '\nthanks'])}`;
      // The span's own mention — a tail that extends it (`/2026-…`) is a different quote.
      const at = text.indexOf(span);
      const own = spansOf(text).findIndex((s) => s.start === at && s.end === at + span.length);
      if (own === -1) continue;
      const quote = read(text).mentions[own]!.quote;
      if (saidOf(text).some((m) => m.quote === quote)) wrong.push(JSON.stringify(text));
    }
    expect(wrong.slice(0, 20)).toEqual([]);
  });

  it('the known limit: a following sentence that bends the look-back without a bending word', () => {
    // A clause end closes the span's clause; the next one is checked only for its FIRST word.
    // Recorded, not hidden — the paid bench measures how often a person writes it.
    expect(saidOf('Show the last 2 hours. Only the outage window.').map((r) => r.quote)).toEqual([
      'last 2 hours',
    ]);
  });

  it('a lone mark inside a word is no range; between two readings it is', () => {
    expect(saidOf('check-in errors in the last 2 hours')).toHaveLength(1);
    expect(saidOf('and/or last 2 hours')).toHaveLength(1);
    expect(read('check-in errors yesterday').mentions[0]!.leftover).toBeUndefined();
    expect(saidOf('yesterday/today')).toEqual([]);
    expect(saidOf('last 2 hours/last 3 hours')).toEqual([]);
  });

  // The generator's dimensions: a v1 phrase, a separator, an opener, a time-like tail.
  const NEAR = [
    '8:40 AM', '8:40AM', '8:40', '20:40', '14:00', 'yesterday 8:40 PM', 'yesterday 20:40',
    '10/09/26 8 AM', '8 AM PST', '2026-10-09T08:00', 'yesterday', 'today', '10/01/26',
    '2026-10-01', 'last 40 minutes', 'YESTERDAY', 'Today',
  ] as const; // prettier-ignore
  const SEPARATORS = [
    ' to ', ' until ', ' till ', ' through ', ' thru ', '-', ' - ', '–', ' – ', '—', ' — ',
    ' til ', " 'til ", ' ’til ', ' through to ', ' up to ', ' up until ', ' onto ', ' -> ', ' → ',
    ' ~ ', ' ～ ', ' .. ', ' ... ', ' … ', '‐', '‒', '―', '−', ' ‐ ', ' − ', ' and ', ', ',
    ', to ', ' or ', ' ', '\n', ' + ', ' then ', ', Till ', '. Until ', '\nTill ', ', Then ',
    ' & ', ' / ', ' plus ', '\nEnd: ', ', And ', ' TO ', ' THRU ',
  ] as const; // prettier-ignore
  const OPENERS = [
    '', 'a ', 'an ', 'about ', 'approx. ', 'ca. ', 'c. ', 'like ', 'probably ', 'just before ',
    'sometime around ', '(', '"', '[', ': ', 'the ', 'right ',
  ] as const; // prettier-ignore
  /** Tails no v1 row reads on their own — every one carries a time-like token. */
  const TAILS = [
    '9', '21', '09', '9.30', '21.30', '930', '0930', '1600', '21h30', '9h', '9hrs', '9 hours',
    'nine', 'Nine', 'nine thirty', 'half past nine', 'quarter to ten', 'quarter past nine',
    'the 9th', 'the tenth', 'the ninth', '9ish', '9:30.5', '９:３０', '+1h', 'T09:30', '3 retries',
    'now', 'nowish', 'present', 'EOD', 'end of day', 'close of business', 'close', 'lunch',
    'sunset', 'noonish', 'the day after', 'tomorrow morning', 'Friday', 'noon', 'midnight', 'one',
    'twelve', 'May 3', '10.09.26', 'april', 'june', 'august', 'sat', 'wed', 'sun', 'SAT', 'MAY',
    'tonite', 'an hr', 'a min', 'a sec', 'fifty', 'late', 'then',
  ] as const; // prettier-ignore
  const ENDS = ['', '.', '?', ', thanks', ' for checkout. Then stop', ' please'] as const;
  /** A bare hyphen run into an ISO phrase is part of its token (`…T08:00-09` is an offset), not a separator. */
  const offsetRun = (near: string, sep: string, opener: string) =>
    /^\d{4}-\d{2}-\d{2}/.test(near) && /^[-‐‒―−–—]$/.test(sep) && opener === '';

  /**
   * The property: a mention filed as said only when (1) the tail — time-like
   * by construction — lies inside some mention (a range read whole, or an
   * unreadable mention of its own), and (2) the ORACLE finds nothing
   * time-like outside every mention.
   */
  const wrongOf = (text: string, tail: string): string | undefined => {
    if (saidOf(text).length === 0) return undefined;
    const at = text.lastIndexOf(tail);
    const covered = spansOf(text).some((s) => s.start <= at && at + tail.length <= s.end);
    const rest = outsideMentions(text);
    if (covered && !ORACLE.test(rest)) return undefined;
    return `${JSON.stringify(text)} → ${JSON.stringify(read(text).mentions)}`;
  };

  it('every v1 phrase × separator × time-like tail (and reversed): said only when nothing is left', () => {
    const wrong: string[] = [];
    let n = 0;
    for (const near of NEAR) {
      for (const sep of SEPARATORS) {
        for (const tail of TAILS) {
          if (offsetRun(near, sep, '')) continue;
          for (const end of ENDS) {
            n++;
            const w1 = wrongOf(`Show client activity ${near}${sep}${tail}${end}`, tail);
            if (w1 !== undefined) wrong.push(w1);
            const w2 = wrongOf(`Show client activity ${tail}${sep}${near}${end}`, tail);
            if (w2 !== undefined) wrong.push(w2);
          }
        }
      }
    }
    expect(n).toBeGreaterThan(40_000);
    expect(wrong.slice(0, 20)).toEqual([]);
    // ~80 000 readings: a coverage matrix, not a latency budget (that is `performance` below).
  }, 30_000);

  it('every opener between the separator and the tail: said only when nothing is left', () => {
    const wrong: string[] = [];
    for (const near of ['8:40 AM', '14:00', 'yesterday 8:40 PM', '10/09/26 8 AM', 'yesterday']) {
      for (const sep of SEPARATORS) {
        for (const opener of OPENERS) {
          for (const tail of TAILS) {
            if (offsetRun(near, sep, opener)) continue;
            const w = wrongOf(`${near}${sep}${opener}${tail}`, tail);
            if (w !== undefined) wrong.push(w);
          }
        }
      }
    }
    expect(wrong.slice(0, 20)).toEqual([]);
  });

  it('seeded messages with filler words: said only when nothing is left', () => {
    const r = prng(0x7c1a);
    const FILLER = ['please', 'the', 'logs', 'for', 'just', 'like', 'maybe', 'errors', 'deploy'];
    const wrong: string[] = [];
    for (let i = 0; i < 4000; i++) {
      const words = Array.from({ length: int(r, 0, 2) }, () => pick(r, FILLER));
      const near = pick(r, NEAR);
      const sep = pick(r, SEPARATORS);
      if (offsetRun(near, sep, '')) continue;
      const tail = pick(r, TAILS);
      const far = [...words, pick(r, OPENERS) + tail].join(' ');
      const text = (r() < 0.5 ? `${near}${sep}${far}` : `${far}${sep}${near}`) + pick(r, ENDS);
      const w = wrongOf(text, tail);
      if (w !== undefined) wrong.push(w);
    }
    expect(wrong.slice(0, 20)).toEqual([]);
  });

  it('two v1 phrases over the grammar’s connectors read as ONE range, the person’s words', () => {
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
      ]) {
        const text = `Show client activity ${near}${c}9:30 PM`;
        const [m, ...rest] = read(text).mentions;
        expect(rest, text).toEqual([]);
        expect(m!.problem, text).toBeUndefined();
        expect(m!.leftover, text).toBeUndefined();
        expect(m!.parses[0]!.rangeOf, text).toHaveLength(2);
      }
    }
  });

  it('…over any other separator, each is confirmed — never said', () => {
    for (const sep of [' til ', ' → ', ' ~ ', '‐', ' − ', ' and ', ' & ', ' / ', ' … ']) {
      const text = `8:40 AM${sep}9:30 PM`;
      expect(read(text).mentions.length, text).toBeGreaterThan(0);
      expect(saidOf(text), text).toEqual([]);
    }
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
      confirm: true,
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

  it('`from … to` and `from <day>` still read; a number beside a time is confirmed (the leftover rule)', () => {
    expect(read('9 AM and 3 retries').mentions).toEqual([
      {
        quote: '9 AM',
        parses: [{ wall: { h: 9, meridiem: 'am' } }],
        leftover: ['and', '3'],
        confirm: true,
      },
    ]);
    expect(read('from 8 AM to 9 AM').mentions[0]).toMatchObject({ quote: '8 AM to 9 AM' });
    expect(read('from 8 AM to 9 AM').mentions[0]!.problem).toBeUndefined();
    // `from` with no `to` may open a window (`from yesterday` on): confirmed, never said.
    expect(read('logs from yesterday').mentions).toEqual([
      {
        quote: 'yesterday',
        parses: [{ relative: { unit: 'day', offset: -1 } }],
        leftover: ['from'],
        confirm: true,
      },
    ]);
    expect(read('errors 500-503 yesterday').mentions).toEqual([
      {
        quote: 'yesterday',
        parses: [{ relative: { unit: 'day', offset: -1 } }],
        leftover: ['500', '-', '503'],
        confirm: true,
      },
    ]);
  });

  it('the port checks a leftover: only beside parses, each token verbatim in the text', () => {
    const parses = [{ relative: { unit: 'day', offset: -1 } }];
    const check = (mention: object) =>
      checkReading('yesterday til 9', { mentions: [mention] }, 'fixture')[0];
    expect(check({ quote: 'yesterday', parses, leftover: ['til', '9'] })).toEqual({
      quote: 'yesterday',
      parses,
      leftover: ['til', '9'],
    });
    expect(check({ quote: 'yesterday', parses, leftover: ['until'] })).toEqual({
      refused: 'malformed',
    });
    expect(check({ quote: 'yesterday', parses, leftover: [] })).toEqual({ refused: 'malformed' });
    expect(
      check({ quote: 'yesterday', parses: [], problem: 'unreadable', leftover: ['9'] }),
    ).toEqual({ refused: 'malformed' });
  });

  it('an incomplete reading’s row: `confirmNeeded`, `said: []`, and a choice left open to confirm', () => {
    const text = '8:40 AM til 9.30';
    const [row] = timeReadingRows({
      mentions: checkReading(text, read(text), reader.id),
      clock: { now: CLOCK.now, nowSource: 'app', zone: LA, zoneSource: 'app' } as never,
      policy: DEFAULT_TIME_POLICY,
      reader: { id: reader.id, version: reader.version, kind: 'rule', locale: 'en-US' },
      tzdata: 'test',
      at: { turn: 1, iteration: 1 },
    });
    expect(row).toMatchObject({
      quote: '8:40 AM',
      confirmNeeded: { leftover: ['til', '9.30'], point: true },
      choice: { by: 'open', open: ['confirm'] },
    });
    expect(row!.candidates!.every((c) => c.said.length === 0)).toBe(true);
    expect(timeRowIsWellFormed(row as never)).toBe(true);
    // The record's check refuses an empty or unknown-keyed `confirmNeeded`.
    for (const confirmNeeded of [
      { leftover: [] },
      { leftover: ['til'], extra: 1 },
      { leftover: [''] },
      {},
      { point: false },
      { several: 1 },
      { form: false },
    ]) {
      expect(timeRowIsWellFormed({ ...row, confirmNeeded } as never)).toBe(false);
    }
    for (const confirmNeeded of [
      { point: true },
      { several: true },
      { leftover: ['til'], point: true },
      { form: true },
      { leftover: ['til'], point: true, several: true, form: true },
    ]) {
      expect(timeRowIsWellFormed({ ...row, confirmNeeded } as never)).toBe(true);
    }
    const ask = timeAskOf(row!, defaultTimeAskMessages);
    expect(ask?.question).toBe(
      'I read only “8:40 AM” as a time, not “til 9.30”. Is this the window you mean?',
    );
    expect(ask?.field.labels?.[0]).toMatch(/^I read .+ — is that the window you mean\?$/);
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
