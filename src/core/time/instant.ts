/**
 * core/time/instant — the ONE instant parser, with two named profiles.
 *
 * Pattern: one grammar, named profiles (never a second parser). Moved from
 *          `coverage/period.ts` (where it read a result's declared period)
 *          and `arguments/declare.ts` (where a regex plus `Date.parse` checked
 *          an `iso-range` argument). Exact: no `Date.parse` guessing, no
 *          sub-millisecond loss.
 * Role:    core/ leaf (the time layer's one owner, `src/core/time/`). Imports
 *          nothing. Asked by `coverage/period.ts` (lenient) and, through
 *          `range.ts` · `splitRange`, by `arguments/declare.ts` (strict).
 * Emits:   N/A.
 *
 * ## The two profiles
 *
 * | Profile   | For | `t`/`z` lower case | second `60` | day past the month's end, hour 24 |
 * |-----------|-----|--------------------|-------------|-----------------------------------|
 * | `lenient` | a period a result DECLARES — RFC 3339 as a foreign minter may write it | accepted | accepted (compares as the next minute's `:00`) | refused |
 * | `strict`  | a value the library SENDS to a tool — the canonical spelling a backend such as Python's `datetime.fromisoformat` takes | refused | refused | refused |
 *
 * Both require a zone (`Z` or `±HH:MM`): an instant with no zone could be any
 * of 24 hours, so it is refused rather than guessed.
 *
 * @example
 * ```ts
 * instantOf('2026-10-09T08:00:00-07:00', 'strict');  // { ms: 1791558000000, nanos: 0, offsetMinutes: -420, precision: 'second' }
 * instantOf('2026-10-09t08:00z', 'strict');           // undefined — lower case is lenient-only
 * instantOf('2026-02-30T08:00Z', 'lenient');          // undefined — 30 February does not exist
 * toUtc('2026-10-09T08:00-07:00', 'strict');          // '2026-10-09T15:00:00Z'
 * ```
 */

/** An ISO 8601 instant WITH an offset (`Z` or `±HH:MM`). */
export type InstantText = string;

/** Which spelling of an instant is accepted — see the module table. */
export type InstantProfile = 'lenient' | 'strict';

/**
 * One instant, comparable exactly: whole milliseconds since the epoch, and the
 * nanoseconds below that millisecond (0–999 999), so a 9-digit fraction is
 * never rounded.
 */
export interface Instant {
  readonly ms: number;
  readonly nanos: number;
}

/** A parsed instant: the instant, the offset it was written in, and how finely it was written. */
export interface ParsedInstant extends Instant {
  /** The written offset in minutes east of UTC (`Z` is 0). */
  readonly offsetMinutes: number;
  /** The finest part written: minutes only, seconds, or a fraction of a second. */
  readonly precision: 'minute' | 'second' | 'fraction';
}

const LENIENT =
  /^(\d{4})-(\d{2})-(\d{2})[Tt](\d{2}):(\d{2})(?::(\d{2})(?:\.(\d{1,9}))?)?(?:([Zz])|([+-])(\d{2}):(\d{2}))$/;
const STRICT =
  /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2})(?:\.(\d{1,9}))?)?(?:(Z)|([+-])(\d{2}):(\d{2}))$/;

/** Days in `month` (1–12) of the proleptic Gregorian `year`. */
export const daysInMonth = (year: number, month: number): number =>
  month === 2
    ? year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0)
      ? 29
      : 28
    : [4, 6, 9, 11].includes(month)
    ? 30
    : 31;

/** Milliseconds since the epoch of a UTC wall time. `setUTCFullYear`, never `Date.UTC`: the latter reads years 0–99 as 1900–1999. */
export function utcWallMs(
  year: number,
  month: number,
  day: number,
  hour: number,
  minute: number,
  second: number,
  millisecond = 0,
): number {
  const date = new Date(0);
  date.setUTCFullYear(year, month - 1, day);
  date.setUTCHours(hour, minute, second, millisecond);
  return date.getTime();
}

/**
 * The instant a string names under `profile`, or `undefined` when it is not
 * an ISO 8601 instant with a zone in that profile (a date alone, a time with
 * no zone, a day that does not exist, hour 24, prose). The profile is always
 * named by the caller: there is no default spelling of "an instant".
 */
