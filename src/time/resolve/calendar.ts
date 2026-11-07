import { daysInMonth, utcWallMs } from '../instant.js';
import type { TimeParts } from '../reader.js';
import type { ReadingTags, TimeNote, TimePart } from '../resolveRecord.js';
import type { WallTime } from '../zone.js';

/** The calendar day `days` after `y-m-d`. */
export function addDays(y: number, m: number, d: number, days: number): [number, number, number] {
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
export function datesOf(
  parts: TimeParts,
  today: WallTime,
): DateReading[] | { unsupported: string } {
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

/** The same reading of a date, one calendar day later. */
export function nextDay(date: DateReading): DateReading {
  const [y, m, d] = addDays(date.y, date.m, date.d, 1);
  return { ...date, y, m, d };
}
