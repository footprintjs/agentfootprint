import { utcWallMs } from '../instant.js';
import { isWallTime, offsetAt, readWall, wallAt, wallToInstant, type WallTime } from '../zone.js';
import type { TimeWall } from '../reader.js';
import type { ZoneRead } from './zones.js';

/** The wall time an instant shows under a zone read. */
export function wallIn(zone: ZoneRead, ms: number): WallTime {
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
export function offsetFor(zone: ZoneRead, ms: number): number {
  return zone.kind === 'offset' ? zone.minutes : offsetAt(zone.zone, ms);
}

export interface Instantly {
  readonly ms: number;
  readonly dst?: { readonly kind: 'dst-overlap' | 'dst-gap'; readonly which: 'earlier' | 'later' };
}

/** Every instant a wall time names under a zone read (two in a DST overlap or gap). */
export function instantsOf(wall: WallTime, zone: ZoneRead): Instantly[] {
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
export function dayStart(y: number, m: number, d: number, zone: ZoneRead): number | undefined {
  const wall = { year: y, month: m, day: d, hour: 0, minute: 0 };
  if (!isWallTime(wall)) return undefined;
  if (zone.kind === 'offset') return utcWallMs(y, m, d, 0, 0, 0) - zone.minutes * 60_000;
  return wallToInstant(wall, zone.zone, 'compatible');
}

// ─── Clock times ─────────────────────────────────────────────────────────

/**
 * The 24-hour readings of a clock time: one, or am and pm when no meridiem
 * settles an hour 1–12 — unless the text's form is a 24-hour clock (an ISO
 * instant, `clock: '24h'`), which says the hour as written.
 */
export function hoursOf(wall: TimeWall): { readonly h: number; readonly meridiem?: 'am' | 'pm' }[] {
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

export const GRAIN_MS: Readonly<Record<'hour' | 'minute' | 'second', number>> = {
  hour: 3_600_000,
  minute: 60_000,
  second: 1_000,
};
