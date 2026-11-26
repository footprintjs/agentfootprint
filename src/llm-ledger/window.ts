/**
 * llm-ledger/window — the ledger's one instant validator, and the window built on it.
 *
 * Pattern: a validator, not a second grammar. It accepts a strict SUBSET of
 *          what `time/instant.ts` · `instantOf` accepts in its `strict`
 *          profile, and gives the same epoch milliseconds for every string it
 *          accepts — pinned by `test/llm-ledger/window-differential.test.ts`.
 *          It is the one named exception to "no other file parses an
 *          instant", because this folder is a closed leaf and cannot import
 *          `src/time/`.
 * Role:    the closed leaf's time check: a receipt's and a note's `window`,
 *          and every entry's `at`.
 * Emits:   N/A.
 *
 * ## The grammar
 *
 * `YYYY-MM-DDTHH:MM:SS[.f]` then `Z` or `±HH:MM`:
 *
 *   - upper-case `T` and `Z` only;
 *   - seconds required, 0–59 (no leap second);
 *   - a fraction of 1–3 digits (millisecond precision), or none;
 *   - a day that exists in its month; hours 0–23; an offset of at most ±23:59.
 *
 * Anything else is refused. A window is `{ from, to }`, half-open, with
 * `from` strictly before `to`; the strings are kept as written.
 */
import type { LedgerWindow } from './types.js';

const INSTANT =
  /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.(\d{1,3}))?(?:(Z)|([+-])(\d{2}):(\d{2}))$/;

/** Days in `month` (1–12) of the proleptic Gregorian `year`. */
function daysIn(year: number, month: number): number {
  if (month === 2) return year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0) ? 29 : 28;
  return month === 4 || month === 6 || month === 9 || month === 11 ? 30 : 31;
}

/**
 * The epoch milliseconds an instant names, or `undefined` when `value` is not
 * one under the grammar above.
 */
export function instantMs(value: unknown): number | undefined {
  if (typeof value !== 'string') return undefined;
  const m = INSTANT.exec(value);
  if (m === null) return undefined;
  const [year, month, day, hour, minute, second] = [m[1], m[2], m[3], m[4], m[5], m[6]].map(
    Number,
  ) as [number, number, number, number, number, number];
  if (month < 1 || month > 12 || day < 1 || day > daysIn(year, month)) return undefined;
  if (hour > 23 || minute > 59 || second > 59) return undefined;
  let offsetMinutes = 0;
  if (m[8] === undefined) {
    const offsetHours = Number(m[10]);
    const offsetMins = Number(m[11]);
    if (offsetHours > 23 || offsetMins > 59) return undefined;
    offsetMinutes = (m[9] === '-' ? -1 : 1) * (offsetHours * 60 + offsetMins);
  }
  const millis = m[7] === undefined ? 0 : Number(m[7].padEnd(3, '0'));
  // `setUTCFullYear`, never `Date.UTC`: the latter reads years 0–99 as 1900–1999.
  const date = new Date(0);
  date.setUTCFullYear(year, month - 1, day);
  date.setUTCHours(hour, minute, second, millis);
  return date.getTime() - offsetMinutes * 60_000;
}

/** Whether `value` is an instant in UTC (`Z`): what every entry's `at` must be. */
export function isUtcInstant(value: unknown): value is string {
  return typeof value === 'string' && value.endsWith('Z') && instantMs(value) !== undefined;
}

/**
 * The window `value` names, as a fresh frozen `{ from, to }`, or `undefined`
 * (the refusal `bad-window`) when it is not exactly those two keys, both
 * instants, with `from` before `to`.
 */
export function readWindow(value: unknown): LedgerWindow | undefined {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return undefined;
  const proto = Object.getPrototypeOf(value);
  if (proto !== Object.prototype && proto !== null) return undefined;
  const keys = Reflect.ownKeys(value);
  if (keys.length !== 2 || !keys.includes('from') || !keys.includes('to')) return undefined;
  // Read through descriptors, so a getter is never called: an accessor has no `value`, and
  // `undefined` is not an instant, so an accessor end is refused like any other non-instant.
  const fromField = Object.getOwnPropertyDescriptor(value, 'from');
  const toField = Object.getOwnPropertyDescriptor(value, 'to');
  const from = instantMs(fromField?.value);
  const to = instantMs(toField?.value);
  if (from === undefined || to === undefined || from >= to) return undefined;
  return Object.freeze({ from: fromField?.value as string, to: toField?.value as string });
}
