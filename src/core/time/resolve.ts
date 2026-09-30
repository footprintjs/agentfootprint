/**
 * core/time/resolve — parts + clock + policy → every candidate window, and
 * the one rule for which candidate a reading settles on.
 *
 * Pattern: the hard, universal half of reading time, written once (time
 *          design § 5.1): a strategy tokenizes (`reader.ts`); this module
 *          resolves, the same way for every strategy. It is the one place
 *          zone arithmetic meets the person's words.
 * Role:    core/ leaf (the time layer). Imports `instant.ts`, `zone.ts`,
 *          `range.ts`, `present.ts` (the `Grain` word) and `reader.ts` (the
 *          parts). `rows.ts` · `timeReadingRows` calls it at the seed.
 * Emits:   N/A.
 *
 * ## Every candidate, then the policy (§ 5.1, § 11)
 *
 * {@link resolveMention} writes EVERY reading of the parts, each tagged with
 * how it read them ({@link ReadingTags}):
 *
 * | Parts | Candidates |
 * |-------|------------|
 * | a numeric date `10/09/26` | up to three: `MDY`, `DMY`, `YMD` — each checked as a calendar day |
 * | a numeric date of two fields `10/09` | `MDY` and `DMY`, each for the clock's year and the one before |
 * | a date with no year | the clock's year (`current`) and the one before (`previous`) |
 * | a two-digit year `26` | the clock's century, noted `century-implied` |
 * | a clock time with no meridiem, hour 1–12 (`8:40`) | am and pm |
 * | a wall time the clocks go back through (`01:30`) | both instants, each noted `dst-overlap` |
 * | a wall time the clocks skip (`02:30`) | both readings Temporal names, each noted `dst-gap` |
 * | a day word (`{ day, offset: -1 }`) | the calendar day in the zone, anchored on the clock |
 * | a span (`{ minute, count: 40 }`) | a look-back until the clock's `now` |
 * | a range | one per combination of its sides that agree on date order and year, `from` before `to` |
 *
 * The fixed laws: a time is read to the END OF ITS GRAIN ("to 8:40" is
 * `[08:00, 08:41)`, noted `end-of-grain`); a day starts at its first instant
 * (Temporal's `startOfDay`: a midnight the clocks skip starts the day at the
 * first wall time that exists); a zone the person did not say is the clock's;
 * a zone they said is an IANA name or a numeric offset — any other token (an
 * abbreviation such as `PST`) resolves nothing and is ASKED (no map ships in
 * v1). Parts v1 does not resolve — a part of the day, a calendar span other
 * than a day, a window anchored on the previous one — are named
 * `unsupported`, never guessed.
 *
 * {@link chooseReading} then applies the app's policy (`dateOrder`, `year`)
 * and names what is left: one window (`only`, or `policy` when the policy
 * removed a reading — a choice nobody said, recorded), several (`open`, with
 * the questions an ask must settle), or none. A `kind: 'model'` reader's
 * window is never settled by the library: it stays `open` until the person
 * confirms it (§ 5.5), and its candidates carry `said: []`.
 *
 * @example
 * ```ts
 * const clock = { now: '2026-10-09T15:40:00Z', zone: 'America/Los_Angeles' };
 * const rule = { id: 'fixture', kind: 'rule' as const };
 * const res = resolveMention([{ date: { kind: 'numeric', fields: [10, 9, 26] } }], clock, rule);
 * res.candidates.map((c) => c.reading.dateOrder); // ['MDY', 'DMY', 'YMD']
 * chooseReading(res, DEFAULT_TIME_POLICY, 'rule');
 * // { by: 'open', remaining: [0, 1, 2], open: ['date-order'] }
 * chooseReading(res, { dateOrder: 'DMY', year: 'ask' }, 'rule');
 * // { by: 'policy', candidate: 1, policy: { dateOrder: 'DMY' } }
 * ```
 */

import { daysInMonth, instantOf, spellInstant, utcWallMs, type InstantText } from './instant.js';
import type { DurationText } from './duration.js';
import { isTimeRange, lookbackRange, type TimeRange } from './range.js';
import {
  isWallTime,
  isZoneName,
  offsetAt,
  readWall,
  wallAt,
  wallToInstant,
  type WallTime,
  type ZoneName,
} from './zone.js';
import type { Grain } from './present.js';
import type { TimeParts, TimeWall } from './reader.js';

// ─── The shapes (time design § 3.2) ──────────────────────────────────────

/** A part of a time a person can say. `duration`: the length of a look-back ("last 40 minutes"). */
export type TimePart =
  | 'year'
  | 'month'
  | 'day'
  | 'hour'
  | 'minute'
  | 'second'
  | 'meridiem'
  | 'zone'
  | 'duration';

/** What was asked, before the clock is applied. */
export type TimeWindow =
  | { readonly kind: 'range'; readonly range: TimeRange }
  /** Always "until the clock's now". */
  | { readonly kind: 'lookback'; readonly duration: DurationText };

