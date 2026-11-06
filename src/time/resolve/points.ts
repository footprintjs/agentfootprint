import type { Grain } from '../present.js';
import type { TimeParts } from '../reader.js';
import type { ReadingTags, ResolveClock, TimeNote, TimePart } from '../resolveRecord.js';
import type { WallTime } from '../zone.js';
import { addDays, datesOf, nextDay } from './calendar.js';
import type { Unresolved } from './types.js';
import { dayStart, GRAIN_MS, hoursOf, instantsOf, wallIn, type Instantly } from './wallClock.js';
import { viaOf, zoneReadsOf, type ZonePolicy, type ZoneRead } from './zones.js';

// ─── One side: a point read at its grain ─────────────────────────────────

export interface Point {
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

/**
 * The points of one side. `dayAfter` reads its date one calendar day later —
 * only for the right side of an overnight range (`overnightPairs`), whose day
 * is the left side's.
 */
export function pointsOf(
  parts: TimeParts,
  clock: ResolveClock,
  nowMs: number,
  policy: ZonePolicy | undefined,
  dayAfter = false,
): Point[] | Unresolved {
  if (parts.partOfDay !== undefined) return { unsupported: 'a part of the day' };
  if (parts.anchor !== undefined) return { unsupported: 'a window anchored on the previous one' };
  const zones = zoneReadsOf(parts.zoneToken, clock.zone, policy);
  if (zones === undefined) return { needsZone: true };
  const out: Point[] = [];
  for (const zone of zones) {
    const points = pointsIn(parts, zone, nowMs, dayAfter);
    if (!Array.isArray(points)) return points;
    out.push(...points);
  }
  return out;
}

/** The points of the parts under ONE zone read. */
function pointsIn(
  parts: TimeParts,
  zone: ZoneRead,
  nowMs: number,
  dayAfter: boolean,
): Point[] | Unresolved {
  const read = datesOf(parts, wallIn(zone, nowMs));
  if (!Array.isArray(read)) return read;
  const dates = dayAfter ? read.map(nextDay) : read;
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
