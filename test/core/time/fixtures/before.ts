/**
 * THE GRAMMARS AS THEY STOOD BEFORE STEP T1 — verbatim copies, kept only as
 * the oracle the byte-identity properties compare against. Copied from
 * `src/core/agent/coverage/period.ts` (the instant parser and its compare)
 * and `src/core/agent/arguments/declare.ts` (the three spelling regexes and
 * `parsesUnderSpelling`) on the commit before T1. Never import this from
 * `src/`; never "fix" it — it is the record of the old behaviour.
 */

const INSTANT =
  /^(\d{4})-(\d{2})-(\d{2})[Tt](\d{2}):(\d{2})(?::(\d{2})(?:\.(\d{1,9}))?)?(?:([Zz])|([+-])(\d{2}):(\d{2}))$/;

/** One instant, comparable exactly: whole milliseconds since the epoch, and the fraction below one second in nanoseconds. */
export interface InstantBefore {
  readonly ms: number;
  readonly nanos: number;
}

const daysIn = (year: number, month: number): number =>
  month === 2
    ? year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0)
      ? 29
      : 28
    : [4, 6, 9, 11].includes(month)
    ? 30
    : 31;

/**
 * The instant a string names, or `undefined` when it is not an ISO 8601
 * instant with a zone (a date alone, a time with no zone, a day that does not
 * exist, prose). Exact: no `Date.parse` guessing, no sub-millisecond loss.
 */
export function instantOfBefore(value: unknown): InstantBefore | undefined {
  if (typeof value !== 'string') return undefined;
  const m = INSTANT.exec(value);
  if (m === null) return undefined;
  const [year, month, day, hour, minute] = [m[1], m[2], m[3], m[4], m[5]].map(Number) as [
    number,
    number,
    number,
    number,
    number,
  ];
  const second = m[6] === undefined ? 0 : Number(m[6]);
  if (month < 1 || month > 12 || day < 1 || day > daysIn(year, month)) return undefined;
  // 60 is RFC 3339's leap second; it compares as the next minute's :00.
  if (hour > 23 || minute > 59 || second > 60) return undefined;
  let offsetMinutes = 0;
  if (m[8] === undefined) {
    const sign = m[9] === '-' ? -1 : 1;
    const oh = Number(m[10]);
    const om = Number(m[11]);
    if (oh > 23 || om > 59) return undefined;
    offsetMinutes = sign * (oh * 60 + om);
  }
  // `setUTCFullYear`, never `Date.UTC`: the latter reads years 0–99 as 1900–1999.
  const date = new Date(0);
  date.setUTCFullYear(year, month - 1, day);
  date.setUTCHours(hour, minute, second, 0);
  const nanos = m[7] === undefined ? 0 : Number(m[7].padEnd(9, '0'));
  return { ms: date.getTime() - offsetMinutes * 60_000, nanos };
}

/** -1 / 0 / 1 — `a` before, at, or after `b`. */
export function compareBefore(a: InstantBefore, b: InstantBefore): number {
  if (a.ms !== b.ms) return a.ms < b.ms ? -1 : 1;
  if (a.nanos !== b.nanos) return a.nanos < b.nanos ? -1 : 1;
  return 0;
}

const LOOKBACK = /^[1-9][0-9]*[mhdw]$/;
const SIGNED_LOOKBACK = /^-[1-9][0-9]*[mhdw]$/;
const ISO_INSTANT = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d{1,9})?)?(?:Z|[+-]\d{2}:\d{2})$/;

export type PeriodSpellingBefore = 'lookback' | 'signed-lookback' | 'iso-range';

export function parsesUnderSpellingBefore(value: unknown, spelling: PeriodSpellingBefore): boolean {
  if (typeof value !== 'string') return false;
  switch (spelling) {
    case 'lookback':
      return LOOKBACK.test(value);
    case 'signed-lookback':
      return SIGNED_LOOKBACK.test(value);
    case 'iso-range': {
      const halves = value.split('..');
      return (
        halves.length === 2 &&
        halves.every((h) => ISO_INSTANT.test(h) && !Number.isNaN(Date.parse(h)))
      );
    }
  }
}

/** `periodVerdict`'s comparison as it stood before T1 (the rule set's own checks aside — callers pass well-formed spans). */
export function periodVerdictBefore(period: {
  queried: { from: string; to: string };
  held: { from: string; to: string } | 'unknown';
}): 'covered' | 'partly-held' | 'not-held' | 'unknown' {
  if (period.held === 'unknown') return 'unknown';
  const qFrom = instantOfBefore(period.queried.from) as InstantBefore;
  const qTo = instantOfBefore(period.queried.to) as InstantBefore;
  const hFrom = instantOfBefore(period.held.from) as InstantBefore;
  const hTo = instantOfBefore(period.held.to) as InstantBefore;
  if (compareBefore(hFrom, qFrom) <= 0 && compareBefore(qTo, hTo) <= 0) return 'covered';
  if (compareBefore(qTo, hFrom) < 0 || compareBefore(qFrom, hTo) > 0) return 'not-held';
  return 'partly-held';
}
