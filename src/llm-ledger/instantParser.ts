// Generated from src/time/instant.ts by scripts/gen-ledger-instant.mjs.

/** Which spelling of an instant is accepted — see the module table. */
type InstantProfile = 'lenient' | 'strict';

/**
 * One instant, comparable exactly: whole milliseconds since the epoch, and the
 * nanoseconds below that millisecond (0–999 999), so a 9-digit fraction is
 * never rounded.
 */
interface Instant {
  readonly ms: number;
  readonly nanos: number;
}

/** A parsed instant: the instant, the offset it was written in, and how finely it was written. */
interface ParsedInstant extends Instant {
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
const daysInMonth = (year: number, month: number): number =>
  month === 2
    ? year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0)
      ? 29
      : 28
    : [4, 6, 9, 11].includes(month)
    ? 30
    : 31;

/** Milliseconds since the epoch of a UTC wall time. `setUTCFullYear`, never `Date.UTC`: the latter reads years 0–99 as 1900–1999. */
function utcWallMs(
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
