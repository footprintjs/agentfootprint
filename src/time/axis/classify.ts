import type { DatasetTimeAxis } from '../axis.js';
import { instantOf, type Instant } from '../instant.js';
import { readWall, type WallReading, type WallTime, type ZoneName } from '../zone.js';

import { epochInstant, spellable } from './instants.js';
import { isRecord } from './value.js';

/** One value's first reading, before the fall-back rule. */
export type Classified =
  | { readonly kind: 'missing' | 'unreadable' | 'naive' | 'gap' }
  | { readonly kind: 'instant'; readonly instant: Instant; readonly wall?: number }
  | {
      readonly kind: 'overlap';
      readonly earlier: Instant;
      readonly later: Instant;
      readonly wall: number;
      readonly day: string;
    };

const DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/;

/**
 * An ISO value with no offset, read as a UTC WALL reading only to get its
 * fields — never as an instant. `undefined` when it is not a date-time (or a
 * date) with no zone.
 */
function naiveFields(value: string): Instant | undefined {
  const spelled = DATE_ONLY.test(value) ? `${value}T00:00Z` : `${value}Z`;
  return instantOf(spelled, 'lenient');
}

function wallOf(fields: Instant): WallTime {
  const d = new Date(fields.ms);
  return {
    year: d.getUTCFullYear(),
    month: d.getUTCMonth() + 1,
    day: d.getUTCDate(),
    hour: d.getUTCHours(),
    minute: d.getUTCMinutes(),
    second: d.getUTCSeconds(),
    millisecond: d.getUTCMilliseconds(),
  };
}

function classifyIso(
  value: unknown,
  zone: ZoneName | undefined,
  walls: Map<number, WallReading>,
): Classified {
  if (typeof value !== 'string') return { kind: 'unreadable' };
  const instant = instantOf(value, 'lenient');
  if (instant !== undefined) return { kind: 'instant', instant };
  const fields = naiveFields(value);
  if (fields === undefined) return { kind: 'unreadable' };
  if (zone === undefined) return { kind: 'naive' };
  const wall = fields.ms;
  let reading = walls.get(wall);
  if (reading === undefined) {
    const w = wallOf(fields);
    if (w.year > 9999) return { kind: 'unreadable' };
    reading = readWall(w, zone);
    walls.set(wall, reading);
  }
  const at = (ms: number): Instant => ({ ms, nanos: fields.nanos });
  if (reading.kind === 'gap') return { kind: 'gap' };
  if (reading.kind === 'unique') return { kind: 'instant', instant: at(reading.ms), wall };
  return {
    kind: 'overlap',
    earlier: at(reading.earlier),
    later: at(reading.later),
    wall,
    day: value.slice(0, 10),
  };
}

function classifyEpoch(value: unknown, unit: 'epoch-s' | 'epoch-ms'): Classified {
  const instant = epochInstant(value, unit);
  return instant === undefined ? { kind: 'unreadable' } : { kind: 'instant', instant };
}

export function classify(
  row: unknown,
  axis: DatasetTimeAxis,
  walls: Map<number, WallReading>,
): Classified {
  if (!isRecord(row)) return { kind: 'missing' };
  const value = row[axis.column];
  if (value === undefined || value === null) return { kind: 'missing' };
  const read =
    axis.unit === 'iso' ? classifyIso(value, axis.zone, walls) : classifyEpoch(value, axis.unit);
  if (read.kind === 'instant' && !spellable(read.instant)) return { kind: 'unreadable' };
  if (read.kind === 'overlap' && !(spellable(read.earlier) && spellable(read.later))) {
    return { kind: 'unreadable' };
  }
  return read;
}
