/**
 * The careful English reader (time design § 5.3, step T6b) — a tokenizer over
 * the v1 phrases, "unreadable" for every other time phrase it recognises. The
 * field sentences are the table; what `resolve.ts`, the policy and the ask
 * make of the parts is asserted beside them.
 *
 * Law: the reader TOKENIZES — parts and a verbatim quote, never an instant, a
 * date order, a zone mapping or a refusal of the future; a phrase v1 does not
 * read is one `unreadable` mention quoting the whole phrase; and NO reading is
 * ever the person's words (the owner's decision "Always confirm", time design
 * TQ29): every readable mention is a PROPOSAL the time ask offers, pre-filled
 * with its window and its zone.
 *
 * Test types:
 *   functional  — every v1 row of § 5.3 → its parts; every non-v1 row → "unreadable"; the field
 *                 sentences end to end through resolve, choose and the ask ("10/09/26 8 AM to
 *                 8:40 AM PST" → a zone ask for `PST`, then three date orders, `MDY` → PDT;
 *                 "yesterday"; a future date refused by a `past` tool's facts);
 *   always confirm — every row the seven review rounds cited, and every form the earlier
 *                 allow-list filed as said ("last 2 hours", an explicit ISO instant), is a
 *                 confirmation (or unreadable) as the RECORD files it (`rows.ts` ·
 *                 `timeReadingRows`), never said and never a settled window; each proposal is
 *                 offered with its window and zone; a seeded property over phrase × separator ×
 *                 tail finds no row said;
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
import { timeAskOf } from '../../../src/core/time/readingAsk.js';
import { timeRowIsWellFormed } from '../../../src/core/time/rows.js';
import { timeReadingRows } from '../../../src/core/time/rowsBuild.js';
import { turnWindowsOf } from '../../../src/core/time/bind.js';
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
        wall: { h: 8, m: 0, clock: '24h' },
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
            wall: { h: 8, m: 0, clock: '24h' },
            zoneToken: 'Z',
          },
          {
            date: { kind: 'fixed', year: 2026, month: 10, day: 9 },
            wall: { h: 9, m: 0, clock: '24h' },
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
    // A range whose other side is no v1 time is not here: its v1 side is read and PROPOSED
    // (below) — never filed as said.
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

// ─── a reading only PROPOSES (the owner's decision "Always confirm", TQ29) ───

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

type Row = ReturnType<typeof rowsOf>[number];

/**
 * What the RECORD files as the person's words: a row the library settled
 * (`only` / `policy`), or a candidate carrying `said` parts, or a window the
 * turn's walker would fill from (`bind.ts` · `turnWindowsOf`). Must be empty
 * for every message — only the time ask's answer is the person's.
 */
function saidOf(text: string): string[] {
  const rows = rowsOf(text);
  const settled = rows.flatMap((r) =>
    r.choice?.by === 'only' ||
    r.choice?.by === 'policy' ||
    (r.candidates ?? []).some((c) => c.said.length > 0)
      ? [r.quote ?? '?']
      : [],
  );
  const windows = turnWindowsOf(rows, undefined).windows.map((w) => w.quote ?? '?');
  return [...settled, ...windows];
}

/**
 * A readable row is a PROPOSAL: open with `confirm` (or asking its zone first),
 * nothing said — or it resolves to no window at all (`none`: nothing to offer,
 * nothing filed). An unreadable row is `none / unreadable`.
 */
function isProposal(row: Row): boolean {
  const choice = row.choice;
  if (choice?.by === 'none') return (row.candidates ?? []).length === 0;
  return (
    choice?.by === 'open' &&
    (choice.open.includes('confirm') || choice.open.includes('zone')) &&
    (row.candidates ?? []).every((c) => c.said.length === 0)
  );
}

