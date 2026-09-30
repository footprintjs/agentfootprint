/**
 * core/time/forms — every spelling of a time the answer may write, split by
 * WHO produced it (time design § 9.5, step T7).
 *
 * Pattern: a pure function over recorded values — the person's text, or one
 *          window the record holds — never over the answer. The evidence gate
 *          asks it (`evidence/evidenceIndex.ts` · `exemptFromRun`,
 *          `stages/route.ts` · `timeLineageOf`) and never keeps a time table of
 *          its own.
 * Role:    core/ leaf (the time layer). Imports `bind.ts`, `rows.ts`,
 *          `resolve.ts`, `instant.ts` and `zone.ts` only.
 * Emits:   N/A.
 *
 * ## The two lists
 *
 * - **`said`** — spellings of the parts the PERSON said, at the grain they
 *   said them: "8 AM" said at grain hour is also `8:00` and `08:00` — the
 *   same instant at that grain, equality and not a new fact. They count as
 *   the person's words (the gate exempts them).
 * - **`derived`** — everything the LIBRARY produced from a reading: an
 *   implied year, the zone's abbreviation in effect (`PDT` for a said `PST`),
 *   offsets, UTC and epoch spellings, the end-of-grain `08:41`, a look-back's
 *   duration, and every part of a `model` reading. The gate files an answer
 *   value found only here with the lineage `derived-from-reading`: it can
 *   support "not sure", never "known", and it is never called invented.
 *
 * A time value no recorded reading produced is in neither list and still
 * fails the gate. Library text is never evidence: without `derived`, a model
 * echoing the served time line back would read as the person's words.
 */

import { turnWindowsOf, type TurnWindow } from './bind.js';
import { instantOf, spellInstant } from './instant.js';
import {
  resolveMention,
  withZoneAnswered,
  type ResolveClock,
  type TimeCandidate,
  type TimePart,
} from './resolve.js';
import { answersOf, clockOf, readingsOf, type TimeReadingRow } from './rows.js';
import { offsetAt, wallAt, type WallTime, type ZoneName } from './zone.js';

/** The two lineages of the spellings of one source — see the file header. */
export interface TimeForms {
  readonly said: readonly string[];
  readonly derived: readonly string[];
}

/** One window the record holds, as the spellings read it. */
export interface FormsWindow extends Pick<TurnWindow, 'source' | 'range' | 'zone' | 'lookback'> {
  /**
   * The reading this window IS, when the person confirmed a `rule` reading
   * of their words — which parts they WROTE, and how the range was read.
   * Absent: a window they typed in the ask, a UI control, a `model` reading.
   */
  readonly reading?: Pick<TimeCandidate, 'said' | 'notes' | 'grain'>;
  /** On an `answered` window: the person picked the offered reading, or wrote their own. */
  readonly answer?: TurnWindow['answer'];
}

/** What {@link timeFormsOf} spells: words the person or the app wrote, or one recorded window. */
export type TimeFormsSource = { readonly text: string } | { readonly window: FormsWindow };

// FOLD · the one owner of which spellings of a time count as the person's and which the library derived
// consumers read this and never re-derive it: evidence/evidenceIndex.ts · addExempt (the text rule), stages/route.ts · timeLineageOf (the turn's windows)
// detached: yes — fresh arrays of strings per call.
/**
 * The spellings of one source's times, split by lineage (§ 9.5).
 *
 * A `text` — the person's message, their typed answer, the app's prompt —
 * has only `said` spellings, and each is a SPELLING, never an
 * interpretation: an ISO date → its year, month and day; a 12-hour reading
 * (`8 Am`) → its 24-hour, padded and glued forms; a 24-hour reading
 * (`20:00`) → the same set. Slash dates are never read (their order is a
 * locale) and durations never (a quantity is not a time of day).
 *
 * A `window` — the turn's recorded window — splits by who produced each
 * part: the person's said parts at grain, or everything of a window they
 * typed or set in a UI, are `said`; the rest is `derived`. A `model`
 * reading's window (`derived-from-reading`) has no `said` spelling at all.
 *
 * @example
 * ```ts
 * timeFormsOf({ text: 'what connected 8 Am to 8:40 AM PST' }).said;
 * // ['8:00', '08:00', '8:00am', '8:40', '08:40', '8:40am']
 * timeFormsOf({ text: '2026-10-09' }).said; // ['2026', '10', '9']
 * timeFormsOf({ text: 'took 2h' });         // { said: [], derived: [] }
 * ```
 */
export function timeFormsOf(source: TimeFormsSource): TimeForms {
  if ('text' in source) return { said: textForms(source.text), derived: [] };
  return windowForms(source.window);
}

