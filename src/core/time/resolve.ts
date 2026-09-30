/**
 * core/time/resolve — parts + clock + policy → every candidate window, and
 * the one rule for which candidate a reading settles on.
 *
 * Pattern: the hard, universal half of reading time, written once (time
 *          design § 5.1): a strategy tokenizes (`reader.ts`); this module
 *          resolves, the same way for every strategy. It is the one place
 *          zone arithmetic meets the person's words.
 * Role:    core/ leaf (the time layer). Imports `instant.ts`, `zone.ts`,
 *          `range.ts`, `present.ts` (the `Grain` word), `reader.ts` (the
 *          parts) and `resolveRecord.ts` (the shapes, the policy and the
 *          record's checks — split out for the synchronous doors, and
 *          re-exported here). `rowsBuild.ts` · `timeReadingRows` calls it at the
 *          seed, which loads it only under `.time()`.
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
 * | a clock time with no meridiem, hour 1–12 (`8:40`) | am and pm — one when the form is a 24-hour clock (`clock: '24h'`, an ISO instant) |
 * | a wall time the clocks go back through (`01:30`) | both instants, each noted `dst-overlap` |
 * | a wall time the clocks skip (`02:30`) | both readings Temporal names, each noted `dst-gap` |
 * | a day word (`{ day, offset: -1 }`) | the calendar day in the zone, anchored on the clock |
 * | a span (`{ minute, count: 40 }`) | a look-back until the clock's `now` |
 * | a range | one per combination of its sides that agree on date order, year and abbreviation reading, `from` before `to`; a first side with no meridiem takes the second's (`8 to 9 PM` → 8 PM) unless that runs backwards (`11 to 1 PM` → 11 AM) |
 * | a place named with `time` (`London time`) | the ONE zone the tz database has for it (`zone.ts` · `zoneOfPlace`), noted `zone-read`; none or several → the zone is asked |
 * | an abbreviation in the app's map (`PST`) | its zone's reading AND its literal offset's, when they name different windows — tagged `abbreviation`, noted `zone-read` |
 *
 * The fixed laws: a time is read to the END OF ITS GRAIN ("to 8:40" is
 * `[08:00, 08:41)`, a lone "9 AM" is `[09:00, 10:00)`, a day ends at the next
 * midnight — each noted `end-of-grain`) EXCEPT a range end said as an
 * o'clock hour, which is a boundary on the clock face and ends AT that
 * instant ("8 AM to 9 AM" is `[08:00, 09:00)`, no note — `endOf`); whether
 * an end was widened is asked of `widenedGrain`, never of `grain`. A day
 * starts at its first instant (Temporal's `startOfDay`: a midnight the
 * clocks skip starts the day at the first wall time that exists); a zone the
 * person did not say is the clock's; a zone they said is an IANA name, a
 * numeric offset, a place named with `time` that the tz database names
 * exactly once, or an abbreviation in the APP's map (`policy.abbreviations`)
 * — any other token (`PST` with no map, `India time`, `Pacific time`)
 * resolves nothing and is ASKED (`zoneReadsOf`, the one owner). Parts v1
 * does not resolve — a part of the day, a calendar span other than a day, a
 * window anchored on the previous one — are named `unsupported`, never
 * guessed.
 *
 * {@link chooseReading} then applies the app's policy (`dateOrder`, `year`)
 * and names what is left: one window (`only`, or `policy` when the policy
 * removed a reading — a choice nobody said, recorded), several (`open`, with
 * the questions an ask must settle), or none. A `kind: 'model'` reader's
 * window is never settled by the library: it stays `open` until the person
 * confirms it (§ 5.5), and its candidates carry `said: []`. Since the
 * owner's decision "Always confirm" (time design TQ29) neither is ANY
 * reading the record files: `rowsBuild.ts` · `timeReadingRows` passes
 * `confirm: true` for every reader's reading, so only the person's answer
 * in the time ask settles a window. The `confirm` parameter's default
 * (`kind === 'model'`) is the unit's, for a caller that resolves parts
 * outside the record.
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
import { isTimeRange, lookbackRange, type TimeRange } from './range.js';
import {
  fixedOffsetZone,
  isWallTime,
  isZoneName,
  offsetAt,
  readWall,
  wallAt,
  wallToInstant,
  zoneOfPlace,
  type WallTime,
  type ZoneName,
} from './zone.js';
import type { Grain } from './present.js';
import type { TimeParts, TimeWall } from './reader.js';
import {
  offsetOfToken,
  PART_ORDER,
  type MentionResolution,
  type OpenQuestion,
  type ReadingChoice,
  type ReadingTags,
  type ResolveClock,
  type TimeCandidate,
  type TimeNote,
  type TimePart,
  type TimePolicy,
} from './resolveRecord.js';

export {
  candidateIsWellFormed,
  choiceIsWellFormed,
  DEFAULT_TIME_POLICY,
  readPolicy,
  widenedGrain,
} from './resolveRecord.js';
export type {
  MentionResolution,
  OpenQuestion,
  ReadingChoice,
  ReadingTags,
  ResolveClock,
  ResolvedWindow,
  TimeCandidate,
  TimeNote,
  TimePart,
  TimePolicy,
  TimeWindow,
  ZoneAbbreviation,
} from './resolveRecord.js';

// ─── Zones ───────────────────────────────────────────────────────────────

/** How a zone read from words got there, when the words were no zone name (`London time`, `PST`). */
interface ZoneVia {
  readonly token: string;
  readonly as: 'place' | 'abbreviation' | 'abbreviation-literal';
}