describe('a reading only PROPOSES — never the person’s words (the owner’s decision “Always confirm”)', () => {
  // Every row the seven review rounds cited — and the forms the earlier allow-list filed as said:
  // each is a confirmation (or unreadable), never said.
  const CITED = [
    // the forms rounds 6–7 still filed as said: a look-back from now and an explicit ISO instant
    'any errors in the last 2 hours?', 'show the past week.', 'Show client activity for the last 40 minutes',
    'errors in the past 24 hours', 'errors in the last hour', 'errors over the past week',
    'errors 2026-10-09T08:00-07:00', 'errors 2026-10-09T08:00Z/2026-10-09T09:00Z',
    'errors 2026-10-09T08:00 America/Los_Angeles', 'check-in errors in the last 2 hours',
    'and/or last 2 hours', 'no errors in the last 2 hours?', 'Show the last 2 hours. Only the outage window.',
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
    it(`${JSON.stringify(text)} → a confirmation (or unreadable), never said`, () => {
      const rows = rowsOf(text);
      expect(rows.some((r) => r.quote !== undefined)).toBe(true);
      for (const row of rows) if (row.quote !== undefined) expect(isProposal(row), text).toBe(true);
      expect(saidOf(text)).toEqual([]);
    });
  }

  it('the reader returns parts and quotes only — no confirm flag, no leftover list', () => {
    expect(read('8:40 AM til 9.30').mentions).toEqual([
      { quote: '8:40 AM', parses: [{ wall: { h: 8, m: 40, meridiem: 'am' } }] },
    ]);
    expect(read('errors in the last 2 hours').mentions).toEqual([
      { quote: 'last 2 hours', parses: [{ relative: { unit: 'hour', count: 2 } }] },
    ]);
  });

  it('every proposal is offered pre-filled with its window AND its zone, free entry open', () => {
    for (const text of [
      'any errors in the last 2 hours?',
      'errors yesterday?',
      'errors 2026-10-09T08:00-07:00',
      '8:40 AM til 9.30',
    ]) {
      const [row] = rowsOf(text);
      const ask = timeAskOf(row!, defaultTimeAskMessages);
      expect(ask?.question, text).toBe(`Is this the time you meant by “${row!.quote}”?`);
      expect(ask?.field.format, text).toBe('time-range');
      expect(ask?.field.enum?.length, text).toBeGreaterThan(0);
      for (const label of ask?.field.labels ?? []) {
        expect(label, text).toContain(`I read “${row!.quote}” as `);
        expect(label, text).toContain(`in ${LA} — is that right?`);
      }
      expect((ask?.field as { strict?: boolean }).strict, text).toBeUndefined();
    }
  });

  it('“last 2 hours” is offered as the look-back ending now, in the run’s zone', () => {
    const [row] = rowsOf('any errors in the last 2 hours?');
    expect(row!.choice).toEqual({ by: 'open', remaining: [0], open: ['confirm'] });
    // Half-open, so `now` itself is inside the look-back.
    expect(row!.candidates![0]!.range).toEqual({
      from: '2026-10-09T13:40:00Z',
      to: '2026-10-09T15:40:00.001Z',
    });
    expect(row!.candidates![0]!.zone).toBe(LA);
  });

  // The generator's dimensions: a v1 phrase, a separator, an opener, a tail.
  const NEAR = [
    '8:40 AM', '14:00', 'yesterday 8:40 PM', '10/09/26 8 AM', '8 AM PST', '2026-10-09T08:00',
    'yesterday', 'today', '2026-10-01', 'last 40 minutes', 'the past week', '2026-10-09T08:00-07:00',
  ] as const; // prettier-ignore
  const SEPARATORS = [
    ' to ', ' until ', '-', ' – ', ' til ', ' -> ', ' ~ ', ' .. ', ' and ', ', ', ' ', '\n', ' / ',
    '. ', '; ', ' then ', ', Till ',
  ] as const; // prettier-ignore
  const TAILS = [
    '9', '9.30', '1600', 'nine', 'half past nine', 'the 9th', 'now', 'EOD', 'the outage',
    'on node 11', 'London time', 'in Tokyo', 'please', '3 retries', 'Friday', 'give or take', '',
  ] as const; // prettier-ignore

  it('property: seeded messages — every readable row is a proposal; nothing is ever said', () => {
    const r = prng(0x7c1a);
    const FILLER = ['please', 'the', 'logs', 'for', 'errors', 'in', 'show', 'any'];
    const wrong: string[] = [];
    for (let i = 0; i < 1500; i++) {
      const words = Array.from({ length: int(r, 0, 3) }, () => pick(r, FILLER)).join(' ');
      const near = pick(r, NEAR);
      const tail = pick(r, TAILS);
      const text = r() < 0.5 ? `${words} ${near}${pick(r, SEPARATORS)}${tail}` : `${tail} ${near}`;
      if (saidOf(text).length > 0) wrong.push(text);
      for (const row of rowsOf(text)) {
        if (row.quote !== undefined && !isProposal(row)) wrong.push(`${text} (${row.quote})`);
      }
    }
    expect(wrong.slice(0, 20)).toEqual([]);
  });

  it('two v1 phrases over the grammar’s connectors read as ONE range — proposed whole', () => {
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
        expect(m!.parses[0]!.rangeOf, text).toHaveLength(2);
        expect(saidOf(text), text).toEqual([]);
      }
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

  it('`from … to` and `from <day>` still read; a time beside a number is read, and proposed', () => {
    expect(read('9 AM and 3 retries').mentions).toEqual([
      { quote: '9 AM', parses: [{ wall: { h: 9, meridiem: 'am' } }] },
    ]);
    expect(read('from 8 AM to 9 AM').mentions[0]).toMatchObject({ quote: '8 AM to 9 AM' });
    expect(read('from 8 AM to 9 AM').mentions[0]!.problem).toBeUndefined();
    expect(read('logs from yesterday').mentions).toEqual([
      { quote: 'yesterday', parses: [{ relative: { unit: 'day', offset: -1 } }] },
    ]);
    for (const text of ['9 AM and 3 retries', 'logs from yesterday', 'errors 500-503 yesterday']) {
      expect(saidOf(text), text).toEqual([]);
    }
  });

  it('the port has no confirm flag and no leftover list: a mention carrying either is malformed', () => {
    const parses = [{ relative: { unit: 'day', offset: -1 } }];
    const check = (mention: object) =>
      checkReading('yesterday til 9', { mentions: [mention] }, 'fixture')[0];
    expect(check({ quote: 'yesterday', parses })).toEqual({ quote: 'yesterday', parses });
    expect(check({ quote: 'yesterday', parses, leftover: ['til', '9'] })).toEqual({
      refused: 'malformed',
    });
    expect(check({ quote: 'yesterday', parses, confirm: true })).toEqual({ refused: 'malformed' });
  });

  it('a reading’s row: `said: []`, a choice left open to confirm, and no `confirmNeeded` key', () => {
    const [row] = rowsOf('8:40 AM til 9.30');
    expect(row).toMatchObject({ quote: '8:40 AM', choice: { by: 'open', open: ['confirm'] } });
    expect(row!.candidates!.every((c) => c.said.length === 0)).toBe(true);
    expect('confirmNeeded' in row!).toBe(false);
    expect(timeRowIsWellFormed(row as never)).toBe(true);
    const ask = timeAskOf(row!, defaultTimeAskMessages);
    expect(ask?.question).toBe('Is this the time you meant by “8:40 AM”?');
    expect(ask?.field.labels?.[0]).toMatch(
      /^I read “8:40 AM” as .+ in America\/Los_Angeles — is that right\?$/,
    );
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
      version: '1.1.0',
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
