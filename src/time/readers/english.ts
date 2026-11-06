/**
 * time/readers/english — the library's careful English reader (time
 * design § 5.3): a tokenizer over a small, closed set of phrases, and
 * "unreadable" for every other time phrase it recognises.
 *
 * Pattern: Strategy behind the `TimeReader` port (`../reader.ts`). It
 *          TOKENIZES only: it returns the parts it sees and the verbatim
 *          quote. It never resolves an instant, never applies a date order,
 *          never maps a zone token (an abbreviation, a place) to a zone and
 *          never refuses a future date —
 *          all of that is `resolve.ts`'s, the policy's or the ask's.
 * Role:    L0 leaf (the time layer). Imports only the port's types. Armed
 *          by the app: `.time({ reader: englishTimeReader() })` — there is no
 *          default reader.
 * Emits:   N/A.
 *
 * ## What it reads (the v1 rows of § 5.3)
 *
 * | Phrase | Example | Parts |
 * |--------|---------|-------|
 * | an ISO date or instant | `2026-10-09`, `2026-10-09T08:00-07:00` | `date: fixed`, `wall` (marked `clock: '24h'` — never also pm), `zoneToken` |
 * | a numeric date | `10/09/26`, `10/9` | `date: numeric` — the ORDER is not decided here |
 * | a clock time | `8 AM`, `8:40`, `20:40`, `8:40 p.m.` | `wall` (a bare `8` is a time only as a range's first side: `8 to 9 AM`) |
 * | a range between two of the above | `8 AM to 8:40 AM`, `08:00–08:40`, `between 8 and 9 AM`, `today between 1 pm and 2 pm` | `rangeOf` (a day or zone said once for both sides is the whole mention's) |
 * | a zone after a time, a date or a day word | `America/Los_Angeles`, `UTC-07:00`, `London time`, `PST` | `zoneToken`, as written — `resolve.ts` maps it (a place the tz database names once; an abbreviation only through the app's map; else ASKED) |
 * | a named-month date | `11 September`, `Sept 29`, `September 29, 2026`, `the 29th of Sep` | `date: fixed` — no `year` unless written (the policy's or the person's, as for `10/9`) |
 * | a day word | today, yesterday, tomorrow | `relative: { unit: 'day', offset }` |
 * | a relative span from now | last 40 minutes, past 2 hours, last 24h, past 6h, the last hour, the past week | `relative: { unit, count }` — a look-back in minutes, hours, days or weeks, spelled out or compact (`m`, `h`, `d`, `w`) |
 *
 * ## What it says "unreadable" for — never a partial reading
 *
 * Parts of the day (`yesterday morning`, `tonight`, `noon` — a greeting, `Good morning`, is
 * no time and reads no mention), calendar spans
 * (`last week`, `this month`), week days and a month named alone (`Friday`,
 * `in September`), `N hours ago`, spans in words (`last two hours`), in a unit it
 * does not read (`last 30 seconds`, `last 30s`, `last 3 months`) or said with `previous`
 * (`previous 7 days` — often relative to another window), a look-ahead (`next 2 hours`), an
 * ordinal day (`the 9th`), `8 o'clock`, and any v1 phrase a modifier changes
 * (`since 8 AM`, `before yesterday`, `around 8:40`, `earlier today`,
 * `8 AM to now`, `past 8 PM`, `8 AM-ish`, `from 3 PM yesterday` with no `to`), a
 * bare first side whose far side says no meridiem (`8 to 9:30` — `9:30` alone
 * would drop the start) and a meridiem the number contradicts (`13:00 PM`). Such a phrase is ONE mention
 * with `problem: 'unreadable'`, quoting the whole phrase: reading `yesterday`
 * out of `yesterday morning` would silently widen what the person said.
 *
 * ## It only PROPOSES — the person confirms (the owner's decision "Always confirm")
 *
 * Nothing this reader reads is ever filed as the person's words. Seven review
 * rounds each found the next English spelling a word list, an allow-list or a
 * position rule missed (a zone named in words, a look-back tied to an event,
 * an open end, a half-read range), so the owner decided (2026-09-30, time
 * design TQ29): every reading of a chat message is a PROPOSAL, offered
 * through the time ask pre-filled and editable, with its window AND its zone
 * ("I read “last 2 hours” as … in America/Los_Angeles — is that right?").
 * Only what the person picks or types in that form is theirs. The library
 * owns the law (`../rowsBuild.ts` · `timeReadingRows`), so this reader returns
 * parts and quotes only — no confirm flag, no leftover list, no allow-list.
 * A form may later skip the click only when a registered benchmark shows it
 * is always read right (TQ29's growth rule).
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
 * reader.read('errors in the last 2 hours', { locale: 'en-US' });
 * // { mentions: [{ quote: 'last 2 hours', parses: [{ relative: { unit: 'hour', count: 2 } }] }] }
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
import type { Atom } from './english/types.js';
import { atomsOf } from './english/atoms.js';
import {
  BARE_SIDE_BEFORE,
  FROM_BEFORE,
  matches,
  MODIFIER_AFTER,
  MODIFIER_BEFORE,
  NOT_READ,
  RANGE_CONNECTOR,
} from './english/grammar.js';
export { BARE_SIDE_BEFORE, FROM_BEFORE, MODIFIER_BEFORE } from './english/grammar.js';

// ─── The words (data) ────────────────────────────────────────────────────

/** The reader's recorded identity — on every `time-reading` row with its version. */
export const ENGLISH_TIME_READER_ID = 'agentfootprint/english';
/** Raised whenever what the reader returns for some text changes. */
export const ENGLISH_TIME_READER_VERSION = '1.3.0';