export function instantOf(value: unknown, profile: InstantProfile): ParsedInstant | undefined {
  if (typeof value !== 'string') return undefined;
  const m = (profile === 'strict' ? STRICT : LENIENT).exec(value);
  if (m === null) return undefined;
  const [year, month, day, hour, minute] = [m[1], m[2], m[3], m[4], m[5]].map(Number) as [
    number,
    number,
    number,
    number,
    number,
  ];
  const second = m[6] === undefined ? 0 : Number(m[6]);
  if (month < 1 || month > 12 || day < 1 || day > daysInMonth(year, month)) return undefined;
  // 60 is RFC 3339's leap second — lenient only; it compares as the next minute's :00.
  const maxSecond = profile === 'lenient' ? 60 : 59;
  if (hour > 23 || minute > 59 || second > maxSecond) return undefined;
  let offsetMinutes = 0;
  if (m[8] === undefined) {
    const sign = m[9] === '-' ? -1 : 1;
    const oh = Number(m[10]);
    const om = Number(m[11]);
    if (oh > 23 || om > 59) return undefined;
    offsetMinutes = sign * (oh * 60 + om);
  }
  const fraction = m[7] === undefined ? 0 : Number(m[7].padEnd(9, '0'));
  const base = utcWallMs(year, month, day, hour, minute, second) - offsetMinutes * 60_000;
  return {
    ms: base + Math.floor(fraction / 1_000_000),
    nanos: fraction % 1_000_000,
    offsetMinutes: offsetMinutes === 0 ? 0 : offsetMinutes,
    precision: m[7] !== undefined ? 'fraction' : m[6] !== undefined ? 'second' : 'minute',
  };
}

/** -1 / 0 / 1 — `a` before, at, or after `b`. */
export function compareInstants(a: Instant, b: Instant): number {
  if (a.ms !== b.ms) return a.ms < b.ms ? -1 : 1;
  if (a.nanos !== b.nanos) return a.nanos < b.nanos ? -1 : 1;
  return 0;
}

/** `instant` moved by a whole number of milliseconds (negative moves it earlier). */
export function shiftInstant(instant: Instant, byMs: number): Instant {
  if (!Number.isSafeInteger(byMs)) {
    throw new TypeError(`shiftInstant: ${String(byMs)} is not a whole number of milliseconds.`);
  }
  return { ms: instant.ms + byMs, nanos: instant.nanos };
}

const pad = (n: number, width: number): string => String(n).padStart(width, '0');

/**
 * The strict-profile spelling of `instant` in the offset `offsetMinutes`
 * (`Z` when 0): seconds always written, a fraction only when it is not zero,
 * with no trailing zeros. `undefined` when the offset is not a whole number of
 * minutes within ±23:59, or the year in that offset falls outside 0000–9999.
 */
export function spellInstant(instant: Instant, offsetMinutes: number): InstantText | undefined {
  if (!Number.isInteger(offsetMinutes) || Math.abs(offsetMinutes) > 23 * 60 + 59) return undefined;
  const local = new Date(instant.ms + offsetMinutes * 60_000);
  const year = local.getUTCFullYear();
  if (!Number.isFinite(year) || year < 0 || year > 9999) return undefined;
  const fraction = local.getUTCMilliseconds() * 1_000_000 + instant.nanos;
  const frac = fraction === 0 ? '' : `.${pad(fraction, 9).replace(/0+$/, '')}`;
  const abs = Math.abs(offsetMinutes);
  const zone =
    offsetMinutes === 0
      ? 'Z'
      : `${offsetMinutes < 0 ? '-' : '+'}${pad(Math.floor(abs / 60), 2)}:${pad(abs % 60, 2)}`;
  return (
    `${pad(year, 4)}-${pad(local.getUTCMonth() + 1, 2)}-${pad(local.getUTCDate(), 2)}` +
    `T${pad(local.getUTCHours(), 2)}:${pad(local.getUTCMinutes(), 2)}:${pad(
      local.getUTCSeconds(),
      2,
    )}` +
    `${frac}${zone}`
  );
}

/** The same instant spelled in UTC (`Z`), strict profile — or `undefined` when `value` is not an instant under `profile`. */
export function toUtc(value: unknown, profile: InstantProfile): InstantText | undefined {
  const instant = instantOf(value, profile);
  return instant === undefined ? undefined : spellInstant(instant, 0);
}