/** A library-written note on how a window was read. */
export type TimeNote =
  /** The range runs to the end of its last said grain ("to 8:40" → `08:41`). */
  | { readonly kind: 'end-of-grain' }
  /** A wall time the clocks go back through: which of its two instants this is (`end`: which end of a range). */
  | {
      readonly kind: 'dst-overlap';
      readonly which: 'earlier' | 'later';
      readonly end?: 'from' | 'to';
    }
  /** A wall time the clocks skip: which of Temporal's two readings this is. */
  | { readonly kind: 'dst-gap'; readonly which: 'earlier' | 'later'; readonly end?: 'from' | 'to' }
  /** The person said a numeric offset, not a zone: the instants carry it; `zone` is the clock's. */
  | { readonly kind: 'offset-said'; readonly offset: string }
  /** A two-digit year, read in the clock's century. */
  | { readonly kind: 'century-implied'; readonly century: number };

/** Which reading of the PARTS produced a candidate, so a policy — or an ask — can choose among them. */
export interface ReadingTags {
  readonly dateOrder?: 'MDY' | 'DMY' | 'YMD';
  /** The meridiem this reading gave a clock time said without one (the `from` end of a range). */
  readonly meridiem?: 'am' | 'pm';
  /** The same, for the `to` end of a range. */
  readonly endMeridiem?: 'am' | 'pm';
  readonly year?: 'said' | 'current' | 'previous';
}

/** A window read from words, resolved against the clock (§ 3.2). */
export interface ResolvedWindow {
  readonly window: TimeWindow;
  /** Always present: a look-back resolved against the clock. Spelled in the offset the person meant. */
  readonly range: TimeRange;
  /** The zone the person meant, else the clock's. */
  readonly zone: ZoneName;
  /** The finest part the person said. */
  readonly grain: Grain;
  /** The parts the person said — empty for a `model` reader's reading (§ 5.5). */
  readonly said: readonly TimePart[];
  /** The parts this module filled: from the clock, the policy's candidates, the century. */
  readonly implied: readonly TimePart[];
  readonly anchor: 'message' | 'previous-window' | 'none';
  readonly reader: { readonly id: string; readonly kind: 'rule' | 'model' };
  readonly notes: readonly TimeNote[];
}

/** One candidate — produced here, never by a strategy. */
export interface TimeCandidate extends ResolvedWindow {
  readonly reading: ReadingTags;
  /** Which of the mention's parses it came from. */
  readonly parse: number;
}

/** The v1 policy (§ 11): the two switches with two careful answers. */
export interface TimePolicy {
  /** `'ask'`: a numeric date's readings become choices. Or the one order this app's people write. */
  readonly dateOrder: 'ask' | 'MDY' | 'DMY' | 'YMD';
  /** `'ask'`: a date said without a year is asked. `'current'`: the clock's year, recorded as assumed. */
  readonly year: 'ask' | 'current';
}

/** No silent MDY, no guessed year. */
export const DEFAULT_TIME_POLICY: TimePolicy = Object.freeze({ dateOrder: 'ask', year: 'ask' });

/** What the clock gives the resolver. */
export interface ResolveClock {
  readonly now: InstantText;
  readonly zone: ZoneName;
}

/** Every candidate of one mention, and what kept a parse from any. */
export interface MentionResolution {
  readonly candidates: readonly TimeCandidate[];
  /** A zone the person said that names no zone this layer can read (`PST`): the zone must be asked. */
  readonly needsZone: boolean;
  /** Parts v1 does not resolve, named. */
  readonly unsupported: readonly string[];
}

/** A question only the person can settle. */
export type OpenQuestion =
  | 'date-order'
  | 'year'
  | 'meridiem'
  | 'dst'
  | 'zone'
  | 'parse'
  | 'confirm';

/** How a mention's reading settled — recorded on its `time-reading` row. */
export type ReadingChoice =
  /** Every candidate left names the same window. */
  | { readonly by: 'only'; readonly candidate: number }
  /** The policy removed a reading and one window is left — assumed, recorded. */
  | {
      readonly by: 'policy';
      readonly candidate: number;
      readonly policy: Partial<TimePolicy>;
    }
  /** An ask must settle it (a later step raises it): the candidates left and the questions. */
  | {
      readonly by: 'open';
      readonly remaining: readonly number[];
      readonly open: readonly OpenQuestion[];
      readonly policy?: Partial<TimePolicy>;
    }
  | {
      readonly by: 'none';
      readonly why: 'unreadable' | 'unsupported' | 'no-candidate' | 'excluded-by-policy';
    };

// ─── The policy ──────────────────────────────────────────────────────────

const DATE_ORDERS: readonly string[] = ['ask', 'MDY', 'DMY', 'YMD'];
const YEAR_RULES: readonly string[] = ['ask', 'current'];

/**
 * The app's `policy`, read with the v1 defaults filled in — or a problem in
 * words (an unknown key, a value outside its switch).
 */