// ─── The phrases v1 does not read ────────────────────────────────────────

interface Span {
  start: number;
  end: number;
}

function notReadSpans(text: string, atoms: readonly Atom[]): Span[] {
  const coveredWhole = coverage(atoms);
  const out: Span[] = [];
  for (const re of NOT_READ) {
    for (const m of matches(re, text)) {
      const span = { start: m.index, end: m.index + m[0].length };
      // A span a v1 phrase covers whole is that phrase (`last 40 minutes`), not a later row.
      if (coveredWhole(span)) continue;
      out.push(span);
    }
  }
  return out;
}

/**
 * Whether some span of `covering` holds `span` whole — `covering.some((a) =>
 * a.start <= span.start && span.end <= a.end)` — answered by binary search:
 * among the spans starting at or before `span.start`, the farthest end. Asking
 * `some` once per match cost matches × phrases, and a long message has many of
 * both.
 */
export function coverage(
  covering: readonly { readonly start: number; readonly end: number }[],
): (span: { readonly start: number; readonly end: number }) => boolean {
  const byStart = [...covering].sort((a, b) => a.start - b.start);
  const starts = byStart.map((s) => s.start);
  const farthestEnd: number[] = [];
  let farthest = -Infinity;
  for (const s of byStart) farthestEnd.push((farthest = Math.max(farthest, s.end)));
  return (span) => {
    let after = 0;
    let past = starts.length;
    while (after < past) {
      const mid = (after + past) >>> 1;
      if ((starts[mid] as number) <= span.start) after = mid + 1;
      else past = mid;
    }
    return after > 0 && (farthestEnd[after - 1] as number) >= span.end;
  };
}

/** `\s`, asked of one code unit at a time — the regex's own class, so it cannot drift. */
const BLANK = /\s/;

/**
 * `/\bbetween\s+$/i.test(text.slice(0, end))` — `between`, then blanks right
 * up to `end` — walked back from `end`. The regex read the whole text before
 * each phrase it was asked about, so a message of many short phrases cost its
 * length times their number.
 */
export function saysBetweenBefore(text: string, end: number): boolean {
  let word = end;
  while (word > 0 && BLANK.test(String.fromCharCode(text.charCodeAt(word - 1)))) word--;
  if (word === end || word < 7) return false;
  const spelled = 'between';
  for (let i = 0; i < spelled.length; i++) {
    if ((text.charCodeAt(word - 7 + i) | 0x20) !== spelled.charCodeAt(i)) return false;
  }
  return word === 7 || !isAsciiWordCode(text.charCodeAt(word - 8));
}

/**
 * The longest phrase `MODIFIER_BEFORE`, `BARE_SIDE_BEFORE` or `FROM_BEFORE`
 * matches spans three words (`no later than`, `from 8 to`, `between 8 and`);
 * one spare.
 */
const WORDS_BEFORE = 4;

/**
 * Where the text before `end` that those three patterns can reach starts: back
 * over the blanks before `end`, then over `WORDS_BEFORE` words and the blanks
 * before each. Each pattern ends at `end` (`\s*$`), spans fewer words, and
 * takes its leading boundary from the character just before its first word —
 * all inside this window, which starts at a blank or at 0, so the window's
 * `^` adds no match. The leftmost match in the window is therefore the leftmost
 * match in all the text before `end`; matching that text instead re-read the
 * whole message once per group.
 */
export function windowBefore(text: string, end: number): number {
  let at = end;
  while (at > 0 && isBlankAt(text, at - 1)) at--;
  for (let word = 0; word < WORDS_BEFORE && at > 0; word++) {
    while (at > 0 && !isBlankAt(text, at - 1)) at--;
    while (at > 0 && isBlankAt(text, at - 1)) at--;
  }
  return at;
}

function isBlankAt(text: string, at: number): boolean {
  return BLANK.test(String.fromCharCode(text.charCodeAt(at)));
}

/** `\w`: ASCII letters, digits, `_`. */
function isAsciiWordCode(code: number): boolean {
  const lower = code | 0x20;
  return (code >= 0x30 && code <= 0x39) || (lower >= 0x61 && lower <= 0x7a) || code === 0x5f;
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
  // Asked for the same group start once per item, so each position is read once.
  const betweenAt = new Map<number, boolean>();
  const saysBetween = (end: number): boolean => {
    let says = betweenAt.get(end);
    if (says === undefined) betweenAt.set(end, (says = saysBetweenBefore(text, end)));
    return says;
  };
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
      // `between` before the group, or right before its last phrase — the range's first side:
      // `today between 1 pm and 2 pm`, `yesterday between 8 and 9 AM` (a day said first).
      const between = saysBetween(group.start) || saysBetween(last.start);
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
  // Only the few words before the group can match (`windowBefore`).
  const from = windowBefore(text, group.start);
  const head = text.slice(from, group.start);
  const clock = group.items.some((i) => i.atom?.wall !== undefined);
  const startsOnWall = group.items[0]?.atom?.kind === 'wall';
  const before =
    (startsOnWall ? BARE_SIDE_BEFORE.exec(head) : null) ??
    MODIFIER_BEFORE.exec(head) ??
    (group.rangeAt === undefined && clock ? FROM_BEFORE.exec(head) : null);
  if (before !== null) {
    group.start = from + before.index + before[0].lastIndexOf(before[1] as string);
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