type ZoneRead =
  | {
      readonly kind: 'iana';
      readonly zone: ZoneName;
      readonly said: boolean;
      readonly via?: ZoneVia;
    }
  | {
      readonly kind: 'offset';
      readonly minutes: number;
      readonly spelled: string;
      readonly via?: ZoneVia;
      /** The zone a window read at this offset is presented in — absent: the clock's. */
      readonly shownIn?: ZoneName;
    };

/** `London time`, `New York time` — a place named with the word `time` (the reader keeps it as written). */
const PLACE_TIME = /^(.+?)\s+time$/i;

/** The policy half the resolver reads: the app's abbreviation map. */
type ZonePolicy = Pick<TimePolicy, 'abbreviations'>;

/**
 * Every zone reading of a token — one, or TWO for an abbreviation in the
 * app's map (its zone, then its literal offset) — or `undefined` when the
 * token names no zone this layer can read, so the zone is ASKED. The one
 * owner of which words become a zone (§ 5.3): an IANA name and a numeric
 * offset as said; a place named with `time` only when the tz database has
 * exactly one zone for it (`zone.ts` · `zoneOfPlace`); an abbreviation only
 * through the app's map. Nothing else — never a hand word list.
 */
function zoneReadsOf(
  token: string | undefined,
  clockZone: ZoneName,
  policy: ZonePolicy | undefined,
): ZoneRead[] | undefined {
  if (token === undefined) return [{ kind: 'iana', zone: clockZone, said: false }];
  if (isZoneName(token)) return [{ kind: 'iana', zone: token, said: true }];
  if (token === 'Z') return [{ kind: 'offset', minutes: 0, spelled: 'Z' }];
  const offset = offsetOfToken(token);
  if (offset !== undefined) return [{ kind: 'offset', ...offset }];
  const mapped = policy?.abbreviations?.[token];
  if (mapped !== undefined) {
    const literal = offsetOfToken(mapped.offset);
    const reads: ZoneRead[] = [
      { kind: 'iana', zone: mapped.zone, said: true, via: { token, as: 'abbreviation' } },
    ];
    if (literal !== undefined) {
      const via: ZoneVia = { token, as: 'abbreviation-literal' };
      const fixed = fixedOffsetZone(literal.minutes);
      reads.push(
        fixed !== undefined
          ? { kind: 'iana', zone: fixed, said: true, via }
          : { kind: 'offset', ...literal, via, shownIn: mapped.zone },
      );
    }
    return reads;
  }
  const place = PLACE_TIME.exec(token);
  const zone = place === null ? undefined : zoneOfPlace(place[1] as string);
  if (zone !== undefined) return [{ kind: 'iana', zone, said: true, via: { token, as: 'place' } }];
  return undefined;
}