export function readPolicy(value: unknown): TimePolicy | string {
  if (value === undefined) return DEFAULT_TIME_POLICY;
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    return 'policy must be an object — { dateOrder?, year? }';
  }
  const p = value as Record<string, unknown>;
  const extra = Object.keys(p).filter((k) => k !== 'dateOrder' && k !== 'year');
  if (extra.length > 0) {
    return `policy takes { dateOrder?, year? } — unknown key ${extra
      .map((k) => `'${k}'`)
      .join(', ')}`;
  }
  if (p.dateOrder !== undefined && !DATE_ORDERS.includes(p.dateOrder as string)) {
    return "policy.dateOrder must be 'ask', 'MDY', 'DMY' or 'YMD'";
  }
  if (p.year !== undefined && !YEAR_RULES.includes(p.year as string)) {
    return "policy.year must be 'ask' or 'current'";
  }
  return Object.freeze({
    dateOrder: (p.dateOrder as TimePolicy['dateOrder'] | undefined) ?? 'ask',
    year: (p.year as TimePolicy['year'] | undefined) ?? 'ask',
  });
}

// ─── Zones ───────────────────────────────────────────────────────────────

type ZoneRead =
  | { readonly kind: 'iana'; readonly zone: ZoneName; readonly said: boolean }
  | { readonly kind: 'offset'; readonly minutes: number; readonly spelled: string }
  | { readonly kind: 'unknown' };

/** `±HH`, `±HHMM`, `±HH:MM` — a colon only between hours and minutes, never trailing. */
const OFFSET_TOKEN = /^([+-])(\d{2})(?::?(\d{2}))?$/;

function zoneOf(token: string | undefined, clockZone: ZoneName): ZoneRead {
  if (token === undefined) return { kind: 'iana', zone: clockZone, said: false };
  if (isZoneName(token)) return { kind: 'iana', zone: token, said: true };
  if (token === 'Z') return { kind: 'offset', minutes: 0, spelled: 'Z' };
  const m = OFFSET_TOKEN.exec(token);
  if (m !== null) {
    const hours = Number(m[2]);
    const minutes = m[3] === undefined ? 0 : Number(m[3]);
    if (hours <= 23 && minutes <= 59) {
      const total = (m[1] === '-' ? -1 : 1) * (hours * 60 + minutes);
      const spelled = `${m[1]}${m[2]}:${m[3] ?? '00'}`;
      return { kind: 'offset', minutes: total === 0 ? 0 : total, spelled };
    }
  }
  return { kind: 'unknown' };
}

/**
 * The parts with every zone token this layer cannot read (an abbreviation such
 * as `PST`) replaced by the zone the PERSON named when asked (§ 6.3) — the
 * whole mention's and each range side's. A token it can read is kept.
 *
 * @example
 * ```ts
 * withZoneAnswered([{ wall: { h: 8, meridiem: 'am' }, zoneToken: 'PST' }], 'America/Los_Angeles');
 * // [{ wall: { h: 8, meridiem: 'am' }, zoneToken: 'America/Los_Angeles' }]
 * ```
 */
export function withZoneAnswered(parses: readonly TimeParts[], zone: ZoneName): TimeParts[] {
  const fix = (parts: TimeParts): TimeParts =>
    parts.zoneToken !== undefined && zoneOf(parts.zoneToken, zone).kind === 'unknown'
      ? { ...parts, zoneToken: zone }
      : parts;
  return parses.map((parts) => {
    const outer = fix(parts);
    return outer.rangeOf === undefined
      ? outer
      : { ...outer, rangeOf: [fix(outer.rangeOf[0]), fix(outer.rangeOf[1])] as const };
  });
}

/** The wall time an instant shows under a zone read. */
function wallIn(zone: ZoneRead, ms: number): WallTime {
  if (zone.kind === 'iana') return wallAt(zone.zone, ms);
  const d = new Date(ms + (zone.kind === 'offset' ? zone.minutes : 0) * 60_000);
  return {
    year: d.getUTCFullYear(),
    month: d.getUTCMonth() + 1,
    day: d.getUTCDate(),
    hour: d.getUTCHours(),
    minute: d.getUTCMinutes(),
  };
}

/** The offset to spell an instant in, minutes east of UTC. */
function offsetFor(zone: ZoneRead, ms: number): number {
  return zone.kind === 'offset' ? zone.minutes : offsetAt((zone as { zone: ZoneName }).zone, ms);
}

interface Instantly {
  readonly ms: number;
  readonly dst?: { readonly kind: 'dst-overlap' | 'dst-gap'; readonly which: 'earlier' | 'later' };
}

/** Every instant a wall time names under a zone read (two in a DST overlap or gap). */
function instantsOf(wall: WallTime, zone: ZoneRead): Instantly[] {
  if (!isWallTime(wall)) return [];
  const utc = utcWallMs(wall.year, wall.month, wall.day, wall.hour, wall.minute, wall.second ?? 0);
  if (zone.kind === 'offset') return [{ ms: utc - zone.minutes * 60_000 }];
  if (zone.kind !== 'iana') return [];
  const reading = readWall(wall, zone.zone);
  if (reading.kind === 'unique') return [{ ms: reading.ms }];
  const kind = reading.kind === 'overlap' ? 'dst-overlap' : 'dst-gap';
  return [
    { ms: reading.earlier, dst: { kind, which: 'earlier' } },
    { ms: reading.later, dst: { kind, which: 'later' } },
  ];
}