/**
 * Every recorded window of the LATEST turn on the ledger (its `clock` row's
 * turn), with the reading each one is — what the gate spells. Empty when no
 * clock was filed (an agent without `.time()`).
 */
export function turnFormsWindowsOf(ledger: readonly unknown[] | undefined): readonly FormsWindow[] {
  const clock = clockOf(ledger);
  if (clock === undefined) return [];
  const readings = readingsOf(ledger, clock.turn);
  const { windows } = turnWindowsOf(readings, clock, answersOf(ledger, clock.turn));
  return windows.map((w) => withReading(w, readings, clock));
}

/** A turn window with the reading it is, when the person confirmed a `rule` reading of their words. */
function withReading(
  window: TurnWindow,
  readings: readonly TimeReadingRow[],
  clock: ResolveClock,
): FormsWindow {
  const base: FormsWindow = {
    source: window.source,
    range: window.range,
    zone: window.zone,
    ...(window.lookback !== undefined && { lookback: window.lookback }),
    ...(window.answer !== undefined && { answer: window.answer }),
  };
  if (window.mention === undefined || window.answer === 'edited') return base;
  const row = readings.find((r) => r.mention === window.mention);
  const reading = row === undefined ? undefined : writtenReadingOf(row, window, clock);
  return reading === undefined ? base : { ...base, reading };
}

/**
 * Which parts the person WROTE for the reading a window is. Every reading is
 * filed as a proposal (`said: []`, TQ29), so the recorded parses are resolved
 * again — the zone the person answered in place of a token the layer cannot
 * read, the turn's recorded clock, never the reader — and the candidate whose
 * range IS the window names its parts. Only a `rule` reader's parts are what
 * was written; a `model` reading has none (§ 5.5).
 */
function writtenReadingOf(
  row: TimeReadingRow,
  window: TurnWindow,
  clock: ResolveClock,
): FormsWindow['reading'] {
  if (row.reader.kind !== 'rule' || row.parses === undefined || row.parses.length === 0) {
    return undefined;
  }
  const from = instantMs(window.range.from);
  const to = instantMs(window.range.to);
  try {
    const parses = withZoneAnswered(row.parses, window.zone);
    const { candidates } = resolveMention(parses, clock, row.reader, false);
    return candidates.find((c) => instantMs(c.range.from) === from && instantMs(c.range.to) === to);
  } catch {
    // A record the resolver cannot read names no parts: nothing is the person's.
    return undefined;
  }
}

// ─── The person's text ─────────────────────────────────────────────────────

/** An ISO calendar date in text — `2026-10-09`, also the date half of `2026-10-09T08:00`. */
const ISO_DATE = /(?<![\d-])(\d{4})-(\d{2})-(\d{2})(?![\d])/g;

/**
 * A 12-hour clock reading in text — `8 Am`, `8:40 AM`, `8pm`, `8:40 p.m.`.
 * Read off the TEXT, not tokens, because the suffix is its own token.
 */
const TWELVE_HOUR = /(?<![\d:.])(\d{1,2})(?::(\d{2}))?\s*([ap])\.?m(?![a-z])/gi;

/**
 * The evidence tokenizer's boundary (`evidence/normalize.ts` · `tokenize`),
 * restated for this leaf so a 24-hour reading is recognised as the same
 * whole token the gate compares — pinned equal by `test/core/time/forms.test.ts`.
 */