/**
 * The parts with every zone token this layer cannot read (an abbreviation
 * outside the app's map, `India time`) replaced by the zone the PERSON named
 * when asked (§ 6.3) — the whole mention's and each range side's. A token it
 * can read is kept.
 *
 * @example
 * ```ts
 * withZoneAnswered([{ wall: { h: 8, meridiem: 'am' }, zoneToken: 'PST' }], 'America/Los_Angeles');
 * // [{ wall: { h: 8, meridiem: 'am' }, zoneToken: 'America/Los_Angeles' }]
 * ```
 */
export function withZoneAnswered(
  parses: readonly TimeParts[],
  zone: ZoneName,
  policy?: ZonePolicy,
): TimeParts[] {
  const fix = (parts: TimeParts): TimeParts =>
    parts.zoneToken !== undefined && zoneReadsOf(parts.zoneToken, zone, policy) === undefined
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
  return zone.kind === 'offset' ? zone.minutes : offsetAt(zone.zone, ms);
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

/**
 * The 24-hour readings of a clock time: one, or am and pm when no meridiem
 * settles an hour 1–12 — unless the text's form is a 24-hour clock (an ISO
 * instant, `clock: '24h'`), which says the hour as written.
 */
function hoursOf(wall: TimeWall): { readonly h: number; readonly meridiem?: 'am' | 'pm' }[] {
  if (wall.meridiem !== undefined) {
    if (wall.h < 1 || wall.h > 12) return [];
    return [{ h: (wall.h % 12) + (wall.meridiem === 'pm' ? 12 : 0) }];
  }
  if (wall.clock !== '24h' && wall.h >= 1 && wall.h <= 12) {
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

function pointsOf(
  parts: TimeParts,
  clock: ResolveClock,
  nowMs: number,
  policy: ZonePolicy | undefined,
): Point[] | Unresolved {
  if (parts.partOfDay !== undefined) return { unsupported: 'a part of the day' };
  if (parts.anchor !== undefined) return { unsupported: 'a window anchored on the previous one' };
  const zones = zoneReadsOf(parts.zoneToken, clock.zone, policy);
  if (zones === undefined) return { needsZone: true };
  const out: Point[] = [];
  for (const zone of zones) {
    const points = pointsIn(parts, zone, nowMs);
    if (!Array.isArray(points)) return points;
    out.push(...points);
  }
  return out;
}

/** What a zone read adds to a point: the note naming the words, and the abbreviation's reading tag. */
function viaOf(zone: ZoneRead): { notes: TimeNote[]; tags: Pick<ReadingTags, 'abbreviation'> } {
  if (zone.kind === 'offset' && zone.via === undefined) {
    return { notes: [{ kind: 'offset-said', offset: zone.spelled }], tags: {} };
  }
  const via = zone.via;
  if (via === undefined) return { notes: [], tags: {} };
  const note: TimeNote = { kind: 'zone-read', token: via.token, as: via.as };
  if (via.as === 'place') return { notes: [note], tags: {} };
  return { notes: [note], tags: { abbreviation: via.as === 'abbreviation' ? 'zone' : 'literal' } };
}

/** The points of the parts under ONE zone read. */
function pointsIn(parts: TimeParts, zone: ZoneRead, nowMs: number): Point[] | Unresolved {
  const dates = datesOf(parts, wallIn(zone, nowMs));
  if (!Array.isArray(dates)) return dates;
  const zoneSaid: TimePart[] = parts.zoneToken !== undefined ? ['zone'] : [];
  const zoneImplied: TimePart[] = parts.zoneToken !== undefined ? [] : ['zone'];
  const via = viaOf(zone);
  const offsetNote = via.notes;
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
        tags: { ...date.tags, ...via.tags },
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
          tags: {
            ...date.tags,
            ...(hour.meridiem !== undefined && { meridiem: hour.meridiem }),
            ...via.tags,
          },
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
  return zone.kind === 'iana' ? zone.zone : zone.shownIn ?? clock.zone;
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
  return (
    same(a.dateOrder, b.dateOrder) && same(a.year, b.year) && same(a.abbreviation, b.abbreviation)
  );
}

/**
 * Where a range's END side ends (§ 3.3): an o'clock hour ("to 9 AM") is a
 * boundary on the clock face and ends AT that instant; any other end — a
 * minute ("to 8:40" → `08:41`), a second, a whole day — runs to the end of
 * its grain. `widened` says which, for the `end-of-grain` note.
 */
function endOf(r: Point): { readonly ms: number; readonly widened: boolean } {
  return r.grain === 'hour' ? { ms: r.fromMs, widened: false } : { ms: r.toMs, widened: true };
}

function fromSides(l: Point, r: Point, clock: ResolveClock): Built | undefined {
  const end = endOf(r);
  if (!agrees(l.tags, r.tags) || !(l.fromMs < end.ms)) return undefined;
  const from = spell(l.fromMs, l.zone);
  const to = spell(end.ms, r.zone);
  if (from === undefined || to === undefined) return undefined;
  const range = { from, to };
  const tags: ReadingTags = {
    ...((l.tags.dateOrder ?? r.tags.dateOrder) !== undefined && {
      dateOrder: l.tags.dateOrder ?? r.tags.dateOrder,
    }),
    ...(l.tags.meridiem !== undefined && { meridiem: l.tags.meridiem }),
    ...(r.tags.meridiem !== undefined && { endMeridiem: r.tags.meridiem }),
    ...((l.tags.year ?? r.tags.year) !== undefined && { year: l.tags.year ?? r.tags.year }),
    ...((l.tags.abbreviation ?? r.tags.abbreviation) !== undefined && {
      abbreviation: l.tags.abbreviation ?? r.tags.abbreviation,
    }),
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
        ...(end.widened ? [{ kind: 'end-of-grain' } as const] : []),
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

/**
 * A literal-offset reading that names the same window as the zone reading is
 * no second reading: `PST` in January IS America/Los_Angeles's −08:00.
 */
function withoutAgreeingLiterals(built: readonly Built[]): Built[] {
  const key = (b: Built): string => {
    const from = instantOf(b.candidate.range.from, 'strict')?.ms;
    const to = instantOf(b.candidate.range.to, 'strict')?.ms;
    const r = b.candidate.reading;
    return JSON.stringify([from, to, r.dateOrder, r.year, r.meridiem, r.endMeridiem]);
  };
  const zoneWindows = new Set(
    built.filter((b) => b.candidate.reading.abbreviation === 'zone').map(key),
  );
  return built.filter(
    (b) => b.candidate.reading.abbreviation !== 'literal' || !zoneWindows.has(key(b)),
  );
}

/**
 * The combinations of a range's sides that run forward. A first side said
 * with no meridiem takes the second side's said one ("8 to 9 PM" is 8 PM –
 * 9 PM, English's own rule), falling back to the other only when that does
 * not run forward ("11 to 1 PM" → 11 AM).
 */
function rangeCombinations(
  lp: readonly Point[],
  rp: readonly Point[],
  inherits: 'am' | 'pm' | undefined,
  clock: ResolveClock,
): Built[] {
  const all: { built: Built; left: Point }[] = [];
  for (const a of lp) {
    for (const b of rp) {
      const built = fromSides(a, b, clock);
      if (built !== undefined) all.push({ built, left: a });
    }
  }
  if (inherits !== undefined) {
    const same = all.filter((x) => x.left.tags.meridiem === inherits);
    if (same.length > 0) return same.map((x) => x.built);
  }
  return all.map((x) => x.built);
}

/** The meridiem a first side said with none takes from the second side, when the second said one. */
function inheritedMeridiem(l: TimeParts, r: TimeParts): 'am' | 'pm' | undefined {
  const lw = l.wall;
  const rw = r.wall;
  if (lw === undefined || rw?.meridiem === undefined) return undefined;
  if (lw.meridiem !== undefined || lw.clock === '24h' || lw.h < 1 || lw.h > 12) return undefined;
  return rw.meridiem;
}

function builtOf(
  parts: TimeParts,
  clock: ResolveClock,
  nowMs: number,
  policy: ZonePolicy | undefined,
): Built[] | Unresolved {
  const built = builtOfAll(parts, clock, nowMs, policy);
  return Array.isArray(built) ? withoutAgreeingLiterals(built) : built;
}

function builtOfAll(
  parts: TimeParts,
  clock: ResolveClock,
  nowMs: number,
  policy: ZonePolicy | undefined,
): Built[] | Unresolved {
  const lookback = lookbackBuilt(parts, clock);
  if (lookback !== undefined) return 'candidate' in lookback ? [lookback] : lookback;
  if (parts.rangeOf === undefined) {
    const points = pointsOf(parts, clock, nowMs, policy);
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
  const lp = pointsOf(left, clock, nowMs, policy);
  if (!Array.isArray(lp)) return lp;
  const rp = pointsOf(right, clock, nowMs, policy);
  if (!Array.isArray(rp)) return rp;
  return rangeCombinations(lp, rp, inheritedMeridiem(l, r), clock);
}

/**
 * Every candidate window of one mention's parses, resolved against the
 * clock. A reading the person must confirm (`confirm: true` — every reading
 * the record files, TQ29; a `model` reader's by default) carries `said: []`.
 * `policy` is read for its abbreviation map only (`dateOrder` and `year`
 * are {@link chooseReading}'s): absent, no abbreviation names a zone.
 */
export function resolveMention(
  parses: readonly TimeParts[],
  clock: ResolveClock,
  reader: { readonly id: string; readonly kind: 'rule' | 'model' },
  confirm: boolean = reader.kind === 'model',
  policy?: ZonePolicy,
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
    const built = builtOf(parts, clock, now.ms, policy);
    if (!Array.isArray(built)) {
      if ('needsZone' in built) needsZone = true;
      else unsupported.push(built.unsupported);
      return;
    }
    for (const b of built) {
      if (!isTimeRange(b.candidate.range)) continue;
      candidates.push({
        ...b.candidate,
        said: confirm ? [] : partsIn(b.said),
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

function openQuestions(candidates: readonly TimeCandidate[], confirm: boolean): OpenQuestion[] {
  const differs = (read: (c: TimeCandidate) => unknown): boolean =>
    new Set(candidates.map((c) => JSON.stringify(read(c) ?? null))).size > 1;
  const open: OpenQuestion[] = [];
  if (differs((c) => c.parse)) open.push('parse');
  if (differs((c) => c.reading.dateOrder)) open.push('date-order');
  if (differs((c) => c.reading.year)) open.push('year');
  if (differs((c) => [c.reading.meridiem, c.reading.endMeridiem])) open.push('meridiem');
  if (differs((c) => c.reading.abbreviation)) open.push('abbreviation');
  if (differs((c) => c.notes.filter((n) => n.kind === 'dst-overlap' || n.kind === 'dst-gap'))) {
    open.push('dst');
  }
  if (confirm) open.push('confirm');
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
 * zone the person named that is no zone, and a reading to confirm
 * (`confirm` — every reading the record files, TQ29) are never settled here
 * — they stay `open` for the person.
 */
export function chooseReading(
  resolution: MentionResolution,
  policy: TimePolicy,
  kind: 'rule' | 'model',
  problem?: 'unreadable',
  confirm: boolean = kind === 'model',
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
    if (confirm) {
      return { by: 'open', remaining, open: ['confirm'], ...(usedPolicy && { policy: applied }) };
    }
    return usedPolicy ? { by: 'policy', candidate, policy: applied } : { by: 'only', candidate };
  }
  const open = [...zoneOpen, ...openQuestions(left, confirm)];
  return { by: 'open', remaining, open, ...(usedPolicy && { policy: applied }) };
}