/** The first instant of a calendar day in a zone (Temporal's `startOfDay`). */
function dayStart(y: number, m: number, d: number, zone: ZoneRead): number | undefined {
  const wall = { year: y, month: m, day: d, hour: 0, minute: 0 };
  if (!isWallTime(wall)) return undefined;
  if (zone.kind === 'offset') return utcWallMs(y, m, d, 0, 0, 0) - zone.minutes * 60_000;
  if (zone.kind !== 'iana') return undefined;
  return wallToInstant(wall, zone.zone, 'compatible');
}

/** The calendar day `days` after `y-m-d`. */
function addDays(y: number, m: number, d: number, days: number): [number, number, number] {
  const date = new Date(utcWallMs(y, m, d + days, 0, 0, 0));
  return [date.getUTCFullYear(), date.getUTCMonth() + 1, date.getUTCDate()];
}

// ─── Dates ───────────────────────────────────────────────────────────────

interface DateReading {
  readonly y: number;
  readonly m: number;
  readonly d: number;
  readonly tags: Pick<ReadingTags, 'dateOrder' | 'year'>;
  readonly said: readonly TimePart[];
  readonly implied: readonly TimePart[];
  readonly notes: readonly TimeNote[];
  readonly anchor: 'message' | 'none';
}

const isDay = (y: number, m: number, d: number): boolean =>
  Number.isInteger(y) &&
  y >= 0 &&
  y <= 9999 &&
  m >= 1 &&
  m <= 12 &&
  d >= 1 &&
  d <= daysInMonth(y, m);

/** A said year value → a full year, or `undefined`; `century` set when the clock's century was used. */
function fullYear(
  value: number,
  digits: 2 | 4 | undefined,
  clockYear: number,
): { readonly year: number; readonly century?: number } | undefined {
  const century = Math.floor(clockYear / 100) * 100;
  if (digits === 2) return value <= 99 ? { year: century + value, century } : undefined;
  if (digits === 4) return value >= 1000 ? { year: value } : undefined;
  return value >= 100 ? { year: value } : { year: century + value, century };
}

/** The readings of a date said without a year: the clock's year, and the one before. */
function yearless(
  m: number,
  d: number,
  clockYear: number,
  tags: Pick<ReadingTags, 'dateOrder'>,
): DateReading[] {
  const out: DateReading[] = [];
  for (const [year, which] of [
    [clockYear, 'current'],
    [clockYear - 1, 'previous'],
  ] as const) {
    if (!isDay(year, m, d)) continue;
    out.push({
      y: year,
      m,
      d,
      tags: { ...tags, year: which },
      said: ['month', 'day'],
      implied: ['year'],
      notes: [],
      anchor: 'none',
    });
  }
  return out;
}

const ORDERS3: readonly (readonly ['MDY' | 'DMY' | 'YMD', number, number, number])[] = [
  // [tag, index of month, index of day, index of year]
  ['MDY', 0, 1, 2],
  ['DMY', 1, 0, 2],
  ['YMD', 1, 2, 0],
];

function numericDates(
  fields: readonly number[],
  digits: 2 | 4 | undefined,
  clockYear: number,
): DateReading[] {
  const out: DateReading[] = [];
  if (fields.length === 2) {
    const [a, b] = fields as [number, number];
    out.push(...yearless(a, b, clockYear, { dateOrder: 'MDY' }));
    out.push(...yearless(b, a, clockYear, { dateOrder: 'DMY' }));
    return out;
  }
  for (const [tag, mi, di, yi] of ORDERS3) {
    const full = fullYear(fields[yi] as number, digits, clockYear);
    if (full === undefined) continue;
    const m = fields[mi] as number;
    const d = fields[di] as number;
    if (!isDay(full.year, m, d)) continue;
    out.push({
      y: full.year,
      m,
      d,
      tags: { dateOrder: tag, year: 'said' },
      said: ['year', 'month', 'day'],
      implied: [],
      notes: full.century !== undefined ? [{ kind: 'century-implied', century: full.century }] : [],
      anchor: 'none',
    });
  }
  return out;
}

/** Every date reading of the parts, or a part v1 does not resolve. */
function datesOf(parts: TimeParts, today: WallTime): DateReading[] | { unsupported: string } {
  const rel = parts.relative;
  if (rel !== undefined) {
    if (parts.date !== undefined) return { unsupported: 'a date and a relative day together' };
    if (!('offset' in rel) || rel.unit !== 'day') {
      return { unsupported: `relative ${rel.unit}` };
    }
    const [y, m, d] = addDays(today.year, today.month, today.day, rel.offset);
    return [
      {
        y,
        m,
        d,
        tags: {},
        said: ['day'],
        implied: ['year', 'month'],
        notes: [],
        anchor: 'message',
      },
    ];
  }
  const date = parts.date;
  if (date === undefined) {
    if (parts.wall === undefined) return { unsupported: 'no date or time' };
    // A clock time alone is on the clock's day.
    return [
      {
        y: today.year,
        m: today.month,
        d: today.day,
        tags: {},
        said: [],
        implied: ['year', 'month', 'day'],
        notes: [],
        anchor: 'message',
      },
    ];
  }
  if (date.kind === 'numeric') return numericDates(date.fields, date.yearDigits, today.year);
  if (date.year === undefined) return yearless(date.month, date.day, today.year, {});
  if (!isDay(date.year, date.month, date.day)) return [];
  return [
    {
      y: date.year,
      m: date.month,
      d: date.day,
      tags: { year: 'said' },
      said: ['year', 'month', 'day'],
      implied: [],
      notes: [],
      anchor: 'none',
    },
  ];
}

