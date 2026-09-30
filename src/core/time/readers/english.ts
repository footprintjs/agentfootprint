/**
 * core/time/readers/english — the library's careful English reader (time
 * design § 5.3): a tokenizer over a small, closed set of phrases, and
 * "unreadable" for every other time phrase it recognises.
 *
 * Pattern: Strategy behind the `TimeReader` port (`../reader.ts`). It
 *          TOKENIZES only: it returns the parts it sees and the verbatim
 *          quote. It never resolves an instant, never applies a date order,
 *          never maps a zone abbreviation and never refuses a future date —
 *          all of that is `resolve.ts`'s, the policy's or the ask's.
 * Role:    core/ leaf (the time layer). Imports only the port's types. Armed
 *          by the app: `.time({ reader: englishTimeReader() })` — there is no
 *          default reader.
 * Emits:   N/A.
 *
 * ## What it reads (the v1 rows of § 5.3)
 *
 * | Phrase | Example | Parts |
 * |--------|---------|-------|
 * | an ISO date or instant | `2026-10-09`, `2026-10-09T08:00-07:00` | `date: fixed`, `wall`, `zoneToken` |
 * | a numeric date | `10/09/26`, `10/9` | `date: numeric` — the ORDER is not decided here |
 * | a clock time | `8 AM`, `8:40`, `20:40`, `8:40 p.m.` | `wall` (a bare `8` is a time only as a range's first side: `8 to 9 AM`) |
 * | a range between two of the above | `8 AM to 8:40 AM`, `08:00–08:40`, `between 8 and 9 AM` | `rangeOf` (a day or zone said once for both sides is the whole mention's) |
 * | a zone after a time or date | `America/Los_Angeles`, `UTC-07:00`, `PST` | `zoneToken`, as written (an abbreviation is ASKED — v1 ships no map) |
 * | a day word | today, yesterday, tomorrow | `relative: { unit: 'day', offset }` |
 * | a relative span from now | last 40 minutes, past 2 hours, the last hour, the past week | `relative: { unit, count }` — a look-back in minutes, hours, days or weeks |
 *
 * ## What it says "unreadable" for — never a partial reading
 *
 * Parts of the day (`yesterday morning`, `tonight`, `noon`), calendar spans
 * (`last week`, `this month`), week days and named months (`Friday`,
 * `Oct 9`), `N hours ago`, spans in words (`last two hours`), with a unit off
 * the allow-list (`last 30 seconds`, `last 3 months`) or said with `previous`
 * (`previous 7 days` — often relative to another window), a look-ahead (`next 2 hours`), an
 * ordinal day (`the 9th`), `8 o'clock`, and any v1 phrase a modifier changes
 * (`since 8 AM`, `before yesterday`, `around 8:40`, `earlier today`,
 * `8 AM to now`, `past 8 PM`, `8 AM-ish`, `from 3 PM yesterday` with no `to`) and
 * a meridiem the number contradicts (`13:00 PM`). Such a phrase is ONE mention
 * with `problem: 'unreadable'`, quoting the whole phrase: reading `yesterday`
 * out of `yesterday morning` would silently widen what the person said.
 *
 * ## The leftover rule — the person's words only when nothing time-like is left
 *
 * ONE scan over the WHOLE message (`leftoverOf`), no clauses and no connector
 * lists: after every phrase the reader parsed is removed, is any token of a
 * broad time-or-range set left (`LEFTOVER_WORDS` — any digit in any script,
 * number and hour words, ordinals, day, relative, week day and month words,
 * units, parts of the day, range words such as `to`, `until`, `from`,
 * `between`, zone words (`time`, `utc`, the IANA areas such as `europe`, `asia`);
 * anchors, open ends, exclusions and filters (`preceding`, `prior`, `post`, `onward`,
 * `henceforth`, `excluding`, `except`, `weekdays`, `business`); `of` right after a
 * look-back (`the last 2 hours of the outage`); `..`, and ANY symbol or punctuation mark but
 * sentence punctuation, quotes and brackets — by rule, not by list — unless
 * it stands alone between two letters (`check-in`); `and`/`plus` right after
 * a time; `AM` and the zone abbreviations in capitals)? Nothing left: every reading is COMPLETE — the
 * person's words. Something left: every reading names those tokens
 * (`TimeMention.leftover`) and is CONFIRMED through the time ask, never filed
 * as said. So `8:40 AM til 9.30`, `8 AM until the deploy` and
 * `Start: 8:40 AM\nEnd: 9.30` read `8:40 AM` / `8 AM` only as a reading to
 * confirm. The price, owner-approved: a time beside an unrelated number or a
 * common word of the set (`9 AM and 3 retries`, `I want to see yesterday`,
 * `errors in the last 2 hours to date`) is confirmed, not read — an extra
 * confirmation is honest; a partial reading recorded as said is not.
 *
 * ## The allow-list — the only forms filed as the person's words
 *
 * Five review rounds showed English has an endless tail (a zone named in
 * words — `London time`, `server time`, `in Asia/Kolkata` — an event anchor,
 * an open end), so the reader TRUSTS only an allow-list and grows it from
 * evidence (`isAllowListed`): (1) a RELATIVE SPAN from now — `last|past N
 * minutes|hours|days|weeks`, `the last|past hour|day|week` (no zone needed);
 * (2) an EXPLICIT ISO-8601 instant or range whose every bound carries an
 * offset or an IANA zone (`2026-10-09T08:00-07:00`,
 * `2026-10-09T08:00Z/2026-10-09T09:00Z`). Everything else it reads — a
 * calendar word, a date or clock time without a zone, a range in words — is
 * marked `confirm` (`TimeMention.confirm`) and offered through the time ask
 * WITH ITS ZONE ("I read “yesterday” as Thu, Oct 8, 2026, PDT in
 * America/Los_Angeles — is that right?"), so a person who meant London time
 * corrects it in one answer. An allow-listed reading is said only when the
 * leftover scan finds nothing either, and the LIBRARY still confirms a point
 * time that is no explicit instant and a message with two mentions (`rows.ts`
 * · `confirmNeededOf`). What only the scan guards now is a look-back beside
 * an anchor word it does not list (`last 2 hours surrounding the outage`) —
 * the known limit, measured by the bench.
 *
 * A numeric date the tokens could split two ways stays ONE parse — `10/09/26`
 * is three numbers; which is the month is the policy's or the person's.
 *
 * @example
 * ```ts
 * const reader = englishTimeReader();
 * reader.read('errors on 10/09/26 8 AM to 8:40 AM PST', { locale: 'en-US' });
 * // { mentions: [{ quote: '10/09/26 8 AM to 8:40 AM PST', parses: [{
 * //   date: { kind: 'numeric', fields: [10, 9, 26], yearDigits: 2 }, zoneToken: 'PST',
 * //   rangeOf: [{ wall: { h: 8, meridiem: 'am' } }, { wall: { h: 8, m: 40, meridiem: 'am' } }] }],
 * //   confirm: true }] } — off the allow-list: confirmed with its zone
 * reader.read('errors in the last 2 hours', { locale: 'en-US' });
 * // { mentions: [{ quote: 'last 2 hours', parses: [{ relative: { unit: 'hour', count: 2 } }] }] }
 * reader.read('what failed yesterday morning?', { locale: 'en-US' });
 * // { mentions: [{ quote: 'yesterday morning', parses: [], problem: 'unreadable' }] }
 * reader.read('8:40 AM til 9.30', { locale: 'en-US' });
 * // { mentions: [{ quote: '8:40 AM', parses: [{ wall: { h: 8, m: 40, meridiem: 'am' } }],
 * //   leftover: ['til', '9.30'], confirm: true }] } — confirmed, never said
 * ```
 */

