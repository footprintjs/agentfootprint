export const DAY_WORDS: Readonly<Record<string, number>> = { today: 0, yesterday: -1, tomorrow: 1 };

/** The units a look-back is read in: minutes, hours, days, weeks — spelled out or compact (`24h`). */
export const SPAN_UNITS: Readonly<Record<string, 'minute' | 'hour' | 'day' | 'week'>> = {
  minute: 'minute',
  min: 'minute',
  m: 'minute',
  hour: 'hour',
  hr: 'hour',
  h: 'hour',
  day: 'day',
  d: 'day',
  week: 'week',
  wk: 'week',
  w: 'week',
};

/** A month's name as written (any case; `May` capitalised only — `may` is a verb) → its number. */
export const MONTH_NUMBERS: Readonly<Record<string, number>> = {
  jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12,
}; // prettier-ignore

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
export const NOT_READ: readonly RegExp[] = [
  // A part of the day — never after `good` (`Good morning`, `good night`): a greeting names no
  // time, and an unreadable mention is ASKED, so a greeting read here would ask the person which
  // time they meant by words that meant none.
  /\b(?<!\bgood\s+)(?:(?:this|last|early|late|mid)\s+)?(?:morning|afternoon|evening|night|tonight|overnight|noon|midday|midnight|lunchtime|dawn|dusk)s?\b/gi,
  /\b(?:last|this|next|past|previous|coming|current)\s+(?:week|month|year|quarter|weekend|hour|minute|second|day|night|decade|fortnight|shift)\b/gi,
  /\bweekends?\b/gi,
  /\b(?:monday|tuesday|wednesday|thursday|friday|saturday|sunday)s?\b/gi,
  // A month named alone (`in September`) — a calendar month, not read; with a day it is a date (`MONTH_DATE`).
  /\b(?:january|february|july|september|october|november|december)\b/gi,
  new RegExp(`\\b(?:\\d+|${NUMBER_WORDS})\\s+(?:${UNIT_WORDS})\\s+ago\\b`, 'gi'),
  new RegExp(
    `\\b(?:last|past|previous|next|coming|upcoming|following)\\s+` +
      `(?:(?:${NUMBER_WORDS}|\\d+)\\s+)?(?:${UNIT_WORDS})\\b`,
    'gi',
  ),
  // A compact span the reader does not read (`next 2h`, `last 30s`, `past 3mo`) — never no mention.
  /\b(?:last|past|previous|next|coming|upcoming|following)\s+\d+\s*(?:s|secs?|m|mins?|h|hrs?|d|w|wks?|mo|mos|y|yrs?)\b/gi,
  /\b(?:the\s+)?day\s+(?:before\s+yesterday|after\s+tomorrow)\b/gi,
  new RegExp(`\\bon\\s+the\\s+\\d{1,2}(?:st|nd|rd|th)\\b(?!\\s+of\\s+(?:${MONTHS})\\b)`, 'gi'),
  // `the 9th of` — unless a month follows (`the 29th of September` is a date, `MONTH_DATE`).
  new RegExp(`\\bthe\\s+\\d{1,2}(?:st|nd|rd|th)\\s+of\\b(?!\\s+(?:${MONTHS})\\b)`, 'gi'),
  /\b\d{1,2}\s*o['’]?\s?clock\b/gi,
  // A meridiem on a number that is no 12-hour time (`13:00 PM`, `0 AM`): the words contradict.
  /(?<![\w:.+/])\d{1,2}(?::\d{2}){0,2}\s?(?:am|pm|a\.m\.|p\.m\.)(?![a-z])/gi,
];

// ─── The range grammar (one owner) ──────────────────────────────────────
//
// The connectors a v1 range is READ with — the grammar's own list: the joins
// (`joins`), the bare hour's lookahead (`BARE_HOUR`) and `… to now`
// (`MODIFIER_AFTER`) all build from it. What the reader did not read is not
// its question any more: every reading is a proposal the person confirms
// (the owner's decision "Always confirm", time design TQ29).

const RANGE_WORDS = 'to|until|till|through|thru';
/** A range connector the grammar reads: a word, or a hyphen, en dash or em dash. */
export const RANGE_CONNECTOR = `(?:(?:${RANGE_WORDS})(?![a-z])|[–—-])`;

/** A word right before a phrase that changes what it means: the phrase is not read. */
export const MODIFIER_BEFORE = new RegExp(
  '(?:^|[^\\w])(since|before|after|by|around|circa|approx(?:imately)?|until|till|earlier|later|' +
    'early|late|within|past|beyond|prior\\s+to|up\\s+to|no\\s+(?:later|earlier|sooner)\\s+than|' +
    'as\\s+of|(?:starting|beginning)(?:\\s+(?:at|from|on))?|~)\\s*$',
  'i',
);
/** `from` with no `to`: a time after it is where a window STARTS (`from 3 PM yesterday`), not an hour. */
export const FROM_BEFORE = /(?:^|[^\w])(from)\s*$/i;
/**
 * A bare number joined to a clock time as a range's first side the grammar
 * does not read (`8 to 9:30`, `from 8 to 9:30`, `between 8 and 9:30` — the
 * far side says no meridiem, so `8` is no time): the whole phrase is not
 * read. Reading `9:30` alone would drop the start the person said.
 */
export const BARE_SIDE_BEFORE = new RegExp(
  `(?:^|[^\\w:./-])((?:from\\s+)?\\d{1,2}\\s*${RANGE_CONNECTOR}|between\\s+\\d{1,2}\\s+and)\\s*$`,
  'i',
);
/** …and right after it. */
export const MODIFIER_AFTER = new RegExp(
  '^(?:\\s*-?\\s*ish\\b|\\s*(?:ago\\b|onwards?\\b|or\\s+so\\b|(?:or|and)\\s+(?:later|earlier|after|before)\\b|' +
    `at\\s+the\\s+(?:latest|earliest)\\b|${RANGE_CONNECTOR}\\s*now\\b))`,
  'i',
);

// ─── The v1 phrases ──────────────────────────────────────────────────────

/** Text not preceded by something that would make these digits part of a larger token. */
const NOT_AFTER = '(?<![\\w:./-])';
/**
 * The same for a clock time — which may follow a range's hyphen (`8:00-8:40`)
 * or `..` (`2026-09-26 08:00..08:40`), never an offset's sign or one dot.
 */
const TIME_NOT_AFTER = '(?<![\\w:+/])(?<!(?:^|[^.])\\.)';

export const ISO = new RegExp(
  // An ISO interval's second end follows its first's `/` (`…08:00Z/2026-…`) or `..`; a path's `/` does not count.
  `(?<![\\w:-])(?<!(?:^|[^.])\\.)(?<![^\\dZ]/)(?<!^/)(\\d{4})-(\\d{2})-(\\d{2})` +
    '(?:[Tt ](\\d{2}):(\\d{2})(?::(\\d{2}))?(Z|[+-]\\d{2}(?::?\\d{2})?)?)?' +
    '(?![\\w:]|[.-]\\d)',
  'g',
);
export const NUMERIC = new RegExp(
  // A hyphen may join two dates (`10/01/26-10/09/26`).
  `(?<![\\w:./])(\\d{1,4})/(\\d{1,2})(?:/(\\d{4}|\\d{2}))?(?![\\w/:]|\\.\\d)`,
  'g',
);
export const WALL_MERIDIEM = new RegExp(
  `${TIME_NOT_AFTER}(\\d{1,2})(?::(\\d{2})(?::(\\d{2}))?)?\\s?(am|pm|a\\.m\\.|p\\.m\\.)(?![a-z])`,
  'gi',
);
export const WALL_COLON = new RegExp(
  // A meridiem after it is `WALL_MERIDIEM`'s — or, when that refuses it (`13:00 PM`), unreadable.
  `${TIME_NOT_AFTER}(\\d{1,2}):(\\d{2})(?::(\\d{2}))?(?![\\d:])(?!\\s?(?:am|pm|a\\.m\\.|p\\.m\\.)(?![a-z]))`,
  'gi',
);
/** A bare hour — a time only as a range's first side whose second side carries a meridiem. */
export const BARE_HOUR = new RegExp(
  `${NOT_AFTER}(\\d{1,2})(?=\\s*(?:${RANGE_CONNECTOR}|and)\\s*` +
    '\\d{1,2}(?::\\d{2})?\\s?(?:am|pm|a\\.m\\.|p\\.m\\.)(?![a-z]))',
  'gi',
);
export const DAY_WORD = /\b(today|yesterday|tomorrow)\b/gi;
export const SPAN =
  /\b(?:last|past)\s+(\d{1,6})\s*(minutes?|mins?|m|hours?|hrs?|h|days?|d|weeks?|wks?|w)\b/gi;
/**
 * A date with a NAMED month (`11 September`, `Sept 29`, `September 29, 2026`,
 * `29th of Sep 2026`): the text fixes the order, so the parts are `date: fixed`
 * with no year unless one is written — the year is the policy's (`year`) or the
 * person's, as for `10/9`. The month alone (`in September`) is not read.
 */
export const MONTH_DATE = new RegExp(
  `(?<![\\w:./-])(?:(${MONTHS})\\.?\\s+(\\d{1,2})(?:st|nd|rd|th)?` +
    `|(\\d{1,2})(?:st|nd|rd|th)?\\s+(?:of\\s+)?(${MONTHS})\\.?)` +
    '(?:,?\\s+(\\d{4}))?(?![\\w:/]|\\.\\d)',
  'gi',
);
/**
 * `last hour` / `past day` with optional `the`, the existing `the past week`,
 * or an explicit singular `one` / `a` / `an` minute/hour/day/week.
 * Bare `last week` remains unreadable calendar text.
 * Capture 1 stays the unit consumed by the existing atom reader.
 */
export const ONE_SPAN =
  /\b(?:(?:the\s+)?(?:last|past)\s+(?=(?:hour|day)\b)|the\s+(?:last|past)\s+(?=week\b)|(?:the\s+)?(?:last|past)\s+(?:one|an?)\s+)(minute|hour|day|week)\b/gi;

export function* matches(re: RegExp, text: string): Generator<RegExpExecArray> {
  re.lastIndex = 0;
  for (let m = re.exec(text); m !== null; m = re.exec(text)) {
    yield m;
    if (m[0].length === 0) re.lastIndex++;
  }
}