// ─── Clock times ─────────────────────────────────────────────────────────

/** The 24-hour readings of a clock time: one, or am and pm when no meridiem settles an hour 1–12. */
function hoursOf(wall: TimeWall): { readonly h: number; readonly meridiem?: 'am' | 'pm' }[] {
  if (wall.meridiem !== undefined) {
    if (wall.h < 1 || wall.h > 12) return [];
    return [{ h: (wall.h % 12) + (wall.meridiem === 'pm' ? 12 : 0) }];
  }
  if (wall.h >= 1 && wall.h <= 12) {
    return [
      { h: wall.h % 12, meridiem: 'am' },
      { h: (wall.h % 12) + 12, meridiem: 'pm' },
    ];
  }
  return [{ h: wall.h }];
}

const GRAIN_MS: Readonly<Record<'hour' | 'minute' | 'second', number>> = {
  hour: 3_600_000,
  minute: 60_000,
  second: 1_000,
};

// ─── One side: a point read at its grain ─────────────────────────────────

interface Point {
  readonly fromMs: number;
  readonly toMs: number;
  readonly grain: Grain;
  readonly zone: ZoneRead;
  readonly tags: ReadingTags;
  readonly said: readonly TimePart[];
  readonly implied: readonly TimePart[];
  readonly notes: readonly TimeNote[];
  readonly dst?: Instantly['dst'];
  readonly anchor: 'message' | 'none';
}

type Unresolved = { readonly unsupported: string } | { readonly needsZone: true };

function pointsOf(parts: TimeParts, clock: ResolveClock, nowMs: number): Point[] | Unresolved {
  if (parts.partOfDay !== undefined) return { unsupported: 'a part of the day' };
  if (parts.anchor !== undefined) return { unsupported: 'a window anchored on the previous one' };
  const zone = zoneOf(parts.zoneToken, clock.zone);
  if (zone.kind === 'unknown') return { needsZone: true };
  const dates = datesOf(parts, wallIn(zone, nowMs));
  if (!Array.isArray(dates)) return dates;
  const zoneSaid: TimePart[] = parts.zoneToken !== undefined ? ['zone'] : [];
  const zoneImplied: TimePart[] = parts.zoneToken !== undefined ? [] : ['zone'];
  const offsetNote: TimeNote[] =
    zone.kind === 'offset' ? [{ kind: 'offset-said', offset: zone.spelled }] : [];
  const out: Point[] = [];
  for (const date of dates) {
    const base = {
      zone,
      said: [...date.said, ...zoneSaid],
      implied: [...date.implied, ...zoneImplied],
      anchor: date.anchor,
    };
    const wall = parts.wall;
    if (wall === undefined) {
      const from = dayStart(date.y, date.m, date.d, zone);
      const [ny, nm, nd] = addDays(date.y, date.m, date.d, 1);
      const to = dayStart(ny, nm, nd, zone);
      if (from === undefined || to === undefined) continue;
      out.push({
        ...base,
        fromMs: from,
        toMs: to,
        grain: 'day',
        tags: date.tags,
        notes: [...date.notes, ...offsetNote],
      });
      continue;
    }
    const grain = wall.s !== undefined ? 'second' : wall.m !== undefined ? 'minute' : 'hour';
    const wallSaid: TimePart[] = [
      'hour',
      ...(wall.m !== undefined ? (['minute'] as const) : []),
      ...(wall.s !== undefined ? (['second'] as const) : []),
      ...(wall.meridiem !== undefined ? (['meridiem'] as const) : []),
    ];
    for (const hour of hoursOf(wall)) {
      const at: WallTime = {
        year: date.y,
        month: date.m,
        day: date.d,
        hour: hour.h,
        minute: wall.m ?? 0,
        second: wall.s ?? 0,
      };
      for (const instant of instantsOf(at, zone)) {
        out.push({
          ...base,
          said: [...base.said, ...wallSaid],
          fromMs: instant.ms,
          toMs: instant.ms + GRAIN_MS[grain],
          grain,
          tags: { ...date.tags, ...(hour.meridiem !== undefined && { meridiem: hour.meridiem }) },
          notes: [...date.notes, ...offsetNote],
          ...(instant.dst !== undefined && { dst: instant.dst }),
        });
      }
    }
  }
  return out;
}

// ─── Candidates ──────────────────────────────────────────────────────────

const GRAIN_ORDER: readonly Grain[] = ['year', 'month', 'week', 'day', 'hour', 'minute', 'second'];
const finer = (a: Grain, b: Grain): Grain =>
  GRAIN_ORDER.indexOf(a) >= GRAIN_ORDER.indexOf(b) ? a : b;

const PART_ORDER: readonly TimePart[] = [
  'year',
  'month',
  'day',
  'hour',
  'minute',
  'second',
  'meridiem',
  'zone',
  'duration',
];
const partsIn = (parts: readonly TimePart[]): TimePart[] =>
  PART_ORDER.filter((p) => parts.includes(p));

function noteKey(note: TimeNote): string {
  return JSON.stringify(note);
}