import {
  isTimeParts,
  MAX_LEFTOVER,
  MAX_MENTIONS,
  type TimeDate,
  type TimeMention,
  type TimeParts,
  type TimeReader,
  type TimeReading,
  type TimeRelative,
  type TimeWall,
} from '../reader.js';

// ─── The words (data) ────────────────────────────────────────────────────

/** The reader's recorded identity — on every `time-reading` row with its version. */
export const ENGLISH_TIME_READER_ID = 'agentfootprint/english';
/** Raised whenever what the reader returns for some text changes. */
export const ENGLISH_TIME_READER_VERSION = '1.0.0';

const DAY_WORDS: Readonly<Record<string, number>> = { today: 0, yesterday: -1, tomorrow: 1 };

/** The units a look-back is read in — the allow-listed spans (`rows.ts` · `isSaidForm`). */
const SPAN_UNITS: Readonly<Record<string, 'minute' | 'hour' | 'day' | 'week'>> = {
  minute: 'minute',
  min: 'minute',
  hour: 'hour',
  hr: 'hour',
  day: 'day',
  week: 'week',
};

/** Zone abbreviations the reader TOKENIZES after a time or a date — never maps (§ 5.3). */
const ZONE_ABBREVIATIONS = [
  'UTC', 'GMT', 'PST', 'PDT', 'PT', 'MST', 'MDT', 'MT', 'CST', 'CDT', 'CT', 'EST', 'EDT', 'ET',
  'AKST', 'AKDT', 'HST', 'AST', 'ADT', 'NST', 'NDT', 'BST', 'IST', 'CET', 'CEST', 'EET', 'EEST',
  'WET', 'WEST', 'MSK', 'JST', 'KST', 'HKT', 'SGT', 'AEST', 'AEDT', 'ACST', 'ACDT', 'AWST',
  'NZST', 'NZDT', 'SAST',
] as const; // prettier-ignore

const IANA_AREAS =
  'Africa|America|Antarctica|Arctic|Asia|Atlantic|Australia|Europe|Indian|Pacific|Etc';
const UNIT_WORDS =
  'seconds?|secs?|minutes?|mins?|hours?|hrs?|days?|weeks?|months?|years?|quarters?';
const NUMBER_WORDS =
  'an?|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|fifteen|twenty|thirty|' +
  'forty|fifty|sixty|ninety|few|several|couple(?:\\s+of)?';
const MONTHS =
  'jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|june?|july?|aug(?:ust)?|' +
  'sep(?:t(?:ember)?)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?';

/**
 * Time phrases v1 does not read (§ 5.3's "later" rows and everything past
 * them). Each forms an `unreadable` mention on its own, and taints any v1
 * phrase it touches.
 */
