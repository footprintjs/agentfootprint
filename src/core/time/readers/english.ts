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
 * | a relative span with digits | last 40 minutes, past 2 hours | `relative: { unit, count }` — a look-back |
 *
 * ## What it says "unreadable" for — never a partial reading
 *
 * Parts of the day (`yesterday morning`, `tonight`, `noon`), calendar spans
 * (`last week`, `this month`), week days and named months (`Friday`,
 * `Oct 9`), `N hours ago`, spans in words (`last two hours`) or with a unit a
 * look-back cannot take (`last 3 months`), a look-ahead (`next 2 hours`), an
 * ordinal day (`the 9th`), `8 o'clock`, and any v1 phrase a modifier changes
 * (`since 8 AM`, `before yesterday`, `around 8:40`, `earlier today`,
 * `8 AM to now`, `past 8 PM`, `8 AM-ish`, `from 3 PM yesterday` with no `to`), a
 * range whose other side is no v1 time, and a meridiem the number contradicts
 * (`13:00 PM`). Such a phrase is ONE mention with `problem: 'unreadable'`,
 * quoting the whole phrase: reading `yesterday` out of `yesterday morning`
 * would silently widen what the person said, and reading `8:40 AM` out of
 * `8:40 AM till 9.30` would silently narrow it.
 *
 * The range rule is structural, not a list of spellings (`widenForDangling`):
 * a connector (`to`, `until`, `till`, `through`, `thru`, `-`, `–`, `—`, and
 * `and` after `between` or beside a clock time) next to a phrase says RANGE.
 * A far side that is a v1 time has already been joined; a connector still
 * left over whose far side BEGINS like a time — a digit-led token in any
 * spelling (`9`, `9.30`, `930`, `1600`, `9h`) or an hour in words (`nine`) —
 * makes the whole range unreadable, read to the end of its clause (`,` `;`
 * `.` `?` `!` or the text's end). A far side that does not begin like a time
 * leaves the connector as English (`yesterday to compare`).
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
 * //   rangeOf: [{ wall: { h: 8, meridiem: 'am' } }, { wall: { h: 8, m: 40, meridiem: 'am' } }] }] }] }
 * reader.read('what failed yesterday morning?', { locale: 'en-US' });
 * // { mentions: [{ quote: 'yesterday morning', parses: [], problem: 'unreadable' }] }
 * ```
 */

import {
  isTimeParts,
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

const SPAN_UNITS: Readonly<Record<string, 'second' | 'minute' | 'hour' | 'day' | 'week'>> = {
  second: 'second',
  sec: 'second',
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
const MODIFIER_AFTER =
  /^(?:\s*-?\s*ish\b|\s*(?:ago\b|onwards?\b|or\s+so\b|(?:or|and)\s+(?:later|earlier|after|before)\b|at\s+the\s+(?:latest|earliest)\b|(?:to|until|till|through|thru|-|–|—)\s*now\b))/i;

// ─── A range left dangling ───────────────────────────────────────────────
//
// ONE structural rule: a range connector next to a phrase says RANGE. When
// the far side is a time (`8:40 AM to 9 AM`) the grouping has already joined
// it; when a connector is still left over, its far side is no v1 time, and
// the whole range is one unreadable phrase — never the v1 side alone. The
// far side is recognised by how a time BEGINS (a numeral in any spelling, or
// an hour in words), never by what it must look like after that, so no
// spelling the reader does not know can slip past: `9`, `9.30`, `930`,
// `1600`, `9h`, `nine`, `half past nine` all count.

/** An hour said in words — how a spelled-out range side begins. */
const HOUR_WORDS =
  'zero|oh|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|thirteen|fourteen|' +
  'fifteen|sixteen|seventeen|eighteen|nineteen|twenty|thirty|forty|fifty|noon|midday|midnight|' +
  'half|quarter';
/**
 * How a range side begins: a token that starts with a digit, whatever runs
 * on after it (`9`, `9.30`, `930`, `9:30:00`, `9h`, `21h30`) — it never ends
 * on a sentence's `.` — or an hour in words.
 */
const SIDE_START = `(?:\\d(?:[\\w:.]{0,24}\\w)?|(?:${HOUR_WORDS})(?![a-z]))`;

/** At a phrase's end: the connector, then words a side may open with (`to about 9`, `till the 9th`). */
const CONNECTOR_AT = /\s*(?:(to|until|till|through|thru|and)(?![a-z])|[-–—])\s*/iy;
const SIDE_OPENER =
  /(?:(?:at|about|around|approx(?:imately)?|roughly|circa|nearly|almost|maybe|say|the)(?![a-z])\s*|~\s*)*/iy;
const SIDE_AT = new RegExp(SIDE_START, 'iy');
/**
 * Without `between`, `and` joins two things as often as two ends (`9 AM and
 * 3 retries`): it says "range" only when what follows the far side's number
 * is the clause's end or a time word (`8:30 and 9`, `8:30 and 9 yesterday`).
 */
const TIME_WORDS =
  'am|pm|a\\.m\\.|p\\.m\\.|today|yesterday|tomorrow|tonight|morning|afternoon|evening|night|noon|' +
  `midnight|o['’]?\\s?clock|utc|gmt|${IANA_AREAS}|${ZONE_ABBREVIATIONS.join('|')}`;
const AND_CLOSES = new RegExp(
  `\\s*(?:$|[;,\\n)]|[.!?:](?=\\s|$)|(?:${TIME_WORDS})(?![a-z]))`,
  'iy',
);
/**
 * Before a phrase: `8 to 9:30`, `1600-17:00`, `nine thirty till 14:00`,
 * `half past nine to 14:00`, `between 8 and 9:30` — the side is the whole run
 * of time words before the connector, so the quote never starts inside it.
 */
const SIDE_RUN = `(?:(?:${SIDE_START}|past)\\s+)*${SIDE_START}`;
const DANGLING_BEFORE = new RegExp(
  `(?:\\bbetween\\s+)?(?<![\\w:./])${SIDE_RUN}` +
    '\\s*(?:(?:to|until|till|through|thru)(?![a-z])\\s*|[-–—]\\s*|\\s(and)\\s+)$',
  'i',
);
/** Where a clause ends: the far side of a dangling range reaches that far (`a.m.` is no end). */
const CLAUSE_END = /[;,\n)]|(?<![ap]\.m)[.!?:](?=\s|$)/gi;

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
/** The same for a clock time — which may follow a range's hyphen (`8:00-8:40`), never an offset's sign. */
const TIME_NOT_AFTER = '(?<![\\w:.+/])';

const ISO = new RegExp(
  // An ISO interval's second end follows its first's `/` (`…08:00Z/2026-…`); a path's `/` does not count.
  `(?<![\\w:.-])(?<![^\\dZ]/)(?<!^/)(\\d{4})-(\\d{2})-(\\d{2})` +
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
  `${NOT_AFTER}(\\d{1,2})(?=\\s*(?:to|until|till|through|thru|and|-|–|—)\\s*` +
    '\\d{1,2}(?::\\d{2})?\\s?(?:am|pm|a\\.m\\.|p\\.m\\.)(?![a-z]))',
  'gi',
);
const DAY_WORD = /\b(today|yesterday|tomorrow)\b/gi;
const SPAN =
  /\b(?:last|past|previous)\s+(\d{1,6})\s*(seconds?|secs?|minutes?|mins?|hours?|hrs?|days?|weeks?)\b/gi;

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

const CONNECTOR = /^(?:to|until|till|through|thru|-|–|—)$/i;
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
    if (CONNECTOR.test(t) || (instants && (t === '/' || t === '..'))) {
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
  const ends = clauseEndsOf(text);
  const atomStarts = new Set(atoms.map((a) => a.start));
  for (const group of groups) widenForDangling(text, group, ends, atomStarts);
  for (const group of groups) widenForModifiers(text, group);
  return mergeOverlaps(groups).filter(
    (g) => g.unreadable || g.items.some((i) => i.atom?.kind !== 'bare'),
  );
}

const DANGLING_REACH = 64;

/** A range connector left dangling beside a phrase: the whole range is one unreadable phrase. */
function widenForDangling(
  text: string,
  group: Group,
  ends: ClauseEnds,
  atomStarts: ReadonlySet<number>,
): void {
  // A dangling first side is a few characters long: look only that far, so a long text stays linear.
  const from = Math.max(0, group.start - DANGLING_REACH);
  const head = text.slice(from, group.start);
  const clock = group.items.some((i) => i.atom?.wall !== undefined);
  const between = /\bbetween\s+$/i.exec(head);
  const before = DANGLING_BEFORE.exec(head);
  if (before !== null && (before[1] === undefined || clock)) {
    group.start = from + before.index;
    group.unreadable = true;
  }
  const farSide = danglingFarSide(text, group.end, clock, between !== null, atomStarts);
  if (farSide === undefined) return;
  // The far side is no v1 time: the range is read to its clause's end, all of it.
  group.end = Math.max(group.end, ends.after(farSide));
  if (between !== null) group.start = Math.min(group.start, from + between.index);
  group.unreadable = true;
}

/**
 * The rule, in three steps over the text after a phrase: a connector (else
 * no range), then a side that begins like a time (else the connector was
 * English, not a range: `yesterday to compare`), then — for `and` without
 * `between` only — whether it is a range at all or a list (`8 AM and 9 AM`,
 * `9 AM and 3 retries`). Returns where the far side's first token ends.
 */
function danglingFarSide(
  text: string,
  at: number,
  clock: boolean,
  between: boolean,
  atomStarts: ReadonlySet<number>,
): number | undefined {
  CONNECTOR_AT.lastIndex = at;
  const connector = CONNECTOR_AT.exec(text);
  if (connector === null) return undefined;
  const and = connector[1]?.toLowerCase() === 'and';
  if (and && !clock) return undefined;
  SIDE_OPENER.lastIndex = CONNECTOR_AT.lastIndex;
  SIDE_OPENER.exec(text);
  const sideAt = SIDE_OPENER.lastIndex;
  SIDE_AT.lastIndex = sideAt;
  if (SIDE_AT.exec(text) === null) return undefined;
  if (and && !between) {
    if (atomStarts.has(sideAt)) return undefined;
    AND_CLOSES.lastIndex = SIDE_AT.lastIndex;
    if (AND_CLOSES.exec(text) === null) return undefined;
  }
  return SIDE_AT.lastIndex;
}

/** The text's clause ends, found once — each dangling range asks where its clause ends. */
interface ClauseEnds {
  after(at: number): number;
}

function clauseEndsOf(text: string): ClauseEnds {
  const ends = [...text.matchAll(CLAUSE_END)].map((m) => m.index);
  return {
    after(at: number): number {
      let lo = 0;
      let hi = ends.length;
      while (lo < hi) {
        const mid = (lo + hi) >> 1;
        if ((ends[mid] as number) < at) lo = mid + 1;
        else hi = mid;
      }
      let end = ends[lo] ?? text.length;
      while (end > at && /\s/.test(text[end - 1] as string)) end--;
      return end;
    },
  };
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

/** The text's mentions, in the order written — at most `MAX_MENTIONS`, the port's bound. */
function mentionsOf(text: string): TimeMention[] {
  const atoms = atomsOf(text);
  const groups = groupsOf(text, atoms, notReadSpans(text, atoms));
  const mentions: TimeMention[] = [];
  for (const group of groups) {
    const quote = text.slice(group.start, group.end);
    if (quote.trim() === '') continue;
    const parts = group.unreadable ? undefined : partsOf(group);
    mentions.push(
      parts === undefined
        ? { quote, parses: [], problem: 'unreadable' }
        : { quote, parses: [parts] },
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
