/**
 * core/time/zone — IANA zone names and offset arithmetic, through `Intl`.
 *
 * Pattern: the platform's tz database behind two small questions — "what is
 *          the offset of this zone at this instant?" and "which instant is
 *          this wall time in this zone?" — with Temporal's four DST words for
 *          the second. No dependency: `Intl.DateTimeFormat` carries the
 *          database the runtime ships.
 * Role:    core/ leaf (the time layer's one owner). Imports `instant.ts` only.
 * Emits:   N/A.
 *
 * ## A zone is an IANA name, never an abbreviation
 *
 * `Intl` is more forgiving than this layer: it accepts `PST` (and reads it as
 * `America/Los_Angeles`, whose October offset is -07:00, not PST's -08:00),
 * `EST` (as `America/Panama`), and a bare offset such as `+05:30`. Each of
 * those turns a person's words into a zone without saying so, so
 * {@link isZoneName} refuses them: a name is accepted when it has an
 * `Area/Location` shape (`America/Los_Angeles`, `Etc/GMT+5`) or is `UTC` /
 * `GMT`, AND `Intl` knows it. An abbreviation reaches a zone only through a
 * recorded map (a later step), never here.
 *
 * ## DST — the four words
 *
 * | Wall time | `compatible` | `earlier` | `later` | `reject` |
 * |-----------|--------------|-----------|---------|----------|
 * | exists once | it | it | it | it |
 * | exists twice (fall back, `01:30`) | the first | the first | the second | `undefined` |
 * | never exists (spring forward, `02:30`) | shifted forward by the gap (`03:30`) | shifted back (`01:30`) | shifted forward | `undefined` |
 *
 * @example
 * ```ts
 * isZoneName('America/Los_Angeles'); // true
 * isZoneName('PST');                 // false — an abbreviation
 * offsetAt('America/Los_Angeles', Date.parse('2026-10-09T15:00:00Z')); // -420
 * readWall({ year: 2026, month: 11, day: 1, hour: 1, minute: 30 }, 'America/Los_Angeles');
 * // { kind: 'overlap', earlier: …08:30Z, later: …09:30Z }
 * ```
 */

import { daysInMonth, utcWallMs } from './instant.js';

/** An IANA zone name, checked through `Intl`. Never an abbreviation, never a bare offset. */
export type ZoneName = string;

/** A wall-clock reading with no zone. `second` and `millisecond` default to 0. */
export interface WallTime {
  readonly year: number;
  readonly month: number;
  readonly day: number;
  readonly hour: number;
  readonly minute: number;
  readonly second?: number;
  readonly millisecond?: number;
}

/** Temporal's four words for a wall time a DST change doubles or skips. */
export type Disambiguation = 'compatible' | 'earlier' | 'later' | 'reject';

/** What a wall time names in a zone: one instant, two (fall back), or none (spring forward). */
export type WallReading =
  | { readonly kind: 'unique'; readonly ms: number }
  | { readonly kind: 'overlap'; readonly earlier: number; readonly later: number }
  | { readonly kind: 'gap'; readonly earlier: number; readonly later: number };

/** `Area/Location` (one or more `/`), or the two single-word names that are not abbreviations of anything. */
const IANA_SHAPE = /^(?:[A-Za-z][A-Za-z0-9_+-]*(?:\/[A-Za-z0-9_+-]+)+|UTC|GMT)$/;
const MAX_NAME = 64;
const MAX_CACHED = 256;
const formatters = new Map<string, Intl.DateTimeFormat>();

/** The cached formatter for `zone`, or `undefined` when `Intl` does not know it. Bounded: the cache is cleared when full. */
function formatterFor(zone: string): Intl.DateTimeFormat | undefined {
  const hit = formatters.get(zone);
  if (hit !== undefined) return hit;
  let formatter: Intl.DateTimeFormat;
  try {
    formatter = new Intl.DateTimeFormat('en-US', {
      timeZone: zone,
      hourCycle: 'h23',
      era: 'short',
      year: 'numeric',
      month: 'numeric',
      day: 'numeric',
      hour: 'numeric',
      minute: 'numeric',
      second: 'numeric',
    });
  } catch {
    return undefined;
  }
  if (formatters.size >= MAX_CACHED) formatters.clear();
  formatters.set(zone, formatter);
  return formatter;
}

/** Whether `value` is an IANA zone name this runtime's tz database knows — see the module header for what is refused. */
export function isZoneName(value: unknown): value is ZoneName {
  if (typeof value !== 'string' || value.length > MAX_NAME || !IANA_SHAPE.test(value)) return false;
  return formatterFor(value) !== undefined;
}

/** The runtime's canonical spelling of a zone (`america/los_angeles` → `America/Los_Angeles`), or `undefined` when it is not a zone name. */
export function canonicalZone(value: unknown): ZoneName | undefined {
  if (!isZoneName(value)) return undefined;
  return (formatterFor(value) as Intl.DateTimeFormat).resolvedOptions().timeZone;
}