const NOT_READ: readonly RegExp[] = [
  /\b(?:(?:this|last|early|late|mid)\s+)?(?:morning|afternoon|evening|night|tonight|overnight|noon|midday|midnight|lunchtime|dawn|dusk)s?\b/gi,
  /\b(?:last|this|next|past|previous|coming|current)\s+(?:week|month|year|quarter|weekend|hour|minute|second|day|night|decade|fortnight|shift)\b/gi,
  /\bweekends?\b/gi,
  /\b(?:monday|tuesday|wednesday|thursday|friday|saturday|sunday)s?\b/gi,
  new RegExp(`\\b(?:${MONTHS})\\.?\\s+\\d{1,2}(?:st|nd|rd|th)?\\b(?:,?\\s+\\d{4}\\b)?`, 'gi'),
  new RegExp(
    `\\b\\d{1,2}(?:st|nd|rd|th)?\\s+(?:of\\s+)?(?:${MONTHS})\\b\\.?(?:,?\\s+\\d{4}\\b)?`,
    'gi',
  ),
  /\b(?:january|february|july|september|october|november|december)\b/gi,
  new RegExp(`\\b(?:\\d+|${NUMBER_WORDS})\\s+(?:${UNIT_WORDS})\\s+ago\\b`, 'gi'),
  new RegExp(
    `\\b(?:last|past|previous|next|coming|upcoming|following)\\s+` +
      `(?:(?:${NUMBER_WORDS}|\\d+)\\s+)?(?:${UNIT_WORDS})\\b`,
    'gi',
  ),
  /\b(?:the\s+)?day\s+(?:before\s+yesterday|after\s+tomorrow)\b/gi,
  /\bon\s+the\s+\d{1,2}(?:st|nd|rd|th)\b/gi,
  /\bthe\s+\d{1,2}(?:st|nd|rd|th)\s+of\b/gi,
  /\b\d{1,2}\s*o['’]?\s?clock\b/gi,
  // A meridiem on a number that is no 12-hour time (`13:00 PM`, `0 AM`): the words contradict.
  /(?<![\w:.+/])\d{1,2}(?::\d{2}){0,2}\s?(?:am|pm|a\.m\.|p\.m\.)(?![a-z])/gi,
];

// ─── The range grammar (one owner) ──────────────────────────────────────
//
// The connectors a v1 range is READ with — an allow-list, the grammar's own:
// the joins (`joins`), the bare hour's lookahead (`BARE_HOUR`) and `… to now`
// (`MODIFIER_AFTER`) all build from it. It never decides what is left
// unread: that is the leftover rule below, which needs no connector list.

const RANGE_WORDS = 'to|until|till|through|thru';
/** A range connector the grammar reads: a word, or a hyphen, en dash or em dash. */
const RANGE_CONNECTOR = `(?:(?:${RANGE_WORDS})(?![a-z])|[–—-])`;

/** A word right before a phrase that changes what it means: the phrase is not read. */
const MODIFIER_BEFORE = new RegExp(
  '(?:^|[^\\w])(since|before|after|by|around|circa|approx(?:imately)?|until|till|earlier|later|' +
    'early|late|within|past|beyond|prior\\s+to|up\\s+to|no\\s+(?:later|earlier|sooner)\\s+than|' +
    'as\\s+of|(?:starting|beginning)(?:\\s+(?:at|from|on))?|~)\\s*$',
  'i',
);
/** `from` with no `to`: a time after it is where a window STARTS (`from 3 PM yesterday`), not an hour. */
const FROM_BEFORE = /(?:^|[^\w])(from)\s*$/i;
/** …and right after it. */
const MODIFIER_AFTER = new RegExp(
  '^(?:\\s*-?\\s*ish\\b|\\s*(?:ago\\b|onwards?\\b|or\\s+so\\b|(?:or|and)\\s+(?:later|earlier|after|before)\\b|' +
    `at\\s+the\\s+(?:latest|earliest)\\b|${RANGE_CONNECTOR}\\s*now\\b))`,
  'i',
);

// ─── The leftover rule ───────────────────────────────────────────────────
//
// ONE rule over the WHOLE message, no clauses and no connector lists: after
// every span the reader parsed is removed (read or unreadable), is anything
// time-like left? Nothing left: each reading is COMPLETE — the person's words.
// Something left: each reading names those tokens (`TimeMention.leftover`) and
// is confirmed through the time ask, never filed as said. Three rounds of a
// grammar that tried to prove it read a whole range each leaked the next
// spelling (a clause mark before a capital, a range to an event, a pasted
// `Start: … End: …`); a broad scan cannot be exact, so it only has to be
// CONSERVATIVE — a word that is sometimes not time-like (`to`, `may`, `second`)
// costs a confirmation, never a partial reading recorded as said.

/** Time-or-range words, case-insensitive, `-ish` allowed — data, one list. */
const LEFTOVER_WORDS = [
  // numbers and hours in words, and the ordinals a day is said with
  'zero|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|thirteen|fourteen|fifteen',
  'sixteen|seventeen|eighteen|nineteen|twenty|thirty|forty|fifty|sixty|noon|midday|midnight|half',
  'quarter|first|second|third|fourth|fifth|sixth|seventh|eighth|ninth|tenth|eleventh|twelfth',
  'thirteenth|fourteenth|fifteenth|sixteenth|seventeenth|eighteenth|nineteenth|twentieth|thirtieth',
  // days, relative words and spans
  'today|tomorrow|yesterday|tonight|tonite|tmrw|tmr|tmw|yday|yest|days?|daily|weekends?|weeks?',
  'fortnights?|months?|years?|decades?|quarters?|seconds?|secs?|minutes?|mins?|hours?|hrs?',
  'last|next|previous|past|ago|since|before|after|then|earlier|later|early|late|now|present',
  'current|recent|recently|during|within|about|around|approx|approximately|roughly|circa|ish',
  // anchors, open ends and exclusions a reading does not carry
  'preceding|following|prior|pre|post|onwards?|forwards?|hence|henceforth|thereafter|thenceforth',
  'excluding|except|excl|outside|weekdays?|workdays?|weeknights?|business|working',
  // week days and months, whole and short
  '(?:mon|tues|wednes|thurs|fri|satur|sun)days?|mon|tue|tues|wed|weds|thu|thur|thurs|fri|sat|sun',
  'january|february|march|april|may|june|july|august|september|october|november|december',
  'jan|feb|mar|apr|jun|jul|aug|sep|sept|oct|nov|dec',
  // parts of the day, and the ends of one
  'eod|eob|cob|eow|eom|mornings?|afternoons?|evenings?|nights?|overnight|lunch|lunchtime|breakfast',
  'dinner|sunrise|sunset|dawn|dusk|daybreak|nightfall|close|closing|shift|pm',
  // range words
  'to|until|till|til|through|thru|between|from|onto|unto|upto',
  // zone words — a zone said in words (`London time`, `server time`) or an IANA area
  'pacific|eastern|central|mountain|zone|zones|timezone|time|utc|gmt|local',
  'africa|america|antarctica|arctic|asia|atlantic|australia|europe|indian',
].join('|');
/**
 * The marks the scan does NOT count: sentence punctuation, quotes and
 * brackets. Every other symbol or punctuation mark (`\p{S}`, `\p{P}`) counts
 * — by RULE, not by list: a dash, an arrow of any block, `>`, `<`, `≥`, `=`,
 * `|`, `»`, `~`, `…`, `+`, `/`, `&`, `_` alike. `:` is not counted (`Start:`);
 * a message it joins holds two mentions, which confirms on its own
 * (`rows.ts` · `confirmNeededOf`).
 */
const NEUTRAL_MARKS = '.,;:!?\'"()\\[\\]’‘“”';
/** One counted mark: a symbol or punctuation mark outside {@link NEUTRAL_MARKS}. */
const COUNTED_MARK = `(?![${NEUTRAL_MARKS}])[\\p{S}\\p{P}]`;
/**
 * What the scan counts: a digit run in any script (`9.30` is one token), a
 * word of {@link LEFTOVER_WORDS}, a dotted meridiem, `o'clock`, `..`, and any run
 * of {@link COUNTED_MARK} (`->` is one token). Lower-case `am` is not counted: it is English, and a
 * meridiem is only ever said with a number, which the scan counts already.
 */
const LEFTOVER = new RegExp(
  '\\p{Nd}+(?:[.:,]\\p{Nd}+)*' +
    `|\\b(?:${LEFTOVER_WORDS})(?:-?ish)?\\b` +
    "|\\b[ap]\\.m\\b\\.?|\\bo['’]?\\s?clock\\b" +
    `|\\.\\.+|(?:${COUNTED_MARK})+`,
  'giu',
);
/** Time-like only in capitals: `AM` (`am` is English) and the zone abbreviations. */
const LEFTOVER_CASED = new RegExp(`\\b(?:AM|${ZONE_ABBREVIATIONS.join('|')})\\b`, 'gu');
/** A word that joins a range or a sum — counted only right after a time (`8 AM and the deploy`). */
const JOINER = /\b(?:and|plus|minus)\b/giu;
/**
 * `of` right after a look-back anchors it to an event (`the last 2 hours of the
 * outage`), not to now — counted only there (`last 7 days of data` confirms).
 */
const SPAN_OF = /^\s+(of)\b/i;
/** A lone mark between two letters is part of a word (`check-in`, `and/or`, `request_id`), not a range. */
const MARK = new RegExp(`^${COUNTED_MARK}$`, 'u');
const LETTER = /\p{L}/u;
/** What may stand between a time and the joiner after it. */
const BETWEEN_JOIN = /[\s,;:()"'[\]]/u;
/** The range's opener the grammar reads before its first side — consumed with the range. */
const RANGE_OPENER = /(?:^|[^\w])((?:from|between)\s+)$/i;
/** Longest leftover token recorded — the port's token bound. */
const MAX_LEFTOVER_TOKEN = 64;

// ─── The v1 phrases ──────────────────────────────────────────────────────

/** One v1 phrase found in the text: its span and the parts it says. */
interface Atom {
  readonly start: number;
  end: number;
  readonly kind: 'instant' | 'date' | 'wall' | 'bare' | 'day' | 'span';
  readonly date?: TimeDate;
  readonly wall?: TimeWall;
  readonly relative?: TimeRelative;
  zoneToken?: string;
}

/** Text not preceded by something that would make these digits part of a larger token. */
const NOT_AFTER = '(?<![\\w:./-])';
/**
 * The same for a clock time — which may follow a range's hyphen (`8:00-8:40`)
 * or `..` (`2026-09-26 08:00..08:40`), never an offset's sign or one dot.
 */
const TIME_NOT_AFTER = '(?<![\\w:+/])(?<!(?:^|[^.])\\.)';

const ISO = new RegExp(
  // An ISO interval's second end follows its first's `/` (`…08:00Z/2026-…`) or `..`; a path's `/` does not count.
  `(?<![\\w:-])(?<!(?:^|[^.])\\.)(?<![^\\dZ]/)(?<!^/)(\\d{4})-(\\d{2})-(\\d{2})` +
    '(?:[Tt ](\\d{2}):(\\d{2})(?::(\\d{2}))?(Z|[+-]\\d{2}(?::?\\d{2})?)?)?' +
    '(?![\\w:]|[.-]\\d)',
  'g',
);
const NUMERIC = new RegExp(
  // A hyphen may join two dates (`10/01/26-10/09/26`).
  `(?<![\\w:./])(\\d{1,4})/(\\d{1,2})(?:/(\\d{4}|\\d{2}))?(?![\\w/:]|\\.\\d)`,
  'g',
);
const WALL_MERIDIEM = new RegExp(
  `${TIME_NOT_AFTER}(\\d{1,2})(?::(\\d{2})(?::(\\d{2}))?)?\\s?(am|pm|a\\.m\\.|p\\.m\\.)(?![a-z])`,
  'gi',
);
const WALL_COLON = new RegExp(
  // A meridiem after it is `WALL_MERIDIEM`'s — or, when that refuses it (`13:00 PM`), unreadable.
  `${TIME_NOT_AFTER}(\\d{1,2}):(\\d{2})(?::(\\d{2}))?(?![\\d:])(?!\\s?(?:am|pm|a\\.m\\.|p\\.m\\.)(?![a-z]))`,
  'gi',
);
/** A bare hour — a time only as a range's first side whose second side carries a meridiem. */
const BARE_HOUR = new RegExp(
  `${NOT_AFTER}(\\d{1,2})(?=\\s*(?:${RANGE_CONNECTOR}|and)\\s*` +
    '\\d{1,2}(?::\\d{2})?\\s?(?:am|pm|a\\.m\\.|p\\.m\\.)(?![a-z]))',
  'gi',
);
const DAY_WORD = /\b(today|yesterday|tomorrow)\b/gi;
const SPAN = /\b(?:last|past)\s+(\d{1,6})\s*(minutes?|mins?|hours?|hrs?|days?|weeks?)\b/gi;
/** `the last hour`, `the past week` — a look-back of one unit; without `the`, `last week` is a calendar week (not read). */
const ONE_SPAN = /\bthe\s+(?:last|past)\s+(hour|day|week)\b/gi;

/** A zone right after a phrase: optional `(`, or `in`, then the token (and a closing `)`). */
const ZONE_AFTER = new RegExp(
  '^(\\s*\\(?\\s*|\\s+in\\s+)' +
    `(?:(${IANA_AREAS})/[A-Za-z0-9_+-]+(?:/[A-Za-z0-9_+-]+)?` +
    '|(?:UTC|GMT)\\s?([+-]\\d{1,2}(?::?\\d{2})?)' +
    `|(${ZONE_ABBREVIATIONS.join('|')}))(?![A-Za-z0-9_/])(\\s*\\))?`,
);

const num = (text: string | undefined): number | undefined =>
  text === undefined ? undefined : Number(text);

function wallOf(h: number, m?: number, s?: number, meridiem?: 'am' | 'pm'): TimeWall | undefined {
  if (!Number.isInteger(h) || h > 23) return undefined;
  if (m !== undefined && m > 59) return undefined;
  if (s !== undefined && s > 59) return undefined;
  if (meridiem !== undefined && (h < 1 || h > 12)) return undefined;
  return {
    h,
    ...(m !== undefined && { m }),
    ...(s !== undefined && { s }),
    ...(meridiem !== undefined && { meridiem }),
  };
}

function* matches(re: RegExp, text: string): Generator<RegExpExecArray> {
  re.lastIndex = 0;
  for (let m = re.exec(text); m !== null; m = re.exec(text)) {
    yield m;
    if (m[0].length === 0) re.lastIndex++;
  }
}

function isoAtoms(text: string): Atom[] {
  const out: Atom[] = [];
  for (const m of matches(ISO, text)) {
    const [, y, mo, d, h, mi, s, zone] = m;
    const date: TimeDate = { kind: 'fixed', year: Number(y), month: Number(mo), day: Number(d) };
    const wall = h === undefined ? undefined : wallOf(Number(h), Number(mi), num(s));
    if (h !== undefined && wall === undefined) continue;
    out.push({
      start: m.index,
      end: m.index + m[0].length,
      kind: 'instant',
      date,
      ...(wall !== undefined && { wall }),
      ...(zone !== undefined && { zoneToken: zone }),
    });
  }
  return out;
}

function numericAtoms(text: string): Atom[] {
  const out: Atom[] = [];
  for (const m of matches(NUMERIC, text)) {
    const [, a, b, c] = m as unknown as [string, string, string, string | undefined];
    if (a.length === 3 || (a.length === 4 && c === undefined)) continue;
    const fields = [Number(a), Number(b), ...(c !== undefined ? [Number(c)] : [])];
    const yearDigits: 2 | 4 | undefined =
      c === undefined ? undefined : a.length === 4 ? 4 : (c.length as 2 | 4);
    out.push({
      start: m.index,
      end: m.index + m[0].length,
      kind: 'date',
      date: { kind: 'numeric', fields, ...(yearDigits !== undefined && { yearDigits }) },
    });
  }
  return out;
}

function wallAtoms(text: string): Atom[] {
  const out: Atom[] = [];
  for (const m of matches(WALL_MERIDIEM, text)) {
    const meridiem = (m[4] as string).toLowerCase().startsWith('a') ? 'am' : 'pm';
    const wall = wallOf(Number(m[1]), num(m[2]), num(m[3]), meridiem);
    if (wall !== undefined) {
      out.push({ start: m.index, end: m.index + m[0].length, kind: 'wall', wall });
    }
  }
  for (const m of matches(WALL_COLON, text)) {
    const wall = wallOf(Number(m[1]), Number(m[2]), num(m[3]));
    if (wall !== undefined) {
      out.push({ start: m.index, end: m.index + m[0].length, kind: 'wall', wall });
    }
  }
  for (const m of matches(BARE_HOUR, text)) {
    const wall = wallOf(Number(m[1]));
    if (wall !== undefined) {
      out.push({ start: m.index, end: m.index + m[0].length, kind: 'bare', wall });
    }
  }
  return out;
}

function wordAtoms(text: string): Atom[] {
  const out: Atom[] = [];
  for (const m of matches(DAY_WORD, text)) {
    const offset = DAY_WORDS[(m[1] as string).toLowerCase()] as number;
    out.push({
      start: m.index,
      end: m.index + m[0].length,
      kind: 'day',
      relative: { unit: 'day', offset },
    });
  }
  for (const m of matches(SPAN, text)) {
    const count = Number(m[1]);
    const unit = SPAN_UNITS[(m[2] as string).toLowerCase().replace(/s$/, '')];
    if (unit === undefined || count < 1 || count > 100_000) continue;
    out.push({
      start: m.index,
      end: m.index + m[0].length,
      kind: 'span',
      relative: { unit, count },
    });
  }
  for (const m of matches(ONE_SPAN, text)) {
    const unit = SPAN_UNITS[(m[1] as string).toLowerCase()] as 'hour' | 'day' | 'week';
    out.push({
      start: m.index,
      end: m.index + m[0].length,
      kind: 'span',
      relative: { unit, count: 1 },
    });
  }
  return out;
}

/** The v1 phrases, overlaps settled: the earlier, then the longer, wins. */
function atomsOf(text: string): Atom[] {
  const all = [...isoAtoms(text), ...numericAtoms(text), ...wallAtoms(text), ...wordAtoms(text)];
  all.sort((a, b) => a.start - b.start || b.end - b.start - (a.end - a.start));
  const kept: Atom[] = [];
  for (const atom of all) {
    const last = kept[kept.length - 1];
    if (last !== undefined && atom.start < last.end) continue;
    kept.push({ ...atom });
  }
  for (const atom of kept) attachZone(text, atom);
  // A zone written after a phrase may cover a phrase found on its own (`UTC-07:00` holds `07:00`).
  const out: Atom[] = [];
  for (const atom of kept) {
    const last = out[out.length - 1];
    if (last === undefined || atom.start >= last.end) out.push(atom);
  }
  return out;
}

/** A zone written right after a date or a time joins that phrase, as written. */
function attachZone(text: string, atom: Atom): void {
  if (atom.kind === 'day' || atom.kind === 'span' || atom.kind === 'bare') return;
  if (atom.zoneToken !== undefined) return;
  const m = ZONE_AFTER.exec(text.slice(atom.end));
  if (m === null) return;
  const lead = m[1] as string;
  const opened = lead.includes('(');
  const closed = m[5] !== undefined;
  if (opened !== closed) return;
  // The IANA name, else the offset after `UTC` / `GMT`, else the abbreviation — each verbatim.
  const whole = m[0].slice(lead.length).replace(/\s*\)$/, '');
  const token = m[2] !== undefined ? whole : m[3] !== undefined ? m[3] : (m[4] as string);
  atom.zoneToken = token;
  atom.end += m[0].length;
}

// ─── The phrases v1 does not read ────────────────────────────────────────

interface Span {
  start: number;
  end: number;
}

function notReadSpans(text: string, atoms: readonly Atom[]): Span[] {
  const out: Span[] = [];
  for (const re of NOT_READ) {
    for (const m of matches(re, text)) {
      const span = { start: m.index, end: m.index + m[0].length };
      // A span a v1 phrase covers whole is that phrase (`last 40 minutes`), not a later row.
      if (atoms.some((a) => a.start <= span.start && span.end <= a.end)) continue;
      out.push(span);
    }
  }
  return out;
}

// ─── Mentions ────────────────────────────────────────────────────────────

/** A gap token that is one of the grammar's range connectors. */
const CONNECTOR = new RegExp(`^${RANGE_CONNECTOR}$`, 'i');
const GLUE = /^(?:,|at|on|in|of|the|@|from|between)$/i;

/** The words and marks between two phrases. */
const gapTokens = (gap: string): string[] => gap.match(/\.\.|[–—\-/,@()]|[A-Za-z]+|\d+|\S/g) ?? [];

/** Whether the text between two phrases only joins them — and whether it says "range". */
function joins(
  gap: string,
  between: boolean,
  left: Item,
  right: Item,
): 'glue' | 'range' | undefined {
  if (gap.replace(/[\s\w,@()./–—-]/g, '') !== '') return undefined;
  const tokens = gapTokens(gap);
  let range = false;
  for (const t of tokens) {
    const instants = left.atom?.kind === 'instant' && right.atom?.kind === 'instant';
    if (CONNECTOR.test(t) || t === '..' || (instants && t === '/')) {
      if (range) return undefined;
      range = true;
    } else if (t.toLowerCase() === 'and' && between) {
      if (range) return undefined;
      range = true;
    } else if (!GLUE.test(t)) {
      return undefined;
    }
  }
  return range ? 'range' : 'glue';
}

/** One piece of a mention: a v1 phrase, or a phrase v1 does not read. */
interface Item {
  readonly start: number;
  readonly end: number;
  readonly atom?: Atom;
}

interface Group {
  start: number;
  end: number;
  readonly items: Item[];
  /** The index in `items` where the range's second side starts — absent: no range. */
  rangeAt?: number;
  unreadable: boolean;
}

function groupsOf(text: string, atoms: readonly Atom[], notRead: readonly Span[]): Group[] {
  const items: Item[] = [
    ...atoms.map((atom) => ({ start: atom.start, end: atom.end, atom })),
    ...notRead.map((s) => ({ start: s.start, end: s.end })),
  ].sort((a, b) => a.start - b.start || b.end - a.end);
  const groups: Group[] = [];
  for (const item of items) {
    const group = groups[groups.length - 1];
    const last = group?.items[group.items.length - 1];
    if (group !== undefined && last !== undefined) {
      if (item.start < group.end) {
        group.items.push(item);
        group.end = Math.max(group.end, item.end);
        group.unreadable = true;
        continue;
      }
      const between = /\bbetween\s+$/i.test(text.slice(0, group.start));
      const joined = joins(text.slice(group.end, item.start), between, last, item);
      if (joined !== undefined) {
        if (joined === 'range') {
          if (group.rangeAt !== undefined) group.unreadable = true;
          group.rangeAt = group.items.length;
        }
        group.items.push(item);
        group.end = item.end;
        if (item.atom === undefined) group.unreadable = true;
        continue;
      }
    }
    groups.push({
      start: item.start,
      end: item.end,
      items: [item],
      unreadable: item.atom === undefined,
    });
  }
  for (const group of groups) widenForModifiers(text, group);
  return mergeOverlaps(groups).filter(
    (g) => g.unreadable || g.items.some((i) => i.atom?.kind !== 'bare'),
  );
}

/**
 * The leftover rule: the time-like tokens the message holds OUTSIDE every
 * phrase the reader parsed (`LEFTOVER`, `LEFTOVER_CASED`, a joiner right after
 * a time), in the order written — at most `MAX_LEFTOVER`, each a verbatim
 * substring. A READ group is parsed whole, its connector and its opener
 * (`from`, `between`) included; an unreadable group only in its phrases — the
 * modifier or mark that made it unreadable (`~ 9:30 PM`, `since 8 AM`) is
 * still said beside every other reading.
 */
function leftoverOf(text: string, groups: readonly Group[]): string[] {
  const inSpan = new Uint8Array(text.length);
  for (const g of groups) {
    if (g.unreadable) {
      for (const item of g.items) inSpan.fill(1, item.start, item.end);
      continue;
    }
    const opener = g.rangeAt !== undefined ? RANGE_OPENER.exec(text.slice(0, g.start)) : null;
    inSpan.fill(1, g.start - (opener === null ? 0 : (opener[1] as string).length), g.end);
  }
  const masked = Array.from(text, (ch, i) => (inSpan[i] === 1 ? ' ' : ch)).join('');
  const found: Span[] = [];
  for (const re of [LEFTOVER, LEFTOVER_CASED]) {
    for (const m of matches(re, masked)) {
      const at = m.index;
      if (MARK.test(m[0]) && isLetterAt(masked, at - 1) && isLetterAt(masked, at + 1)) continue;
      found.push({ start: at, end: at + m[0].length });
    }
  }
  for (const g of groups) {
    const after = g.unreadable ? null : SPAN_OF.exec(text.slice(g.end));
    if (after !== null && g.items[g.items.length - 1]?.atom?.kind === 'span') {
      const at = g.end + after[0].length - (after[1] as string).length;
      found.push({ start: at, end: at + (after[1] as string).length });
    }
  }
  const timeEnds = new Set([...found.map((s) => s.end - 1), ...spanEnds(inSpan)]);
  for (const m of matches(JOINER, masked)) {
    let j = m.index - 1;
    while (j >= 0 && inSpan[j] !== 1 && BETWEEN_JOIN.test(text[j] as string)) j--;
    if (j >= 0 && timeEnds.has(j)) found.push({ start: m.index, end: m.index + m[0].length });
  }
  return distinctSpans(found)
    .slice(0, MAX_LEFTOVER)
    .map((s) => text.slice(s.start, Math.min(s.end, s.start + MAX_LEFTOVER_TOKEN)));
}

const isLetterAt = (text: string, at: number): boolean =>
  at >= 0 && at < text.length && LETTER.test(text[at] as string);

/** The last index of every run of spanned characters. */
function spanEnds(inSpan: Uint8Array): number[] {
  const out: number[] = [];
  for (let i = 0; i < inSpan.length; i++) {
    if (inSpan[i] === 1 && inSpan[i + 1] !== 1) out.push(i);
  }
  return out;
}

/** Spans in text order, an overlapped one dropped (the earlier, then the longer, wins). */
function distinctSpans(spans: readonly Span[]): Span[] {
  const sorted = [...spans].sort((a, b) => a.start - b.start || b.end - a.end);
  const out: Span[] = [];
  for (const s of sorted) {
    const last = out[out.length - 1];
    if (last === undefined || s.start >= last.end) out.push(s);
  }
  return out;
}

/** Groups a widening made overlap are one phrase (`8 and 9 AM` held the bare `8` on its own). */
function mergeOverlaps(groups: readonly Group[]): Group[] {
  const out: Group[] = [];
  for (const group of [...groups].sort((a, b) => a.start - b.start)) {
    const last = out[out.length - 1];
    if (last !== undefined && group.start < last.end) {
      last.items.push(...group.items);
      last.end = Math.max(last.end, group.end);
      last.unreadable = true;
      continue;
    }
    out.push(group);
  }
  return out;
}

/** A modifier before or after a v1 phrase changes it: the whole phrase is not read. */
function widenForModifiers(text: string, group: Group): void {
  const head = text.slice(0, group.start);
  const clock = group.items.some((i) => i.atom?.wall !== undefined);
  const before =
    MODIFIER_BEFORE.exec(head) ??
    (group.rangeAt === undefined && clock ? FROM_BEFORE.exec(head) : null);
  if (before !== null) {
    group.start = before.index + before[0].lastIndexOf(before[1] as string);
    group.unreadable = true;
  }
  const after = MODIFIER_AFTER.exec(text.slice(group.end));
  if (after !== null) {
    group.end += after[0].length;
    group.unreadable = true;
  }
}

// ─── Parts ───────────────────────────────────────────────────────────────

interface Side {
  date?: TimeDate;
  relative?: TimeRelative;
  wall?: TimeWall;
  zoneToken?: string;
  /** Where the day was said, relative to the wall: a day before the wall may be the mention's. */
  dayFirst?: boolean;
  bare?: boolean;
  span?: boolean;
}

/** One side's parts from its phrases — `undefined` when two phrases say the same part. */
function sideOf(atoms: readonly Atom[]): Side | undefined {
  const side: Side = {};
  for (const a of atoms) {
    if (a.date !== undefined || a.kind === 'day') {
      if (side.date !== undefined || side.relative !== undefined) return undefined;
      if (a.date !== undefined) side.date = a.date;
      if (a.kind === 'day') side.relative = a.relative;
      side.dayFirst = side.wall === undefined;
    }
    if (a.kind === 'span') {
      if (side.relative !== undefined) return undefined;
      side.relative = a.relative;
      side.span = true;
    }
    if (a.wall !== undefined) {
      if (side.wall !== undefined) return undefined;
      side.wall = a.wall;
      if (a.kind === 'bare') side.bare = true;
    }
    if (a.zoneToken !== undefined) {
      if (side.zoneToken !== undefined) return undefined;
      side.zoneToken = a.zoneToken;
    }
  }
  if (side.span === true && (side.date !== undefined || side.wall !== undefined)) return undefined;
  return side;
}

const partsOfSide = (side: Side): TimeParts => ({
  ...(side.date !== undefined && { date: side.date }),
  ...(side.wall !== undefined && { wall: side.wall }),
  ...(side.zoneToken !== undefined && { zoneToken: side.zoneToken }),
  ...(side.relative !== undefined && { relative: side.relative }),
});

/** The parts a group says, or `undefined` when they are not a v1 phrase. */
function partsOf(group: Group): TimeParts | undefined {
  const atoms = group.items.map((i) => i.atom as Atom);
  if (group.rangeAt === undefined) {
    const side = sideOf(atoms);
    if (side === undefined || side.bare === true) return undefined;
    const parts = partsOfSide(side);
    return isTimeParts(parts) ? parts : undefined;
  }
  const left = sideOf(atoms.slice(0, group.rangeAt));
  const right = sideOf(atoms.slice(group.rangeAt));
  if (left === undefined || right === undefined) return undefined;
  if (left.span === true || right.span === true || right.bare === true) return undefined;
  if (left.bare === true && right.wall?.meridiem === undefined) return undefined;
  const outer: { date?: TimeDate; relative?: TimeRelative; zoneToken?: string } = {};
  // A day said before the first side's time, and not again, is the whole mention's…
  const leftDay = left.date !== undefined || left.relative !== undefined;
  const rightDay = right.date !== undefined || right.relative !== undefined;
  if (leftDay && !rightDay && left.dayFirst === true && left.wall !== undefined) {
    if (left.date !== undefined) outer.date = left.date;
    if (left.relative !== undefined) outer.relative = left.relative;
    delete left.date;
    delete left.relative;
  }
  // …and so is a zone said after the second side, and not on the first.
  if (right.zoneToken !== undefined && left.zoneToken === undefined) {
    outer.zoneToken = right.zoneToken;
    delete right.zoneToken;
  }
  const l = partsOfSide(left);
  const r = partsOfSide(right);
  if (Object.keys(l).length === 0 || Object.keys(r).length === 0) return undefined;
  const parts: TimeParts = { ...outer, rangeOf: [l, r] };
  return isTimeParts(parts) ? parts : undefined;
}

// ─── The allow-list: the forms this reader files as said ─────────────────
//
// Five review rounds showed English has an endless tail: a zone named in words
// (`London time`, `server time`, `in Asia/Kolkata`), an event anchor, an open
// end. So the reader TRUSTS only what it has evidence it reads right, and
// grows the list from a benchmark — never shrinks a deny-list forever. Every
// other phrase it reads is marked `confirm` and offered with its zone.

/** A zone token that fixes the offset by itself: `Z`, a numeric offset, `UTC`, an IANA `Area/Location`. */
const EXPLICIT_ZONE = new RegExp(`^(?:Z|UTC|[+-]\\d{1,2}(?::?\\d{2})?|(?:${IANA_AREAS})/.+)$`);

/** One bound of an explicit ISO reading: a year-dated date, a clock time, an explicit zone (each maybe said once for a range). */
function isZonedBound(side: TimeParts, outer: TimeParts): boolean {
  const date = side.date ?? outer.date;
  const zone = side.zoneToken ?? outer.zoneToken;
  return (
    date?.kind === 'fixed' &&
    date.year !== undefined &&
    side.wall !== undefined &&
    side.relative === undefined &&
    zone !== undefined &&
    EXPLICIT_ZONE.test(zone)
  );
}

/**
 * Whether a reading is on the allow-list — the ONLY forms this reader files as
 * the person's words: (1) a RELATIVE SPAN from now (`last|past N
 * minutes|hours|days|weeks`, `the last|past hour|day|week` — no zone, no
 * date order, nothing supplied); (2) an EXPLICIT ISO-8601 instant or range
 * whose every bound carries an offset or an IANA zone
 * (`2026-10-09T08:00-07:00`, `2026-10-09T08:00Z/2026-10-09T09:00Z`). The
 * reader's named dates are ISO only (a named month is unreadable), so a
 * year-dated `fixed` date here IS an ISO one.
 */
function isAllowListed(parts: TimeParts): boolean {
  const r = parts.relative;
  if (r !== undefined) return Object.keys(parts).length === 1 && 'count' in r;
  if (parts.rangeOf === undefined) return isZonedBound(parts, {});
  return (
    parts.wall === undefined &&
    isZonedBound(parts.rangeOf[0], parts) &&
    isZonedBound(parts.rangeOf[1], parts)
  );
}

/** The text's mentions, in the order written — at most `MAX_MENTIONS`, the port's bound. */
function mentionsOf(text: string): TimeMention[] {
  const atoms = atomsOf(text);
  const groups = groupsOf(text, atoms, notReadSpans(text, atoms));
  const leftover = leftoverOf(text, groups);
  const mentions: TimeMention[] = [];
  for (const group of groups) {
    const quote = text.slice(group.start, group.end);
    if (quote.trim() === '') continue;
    const parts = group.unreadable ? undefined : partsOf(group);
    mentions.push(
      parts === undefined
        ? { quote, parses: [], problem: 'unreadable' }
        : {
            quote,
            parses: [parts],
            ...(leftover.length > 0 && { leftover: [...leftover] }),
            ...(!isAllowListed(parts) && { confirm: true as const }),
          },
    );
  }
  return mentions.slice(0, MAX_MENTIONS);
}

// ─── The reader ──────────────────────────────────────────────────────────

/** Options for {@link englishTimeReader}. */
export interface EnglishTimeReaderOptions {
  /**
   * The language tag the time ask's labels are rendered in (`present.ts`),
   * e.g. `'en-GB'`. Default `'en-US'`. It never decides a date order — that is
   * the policy's (`dateOrder`) or the person's.
   */
  readonly locale?: string;
}

/**
 * The library's careful English reader: a `kind: 'rule'` tokenizer over the
 * v1 phrases of the time design's § 5.3, "unreadable" for every other time
 * phrase it recognises. No dependency; deterministic over the text.
 *
 * @example
 * ```ts
 * Agent.create({ provider, model })
 *   .time({ zone: 'America/Los_Angeles', reader: englishTimeReader() })
 *   .build();
 * ```
 */
export function englishTimeReader(options: EnglishTimeReaderOptions = {}): TimeReader {
  return Object.freeze({
    id: ENGLISH_TIME_READER_ID,
    version: ENGLISH_TIME_READER_VERSION,
    locale: options.locale ?? 'en-US',
    kind: 'rule' as const,
    read: (text: string): TimeReading => ({ mentions: mentionsOf(text) }),
  });
}