const NOT_IN_TOKEN = /[^A-Za-z0-9:_\-/.,%+@#$]+/;
const LIST_COMMA = /,(?!\d)|(?<!\d),/;
const LEADING = /^[$#@+'"`([{<]+/;
const TRAILING = /[.,;:!?%'"`)\]}>]+$/;
const TWENTY_FOUR_HOUR = /^(\d{1,2}):(\d{2})$/;

/** The whole tokens of `text` that are a 24-hour clock reading, lower-cased as the gate reads them. */
function clockTokens(text: string): readonly string[] {
  const out: string[] = [];
  for (const rough of text.split(NOT_IN_TOKEN)) {
    for (const piece of rough.split(LIST_COMMA)) {
      const token = piece.toLowerCase().trim().replace(LEADING, '').replace(TRAILING, '');
      if (TWENTY_FOUR_HOUR.test(token)) out.push(token);
    }
  }
  return out;
}

/** The said spellings of every date and clock time written in `text` (the file header's text rule). */
function textForms(text: string): readonly string[] {
  const out = new Spellings();
  for (const [, year = '', mm, dd] of text.matchAll(ISO_DATE)) {
    const month = Number(mm);
    const day = Number(dd);
    if (month < 1 || month > 12 || day < 1 || day > 31) continue;
    out.push(year, String(month), String(day));
  }
  for (const [, hh, mm, half = ''] of text.matchAll(TWELVE_HOUR)) {
    const hour = Number(hh);
    const minutes = mm ?? '00';
    if (hour < 1 || hour > 12 || Number(minutes) > 59) continue;
    const h24 = (hour % 12) + (half.toLowerCase() === 'p' ? 12 : 0);
    out.push(...clockSpellings(h24, minutes));
  }
  // A reading the 12-hour pass already took is not read again as 24-hour:
  // `8:40 p.m.` is 20:40, never also 08:40.
  for (const token of clockTokens(text.replace(TWELVE_HOUR, ' '))) {
    const [, hh = '', minutes = ''] = TWENTY_FOUR_HOUR.exec(token) ?? [];
    const h24 = Number(hh);
    if (h24 > 23 || Number(minutes) > 59) continue;
    out.push(...clockSpellings(h24, minutes));
  }
  return out.list();
}

/**
 * The spellings of ONE clock time: the 24-hour form bare and padded
 * (`8:00`, `08:00`, `20:00`), the 12-hour colon form (`8:00`) and its glued
 * suffix form (`8:00pm`). After tokenizing, `8:00 PM` and `8:00 AM` both read
 * `8:00` — the same hour on a 12-hour dial.
 */
function clockSpellings(h24: number, minutes: string): readonly string[] {
  const h12 = h24 % 12 === 0 ? 12 : h24 % 12;
  const suffix = h24 < 12 ? 'am' : 'pm';
  return [
    `${h24}:${minutes}`,
    `${pad2(h24)}:${minutes}`,
    `${h12}:${minutes}`,
    `${h12}:${minutes}${suffix}`,
  ];
}

// ─── One recorded window ───────────────────────────────────────────────────

/** The date and clock parts a window of the person's own entry says — all of them. */
const ALL_PARTS: readonly TimePart[] = ['year', 'month', 'day', 'hour', 'minute', 'meridiem'];

/**
 * Which parts of `window` the person said: every part of a window they typed
 * in the ask or set in a UI; of a reading they confirmed, only the parts they
 * WROTE (an implied year stays the library's); none of a `model` reading, and
 * none when the reading cannot be named.
 */
function saidPartsOf(window: FormsWindow): readonly TimePart[] {
  if (window.source === 'derived-from-reading') return [];
  if (window.source === 'control' || window.answer === 'edited') return ALL_PARTS;
  return window.reading?.said ?? [];
}

/**
 * The last instant of the range AS SAID — a reading runs to the end of its
 * grain, so `[08:00, 08:41)` at minute grain is said as `08:40`, and a whole
 * day `[26 Sep, 27 Sep)` as 26 Sep. A window with no reading (typed in the
 * ask, set in a UI) ends at its own `to`, as entered.
 */
function saidEndMs(window: FormsWindow, toMs: number): number {
  const grain = window.reading?.grain;
  if (grain === undefined) return toMs;
  // A day or wider: the last millisecond is inside the last said day.
  return toMs - (GRAIN_MS[grain] ?? 1);
}

const GRAIN_MS: Partial<Record<string, number>> = { second: 1000, minute: 60_000, hour: 3_600_000 };

/** The spellings of one recorded window, split by lineage. */
function windowForms(window: FormsWindow): TimeForms {
  const fromMs = instantMs(window.range.from);
  const toMs = instantMs(window.range.to);
  if (fromMs === undefined || toMs === undefined) return { said: [], derived: [] };
  const parts = new Set(saidPartsOf(window));
  const said = new Spellings();
  const derived = new Spellings();
  const ends = [fromMs, saidEndMs(window, toMs)];
  for (const ms of ends) {
    const wall = wallAt(window.zone, ms);
    said.push(...wallDateForms(wall, parts));
    if (parts.has('hour')) said.push(...wallClockForms(wall, parts.has('meridiem')));
  }
  for (const ms of [...ends, toMs, toMs - 60_000]) {
    derived.push(...allWallForms(wallAt(window.zone, ms), true));
    derived.push(...allWallForms(wallAt('UTC', ms), false));
    derived.push(...instantForms(ms, window.zone));
  }
  derived.push(window.range.from, window.range.to, ...zoneForms(window.zone, fromMs));
  if (window.lookback !== undefined) derived.push(window.lookback);
  const saidList = said.list();
  return { said: saidList, derived: derived.list().filter((f) => !saidList.includes(f)) };
}

/** The date spellings of the parts said: each said part, and the ISO date when all three were. */
function wallDateForms(wall: WallTime, parts: ReadonlySet<TimePart>): readonly string[] {
  const out: string[] = [];
  if (parts.has('year')) out.push(String(wall.year));
  if (parts.has('month')) out.push(String(wall.month));
  if (parts.has('day')) out.push(String(wall.day));
  if (parts.has('year') && parts.has('month') && parts.has('day')) out.push(isoDate(wall));
  return out;
}

/**
 * The clock spellings of a said time. Said without a meridiem, a time past
 * noon keeps only its 12-hour spellings — `20:40` is the library's reading of
 * a said `8:40`.
 */
function wallClockForms(wall: WallTime, meridiemSaid: boolean): readonly string[] {
  const minutes = pad2(wall.minute);
  const forms = clockSpellings(wall.hour, minutes);
  if (meridiemSaid || wall.hour < 12) return forms;
  const h12 = wall.hour % 12 === 0 ? 12 : wall.hour % 12;
  return [`${h12}:${minutes}`, `${pad2(h12)}:${minutes}`];
}

/**
 * Every date and clock spelling of one wall reading — the derived family. The
 * 12-hour spellings only in the window's own zone: nobody reads a UTC clock on
 * a 12-hour dial, and `3:00` is too common to be a lineage.
 */
function allWallForms(wall: WallTime, twelveHour: boolean): readonly string[] {
  const minutes = pad2(wall.minute);
  const clock = twelveHour
    ? clockSpellings(wall.hour, minutes)
    : [`${pad2(wall.hour)}:${minutes}`, `${pad2(wall.hour)}:${minutes}Z`];
  // A bare month or day number is too common to be a lineage — the year and
  // the ISO date are spellings no other value shares by chance.
  return [
    String(wall.year),
    isoDate(wall),
    ...clock,
    `${pad2(wall.hour)}:${minutes}:${pad2(wall.second ?? 0)}`,
    `${isoDate(wall)}T${pad2(wall.hour)}:${minutes}`,
    `${isoDate(wall)}T${pad2(wall.hour)}:${minutes}:${pad2(wall.second ?? 0)}`,
  ];
}

/** An instant's machine spellings: UTC and the zone's offset, to the minute and second, and epoch. */
function instantForms(ms: number, zone: ZoneName): readonly string[] {
  const offset = Math.round(offsetAt(zone, ms));
  const out: string[] = [String(ms), String(Math.floor(ms / 1000))];
  for (const minutes of [0, offset]) {
    const full = spellInstant({ ms, nanos: 0 }, minutes);
    if (full === undefined) continue;
    out.push(full, full.replace(/:\d{2}(?=(Z|[+-]\d{2}:\d{2})$)/, ''));
  }
  return out;
}

/** The zone as the library spells it: its IANA name, the abbreviation in effect, its offset. */
function zoneForms(zone: ZoneName, ms: number): readonly string[] {
  const offset = Math.round(offsetAt(zone, ms));
  const sign = offset < 0 ? '-' : '+';
  const h = Math.floor(Math.abs(offset) / 60);
  const m = Math.abs(offset) % 60;
  const hm = m === 0 ? String(h) : `${h}:${pad2(m)}`;
  return [
    zone,
    `${sign}${pad2(h)}:${pad2(m)}`,
    `${sign}${pad2(h)}${pad2(m)}`,
    `utc${sign}${hm}`,
    `gmt${sign}${hm}`,
    ...abbreviationOf(zone, ms),
  ];
}

/** The zone's short name at `ms` (`PDT`), when `Intl` has one that is not an offset. */
function abbreviationOf(zone: ZoneName, ms: number): readonly string[] {
  const name = new Intl.DateTimeFormat('en-US', { timeZone: zone, timeZoneName: 'short' })
    .formatToParts(new Date(ms))
    .find((p) => p.type === 'timeZoneName')?.value;
  return name === undefined || /\d/.test(name) ? [] : [name];
}

// ─── Small parts ───────────────────────────────────────────────────────────

const pad2 = (n: number): string => String(n).padStart(2, '0');

const isoDate = (wall: WallTime): string =>
  `${String(wall.year).padStart(4, '0')}-${pad2(wall.month)}-${pad2(wall.day)}`;

/** An instant's milliseconds, or `undefined` when the text is not one. */
function instantMs(value: string): number | undefined {
  return instantOf(value, 'lenient')?.ms;
}

/** An insertion-ordered set of spellings. */
class Spellings {
  private readonly seen = new Set<string>();
  push(...forms: readonly string[]): void {
    for (const form of forms) if (form !== '') this.seen.add(form);
  }
  list(): readonly string[] {
    return [...this.seen];
  }
}
