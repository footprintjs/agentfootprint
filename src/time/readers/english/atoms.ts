import type { TimeDate, TimeWall } from '../../reader.js';
import type { Atom } from './types.js';
import { attachZone } from './zones.js';
import {
  BARE_HOUR,
  DAY_WORD,
  DAY_WORDS,
  ISO,
  matches,
  MONTH_DATE,
  MONTH_NUMBERS,
  NUMERIC,
  ONE_SPAN,
  SPAN,
  SPAN_UNITS,
  WALL_COLON,
  WALL_MERIDIEM,
} from './grammar.js';

const num = (text: string | undefined): number | undefined =>
  text === undefined ? undefined : Number(text);

function wallOf(
  h: number,
  m?: number,
  s?: number,
  meridiem?: 'am' | 'pm',
  clock?: '24h',
): TimeWall | undefined {
  if (!Number.isInteger(h) || h > 23) return undefined;
  if (m !== undefined && m > 59) return undefined;
  if (s !== undefined && s > 59) return undefined;
  if (meridiem !== undefined && (h < 1 || h > 12)) return undefined;
  return {
    h,
    ...(m !== undefined && { m }),
    ...(s !== undefined && { s }),
    ...(meridiem !== undefined && { meridiem }),
    ...(clock !== undefined && { clock }),
  };
}

function isoAtoms(text: string): Atom[] {
  const out: Atom[] = [];
  for (const m of matches(ISO, text)) {
    const [, y, mo, d, h, mi, s, zone] = m;
    const date: TimeDate = { kind: 'fixed', year: Number(y), month: Number(mo), day: Number(d) };
    // An ISO time is a 24-hour clock by its form: `T08:00` is 8 AM, never also 8 PM.
    const wall =
      h === undefined ? undefined : wallOf(Number(h), Number(mi), num(s), undefined, '24h');
    if (h !== undefined && wall === undefined) continue;
    out.push({
      start: m.index,
      end: m.index + m[0].length,
      kind: 'instant',
      date,
      ...(wall !== undefined && { wall }),
      ...(zone !== undefined && { zoneToken: zone }),
    });
  }
  return out;
}

function numericAtoms(text: string): Atom[] {
  const out: Atom[] = [];
  for (const m of matches(NUMERIC, text)) {
    const [, a, b, c] = m as unknown as [string, string, string, string | undefined];
    if (a.length === 3 || (a.length === 4 && c === undefined)) continue;
    const fields = [Number(a), Number(b), ...(c !== undefined ? [Number(c)] : [])];
    const yearDigits: 2 | 4 | undefined =
      c === undefined ? undefined : a.length === 4 ? 4 : (c.length as 2 | 4);
    out.push({
      start: m.index,
      end: m.index + m[0].length,
      kind: 'date',
      date: { kind: 'numeric', fields, ...(yearDigits !== undefined && { yearDigits }) },
    });
  }
  return out;
}

function monthAtoms(text: string): Atom[] {
  const out: Atom[] = [];
  for (const m of matches(MONTH_DATE, text)) {
    const name = (m[1] ?? m[4]) as string;
    // `may` in lower case is the verb (`it may 3 times`), never a month.
    if (name.toLowerCase() === 'may' && name !== 'May') continue;
    const month = MONTH_NUMBERS[name.slice(0, 3).toLowerCase()];
    const day = Number(m[2] ?? m[3]);
    if (month === undefined || day < 1 || day > 31) continue;
    const year = num(m[5]);
    out.push({
      start: m.index,
      end: m.index + m[0].length,
      kind: 'date',
      date: { kind: 'fixed', month, day, ...(year !== undefined && { year }) },
    });
  }
  return out;
}

function wallAtoms(text: string): Atom[] {
  const out: Atom[] = [];
  for (const m of matches(WALL_MERIDIEM, text)) {
    const meridiem = (m[4] as string).toLowerCase().startsWith('a') ? 'am' : 'pm';
    const wall = wallOf(Number(m[1]), num(m[2]), num(m[3]), meridiem);
    if (wall !== undefined) {
      out.push({ start: m.index, end: m.index + m[0].length, kind: 'wall', wall });
    }
  }
  for (const m of matches(WALL_COLON, text)) {
    const wall = wallOf(Number(m[1]), Number(m[2]), num(m[3]));
    if (wall !== undefined) {
      out.push({ start: m.index, end: m.index + m[0].length, kind: 'wall', wall });
    }
  }
  for (const m of matches(BARE_HOUR, text)) {
    const wall = wallOf(Number(m[1]));
    if (wall !== undefined) {
      out.push({ start: m.index, end: m.index + m[0].length, kind: 'bare', wall });
    }
  }
  return out;
}

function wordAtoms(text: string): Atom[] {
  const out: Atom[] = [];
  for (const m of matches(DAY_WORD, text)) {
    const offset = DAY_WORDS[(m[1] as string).toLowerCase()] as number;
    out.push({
      start: m.index,
      end: m.index + m[0].length,
      kind: 'day',
      relative: { unit: 'day', offset },
    });
  }
  for (const m of matches(SPAN, text)) {
    const count = Number(m[1]);
    const unit = SPAN_UNITS[(m[2] as string).toLowerCase().replace(/s$/, '')];
    if (unit === undefined || count < 1 || count > 100_000) continue;
    out.push({
      start: m.index,
      end: m.index + m[0].length,
      kind: 'span',
      relative: { unit, count },
    });
  }
  for (const m of matches(ONE_SPAN, text)) {
    const unit = SPAN_UNITS[(m[1] as string).toLowerCase()] as 'hour' | 'day' | 'week';
    out.push({
      start: m.index,
      end: m.index + m[0].length,
      kind: 'span',
      relative: { unit, count: 1 },
    });
  }
  return out;
}

/** The v1 phrases, overlaps settled: the earlier, then the longer, wins. */
export function atomsOf(text: string): Atom[] {
  const all = [
    ...isoAtoms(text),
    ...numericAtoms(text),
    ...monthAtoms(text),
    ...wallAtoms(text),
    ...wordAtoms(text),
  ];
  all.sort((a, b) => a.start - b.start || b.end - b.start - (a.end - a.start));
  const kept: Atom[] = [];
  for (const atom of all) {
    const last = kept[kept.length - 1];
    if (last !== undefined && atom.start < last.end) continue;
    kept.push({ ...atom });
  }
  for (const atom of kept) attachZone(text, atom);
  // A zone written after a phrase may cover a phrase found on its own (`UTC-07:00` holds `07:00`).
  const out: Atom[] = [];
  for (const atom of kept) {
    const last = out[out.length - 1];
    if (last === undefined || atom.start >= last.end) out.push(atom);
  }
  return out;
}