/** The wall time an instant shows in `zone` (milliseconds kept). */
export function wallAt(zone: ZoneName, ms: number): WallTime {
  const formatter = zoneFormatter(zone, 'wallAt');
  const parts: Record<string, string> = {};
  for (const part of formatter.formatToParts(new Date(ms))) parts[part.type] = part.value;
  const shownYear = Number(parts.year);
  return {
    // `era: 'short'` spells year 0 as '1 BC': astronomical year = 1 - shown.
    year: parts.era === 'BC' || parts.era === 'B' ? 1 - shownYear : shownYear,
    month: Number(parts.month),
    day: Number(parts.day),
    hour: Number(parts.hour),
    minute: Number(parts.minute),
    second: Number(parts.second),
    millisecond: ((ms % 1000) + 1000) % 1000,
  };
}

function zoneFormatter(zone: ZoneName, caller: string): Intl.DateTimeFormat {
  if (!isZoneName(zone)) {
    throw new TypeError(`${caller}: ${JSON.stringify(zone)} is not an IANA zone name.`);
  }
  return formatterFor(zone) as Intl.DateTimeFormat;
}

function wallMs(wall: WallTime): number {
  return utcWallMs(
    wall.year,
    wall.month,
    wall.day,
    wall.hour,
    wall.minute,
    wall.second ?? 0,
    wall.millisecond ?? 0,
  );
}

/** The offset of `zone` at the instant `ms`, in MILLISECONDS east of UTC. */
function offsetMsAt(zone: ZoneName, ms: number): number {
  return wallMs(wallAt(zone, ms)) - ms;
}

/**
 * The offset of `zone` at the instant `ms`, in minutes east of UTC
 * (`America/Los_Angeles` in October: -420). A historical local-mean-time
 * offset can be a fraction of a minute.
 */
export function offsetAt(zone: ZoneName, ms: number): number {
  return offsetMsAt(zone, ms) / 60_000;
}

/** Whether a wall time's fields name a real calendar time (any zone aside). */
export function isWallTime(value: unknown): value is WallTime {
  if (typeof value !== 'object' || value === null) return false;
  const w = value as Record<string, unknown>;
  const int = (v: unknown, lo: number, hi: number): boolean =>
    typeof v === 'number' && Number.isInteger(v) && v >= lo && v <= hi;
  if (!int(w.year, 0, 9999) || !int(w.month, 1, 12)) return false;
  const year = w.year as number;
  const month = w.month as number;
  return (
    int(w.day, 1, daysInMonth(year, month)) &&
    int(w.hour, 0, 23) &&
    int(w.minute, 0, 59) &&
    (w.second === undefined || int(w.second, 0, 59)) &&
    (w.millisecond === undefined || int(w.millisecond, 0, 999))
  );
}

/**
 * What `wall` names in `zone`: one instant, two (a fall-back overlap:
 * `earlier`, `later`), or none (a spring-forward gap: `earlier` is the wall
 * time read with the offset after the change, `later` with the offset before
 * it — Temporal's two readings). Throws a `TypeError` on a wall time that is
 * not a calendar time or a zone that is not a zone name.
 */
export function readWall(wall: WallTime, zone: ZoneName): WallReading {
  if (!isWallTime(wall)) {
    throw new TypeError(`readWall: ${JSON.stringify(wall)} is not a wall time.`);
  }
  zoneFormatter(zone, 'readWall');
  const w = wallMs(wall);
  // Every real zone changes offset at most once within a day either side.
  const before = offsetMsAt(zone, w - 86_400_000);
  const after = offsetMsAt(zone, w + 86_400_000);
  const offsets = [...new Set([before, offsetMsAt(zone, w), after])];
  const valid = offsets.map((o) => w - o).filter((t) => offsetMsAt(zone, t) === w - t);
  const instants = [...new Set(valid)].sort((a, b) => a - b);
  if (instants.length === 1) return { kind: 'unique', ms: instants[0] as number };
  if (instants.length >= 2) {
    return {
      kind: 'overlap',
      earlier: instants[0] as number,
      later: instants[instants.length - 1] as number,
    };
  }
  return { kind: 'gap', earlier: w - after, later: w - before };
}

/**
 * The instant `wall` names in `zone` under `disambiguation` (the module
 * table), or `undefined` under `'reject'` when the wall time is doubled or
 * skipped.
 */
export function wallToInstant(
  wall: WallTime,
  zone: ZoneName,
  disambiguation: Disambiguation,
): number | undefined {
  const reading = readWall(wall, zone);
  if (reading.kind === 'unique') return reading.ms;
  if (disambiguation === 'reject') return undefined;
  if (reading.kind === 'overlap')
    return disambiguation === 'later' ? reading.later : reading.earlier;
  return disambiguation === 'earlier' ? reading.earlier : reading.later;
}

/**
 * The tz database version this runtime's `Intl` carries — Node names it
 * (`process.versions.tz`, e.g. `'2025b'`); any other runtime answers
 * `'unknown'`. Recorded on every `time-reading` row: zone data changes
 * between releases, so a reading is re-derivable only with it.
 */
export function tzdataVersion(): string {
  const versions = (globalThis as { process?: { versions?: Record<string, unknown> } }).process
    ?.versions;
  const tz = versions?.tz;
  return typeof tz === 'string' && tz.length > 0 && tz.length <= 32 ? tz : 'unknown';
}
