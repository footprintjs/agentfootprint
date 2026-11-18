import { utcWallMs } from '../instant.js';
import { readWall, wallAt, type WallTime, type ZoneName } from '../zone.js';

// ─── Wall times and dates as text (the parsers are periodForm.ts') ─────

const pad = (n: number, width: number): string => String(n).padStart(width, '0');

function spellWall(wall: WallTime, withMs: boolean): string {
  const base =
    `${pad(wall.year, 4)}-${pad(wall.month, 2)}-${pad(wall.day, 2)}` +
    `T${pad(wall.hour, 2)}:${pad(wall.minute, 2)}:${pad(wall.second ?? 0, 2)}`;
  return withMs ? `${base}.${pad(wall.millisecond ?? 0, 3)}` : base;
}

const spellDate = (d: { year: number; month: number; day: number }): string =>
  `${pad(d.year, 4)}-${pad(d.month, 2)}-${pad(d.day, 2)}`;

/** The calendar day after `d` (proleptic Gregorian). */
function nextDay(d: { year: number; month: number; day: number }) {
  const ms = utcWallMs(d.year, d.month, d.day, 0, 0, 0) + 86_400_000;
  const t = new Date(ms);
  return { year: t.getUTCFullYear(), month: t.getUTCMonth() + 1, day: t.getUTCDate() };
}

/** The calendar day before `d`. */
function previousDay(d: { year: number; month: number; day: number }) {
  const ms = utcWallMs(d.year, d.month, d.day, 0, 0, 0) - 86_400_000;
  const t = new Date(ms);
  return { year: t.getUTCFullYear(), month: t.getUTCMonth() + 1, day: t.getUTCDate() };
}

/** The one instant a wall time names in `zone` — `undefined` in a doubled or skipped hour. */
function uniqueInstant(wall: WallTime, zone: ZoneName): number | undefined {
  const reading = readWall(wall, zone);
  return reading.kind === 'unique' ? reading.ms : undefined;
}

/** The first instant of a calendar day in `zone`, when exactly one instant is it. */
const midnightOf = (d: { year: number; month: number; day: number }, zone: ZoneName) =>
  uniqueInstant({ ...d, hour: 0, minute: 0 }, zone);

/** The calendar date an instant falls on in `zone`. */
function dateAt(zone: ZoneName, ms: number) {
  const wall = wallAt(zone, ms);
  return { year: wall.year, month: wall.month, day: wall.day };
}

export { spellWall, spellDate, nextDay, previousDay, uniqueInstant, midnightOf, dateAt };