function uniqueNotes(notes: readonly TimeNote[]): TimeNote[] {
  const seen = new Set<string>();
  return notes.filter((n) => {
    const key = noteKey(n);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function dstNote(dst: Point['dst'], end?: 'from' | 'to'): TimeNote[] {
  if (dst === undefined) return [];
  return [{ kind: dst.kind, which: dst.which, ...(end !== undefined && { end }) }];
}

function spell(ms: number, zone: ZoneRead): InstantText | undefined {
  return spellInstant({ ms, nanos: 0 }, offsetFor(zone, ms));
}

function windowZone(zone: ZoneRead, clock: ResolveClock): ZoneName {
  return zone.kind === 'iana' ? zone.zone : clock.zone;
}

interface Built {
  readonly candidate: Omit<TimeCandidate, 'reader' | 'said' | 'parse'>;
  readonly said: readonly TimePart[];
}

function fromPoint(point: Point, clock: ResolveClock): Built | undefined {
  const from = spell(point.fromMs, point.zone);
  const to = spell(point.toMs, point.zone);
  if (from === undefined || to === undefined) return undefined;
  const range = { from, to };
  return {
    said: point.said,
    candidate: {
      window: { kind: 'range', range },
      range,
      zone: windowZone(point.zone, clock),
      grain: point.grain,
      implied: partsIn(point.implied),
      anchor: point.anchor,
      notes: uniqueNotes([...point.notes, ...dstNote(point.dst), { kind: 'end-of-grain' }]),
      reading: point.tags,
    },
  };
}

function agrees(a: ReadingTags, b: ReadingTags): boolean {
  const same = (x: unknown, y: unknown): boolean => x === undefined || y === undefined || x === y;
  return same(a.dateOrder, b.dateOrder) && same(a.year, b.year);
}

function fromSides(l: Point, r: Point, clock: ResolveClock): Built | undefined {
  if (!agrees(l.tags, r.tags) || !(l.fromMs < r.toMs)) return undefined;
  const from = spell(l.fromMs, l.zone);
  const to = spell(r.toMs, r.zone);
  if (from === undefined || to === undefined) return undefined;
  const range = { from, to };
  const tags: ReadingTags = {
    ...((l.tags.dateOrder ?? r.tags.dateOrder) !== undefined && {
      dateOrder: l.tags.dateOrder ?? r.tags.dateOrder,
    }),
    ...(l.tags.meridiem !== undefined && { meridiem: l.tags.meridiem }),
    ...(r.tags.meridiem !== undefined && { endMeridiem: r.tags.meridiem }),
    ...((l.tags.year ?? r.tags.year) !== undefined && { year: l.tags.year ?? r.tags.year }),
  };
  return {
    said: [...l.said, ...r.said],
    candidate: {
      window: { kind: 'range', range },
      range,
      zone: windowZone(l.zone, clock),
      grain: finer(l.grain, r.grain),
      implied: partsIn([...l.implied, ...r.implied]),
      anchor: l.anchor === 'message' || r.anchor === 'message' ? 'message' : 'none',
      notes: uniqueNotes([
        ...l.notes,
        ...r.notes,
        ...dstNote(l.dst, 'from'),
        ...dstNote(r.dst, 'to'),
        { kind: 'end-of-grain' },
      ]),
      reading: tags,
    },
  };
}

const LOOKBACK_LETTER: Readonly<Record<string, string>> = {
  second: 's',
  minute: 'm',
  hour: 'h',
  day: 'd',
  week: 'w',
};

function lookbackBuilt(parts: TimeParts, clock: ResolveClock): Built | Unresolved | undefined {
  const rel = parts.relative;
  if (rel === undefined || !('count' in rel)) return undefined;
  const others = Object.keys(parts).filter((k) => k !== 'relative');
  if (others.length > 0) return { unsupported: 'a look-back with other parts' };
  const duration = `${rel.count}${LOOKBACK_LETTER[rel.unit] as string}`;
  let range: TimeRange;
  try {
    range = lookbackRange(clock.now, duration, 'smhdw');
  } catch {
    return { unsupported: 'a look-back past the calendar' };
  }
  return {
    said: ['duration'],
    candidate: {
      window: { kind: 'lookback', duration },
      range,
      zone: clock.zone,
      grain: rel.unit,
      implied: [],
      anchor: 'message',
      notes: [],
      reading: {},
    },
  };
}

/** A range side with what it takes from the whole mention and the other side: the day, the zone. */
function sideOf(side: TimeParts, outer: TimeParts, other: TimeParts): TimeParts {
  const hasDay = (p: TimeParts): boolean => p.date !== undefined || p.relative !== undefined;
  const day = hasDay(side) ? side : hasDay(outer) ? outer : hasDay(other) ? other : undefined;
  const zoneToken = side.zoneToken ?? outer.zoneToken ?? other.zoneToken;
  return {
    ...(side.wall !== undefined && { wall: side.wall }),
    ...(side.partOfDay !== undefined && { partOfDay: side.partOfDay }),
    ...(side.anchor !== undefined && { anchor: side.anchor }),
    ...(day?.date !== undefined && { date: day.date }),
    ...(day?.relative !== undefined && { relative: day.relative }),
    ...(zoneToken !== undefined && { zoneToken }),
  };
}

function builtOf(parts: TimeParts, clock: ResolveClock, nowMs: number): Built[] | Unresolved {
  const lookback = lookbackBuilt(parts, clock);
  if (lookback !== undefined) return 'candidate' in lookback ? [lookback] : lookback;
  if (parts.rangeOf === undefined) {
    const points = pointsOf(parts, clock, nowMs);
    if (!Array.isArray(points)) return points;
    return points.map((p) => fromPoint(p, clock)).filter((b): b is Built => b !== undefined);
  }
  if (parts.wall !== undefined || parts.partOfDay !== undefined || parts.anchor !== undefined) {
    return { unsupported: 'a range with a time outside its two sides' };
  }
  const [l, r] = parts.rangeOf;
  const left = sideOf(l, parts, r);
  const right = sideOf(r, parts, l);
  if (lookbackBuilt(left, clock) !== undefined || lookbackBuilt(right, clock) !== undefined) {
    return { unsupported: 'a look-back as a range side' };
  }
  const lp = pointsOf(left, clock, nowMs);
  if (!Array.isArray(lp)) return lp;
  const rp = pointsOf(right, clock, nowMs);
  if (!Array.isArray(rp)) return rp;
  const out: Built[] = [];
  for (const a of lp) {
    for (const b of rp) {
      const built = fromSides(a, b, clock);
      if (built !== undefined) out.push(built);
    }
  }
  return out;
}

/**
 * Every candidate window of one mention's parses, resolved against the
 * clock. A `model` reader's candidates carry `said: []` (§ 5.5).
 */
export function resolveMention(
  parses: readonly TimeParts[],
  clock: ResolveClock,
  reader: { readonly id: string; readonly kind: 'rule' | 'model' },
): MentionResolution {
  const now = instantOf(clock.now, 'strict');
  if (now === undefined || !isZoneName(clock.zone)) {
    throw new TypeError(
      'resolveMention: the clock must carry a strict instant and an IANA zone name.',
    );
  }
  const candidates: TimeCandidate[] = [];
  const unsupported: string[] = [];
  let needsZone = false;
  parses.forEach((parts, parse) => {
    const built = builtOf(parts, clock, now.ms);
    if (!Array.isArray(built)) {
      if ('needsZone' in built) needsZone = true;
      else unsupported.push(built.unsupported);
      return;
    }
    for (const b of built) {
      if (!isTimeRange(b.candidate.range)) continue;
      candidates.push({
        ...b.candidate,
        said: reader.kind === 'model' ? [] : partsIn(b.said),
        reader: { id: reader.id, kind: reader.kind },
        parse,
      });
    }
  });
  return { candidates, needsZone, unsupported };
}

// ─── Choosing ────────────────────────────────────────────────────────────

const windowKey = (c: TimeCandidate): string =>
  c.window.kind === 'lookback' ? `lookback:${c.window.duration}` : `${c.range.from}/${c.range.to}`;

function openQuestions(
  candidates: readonly TimeCandidate[],
  kind: 'rule' | 'model',
): OpenQuestion[] {
  const differs = (read: (c: TimeCandidate) => unknown): boolean =>
    new Set(candidates.map((c) => JSON.stringify(read(c) ?? null))).size > 1;
  const open: OpenQuestion[] = [];
  if (differs((c) => c.parse)) open.push('parse');
  if (differs((c) => c.reading.dateOrder)) open.push('date-order');
  if (differs((c) => c.reading.year)) open.push('year');
  if (differs((c) => [c.reading.meridiem, c.reading.endMeridiem])) open.push('meridiem');
  if (differs((c) => c.notes.filter((n) => n.kind === 'dst-overlap' || n.kind === 'dst-gap'))) {
    open.push('dst');
  }
  if (kind === 'model') open.push('confirm');
  return open;
}

/**
 * Whether a policy step DECIDED something: it removed a reading whose window
 * none of the kept readings names. A step that removed only same-window
 * readings (`12/12/12` under `DMY` — every order names one day) changed
 * nothing the person would see, so the choice is not recorded as assumed.
 */
function policyDecided(
  all: readonly TimeCandidate[],
  before: readonly number[],
  kept: readonly number[],
): boolean {
  if (kept.length === before.length) return false;
  const keptWindows = new Set(kept.map((i) => windowKey(all[i] as TimeCandidate)));
  return before.some(
    (i) => !kept.includes(i) && !keptWindows.has(windowKey(all[i] as TimeCandidate)),
  );
}

/**
 * How one mention settles under the app's policy (§ 5.1, § 11). The policy
 * only removes readings; it never adds one. A DST choice, a meridiem, a
 * zone the person named that is no zone, and a `model` reader's window are
 * never settled here — they stay `open` for the person.
 */
export function chooseReading(
  resolution: MentionResolution,
  policy: TimePolicy,
  kind: 'rule' | 'model',
  problem?: 'unreadable',
): ReadingChoice {
  if (problem === 'unreadable') return { by: 'none', why: 'unreadable' };
  if (resolution.needsZone && resolution.candidates.length === 0) {
    return { by: 'open', remaining: [], open: ['zone'] };
  }
  const all = resolution.candidates;
  if (all.length === 0) {
    return { by: 'none', why: resolution.unsupported.length > 0 ? 'unsupported' : 'no-candidate' };
  }
  const applied: { dateOrder?: TimePolicy['dateOrder']; year?: TimePolicy['year'] } = {};
  let remaining = all.map((_, i) => i);
  if (policy.dateOrder !== 'ask') {
    const kept = remaining.filter((i) => {
      const order = all[i]?.reading.dateOrder;
      return order === undefined || order === policy.dateOrder;
    });
    if (policyDecided(all, remaining, kept)) applied.dateOrder = policy.dateOrder;
    remaining = kept;
  }
  if (policy.year !== 'ask') {
    const kept = remaining.filter((i) => all[i]?.reading.year !== 'previous');
    if (policyDecided(all, remaining, kept)) applied.year = policy.year;
    remaining = kept;
  }
  if (remaining.length === 0) return { by: 'none', why: 'excluded-by-policy' };
  const usedPolicy = Object.keys(applied).length > 0;
  const left = remaining.map((i) => all[i] as TimeCandidate);
  const windows = new Set(left.map(windowKey));
  const zoneOpen: OpenQuestion[] = resolution.needsZone ? ['zone'] : [];
  if (windows.size === 1 && zoneOpen.length === 0) {
    const candidate = remaining[0] as number;
    if (kind === 'model') {
      return { by: 'open', remaining, open: ['confirm'], ...(usedPolicy && { policy: applied }) };
    }
    return usedPolicy ? { by: 'policy', candidate, policy: applied } : { by: 'only', candidate };
  }
  const open = [...zoneOpen, ...openQuestions(left, kind)];
  return { by: 'open', remaining, open, ...(usedPolicy && { policy: applied }) };
}

// ─── The record's checks ─────────────────────────────────────────────────

const GRAINS: readonly string[] = ['second', 'minute', 'hour', 'day', 'week', 'month', 'year'];
const ANCHORS: readonly string[] = ['message', 'previous-window', 'none'];
const OPEN: readonly string[] = [
  'date-order',
  'year',
  'meridiem',
  'dst',
  'zone',
  'parse',
  'confirm',
];

const isRecord = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === 'object' && !Array.isArray(value);
const isIndex = (value: unknown, below: number): boolean =>
  typeof value === 'number' && Number.isInteger(value) && value >= 0 && value < below;
const isPartList = (value: unknown): boolean =>
  Array.isArray(value) && value.every((p) => PART_ORDER.includes(p as TimePart));

function isNote(value: unknown): boolean {
  if (!isRecord(value)) return false;
  switch (value.kind) {
    case 'end-of-grain':
      return true;
    case 'dst-overlap':
    case 'dst-gap':
      return (
        (value.which === 'earlier' || value.which === 'later') &&
        (value.end === undefined || value.end === 'from' || value.end === 'to')
      );
    case 'offset-said':
      return typeof value.offset === 'string';
    case 'century-implied':
      return typeof value.century === 'number';
    default:
      return false;
  }
}

function isWindow(value: unknown): boolean {
  if (!isRecord(value)) return false;
  if (value.kind === 'range') return isTimeRange(value.range);
  return value.kind === 'lookback' && typeof value.duration === 'string';
}

/** Whether `value` is a candidate this module would have written. */
export function candidateIsWellFormed(value: unknown): boolean {
  if (!isRecord(value)) return false;
  const reader = value.reader;
  return (
    isWindow(value.window) &&
    isTimeRange(value.range) &&
    isZoneName(value.zone) &&
    GRAINS.includes(value.grain as string) &&
    isPartList(value.said) &&
    isPartList(value.implied) &&
    ANCHORS.includes(value.anchor as string) &&
    isRecord(reader) &&
    typeof reader.id === 'string' &&
    (reader.kind === 'rule' || reader.kind === 'model') &&
    Array.isArray(value.notes) &&
    value.notes.every(isNote) &&
    isRecord(value.reading) &&
    isIndex(value.parse, 64)
  );
}

function isPolicyUsed(value: unknown): boolean {
  if (!isRecord(value)) return false;
  return Object.entries(value).every(
    ([k, v]) =>
      (k === 'dateOrder' && DATE_ORDERS.includes(v as string)) ||
      (k === 'year' && YEAR_RULES.includes(v as string)),
  );
}

/** Whether `value` is a choice this module would have written over `count` candidates. */
export function choiceIsWellFormed(value: unknown, count: number): boolean {
  if (!isRecord(value)) return false;
  switch (value.by) {
    case 'only':
      return isIndex(value.candidate, count);
    case 'policy':
      return isIndex(value.candidate, count) && isPolicyUsed(value.policy);
    case 'open':
      return (
        Array.isArray(value.remaining) &&
        value.remaining.every((i) => isIndex(i, count)) &&
        Array.isArray(value.open) &&
        value.open.length > 0 &&
        value.open.every((q) => OPEN.includes(q as string)) &&
        (value.policy === undefined || isPolicyUsed(value.policy))
      );
    case 'none':
      return ['unreadable', 'unsupported', 'no-candidate', 'excluded-by-policy'].includes(
        value.why as string,
      );
    default:
      return false;
  }
}
