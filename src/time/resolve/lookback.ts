import { lookbackRange, type TimeRange } from '../range.js';
import type { TimeParts } from '../reader.js';
import type { ResolveClock } from '../resolveRecord.js';
import type { Built, Unresolved } from './types.js';
import { lookbackZoneReadsOf, viaOf, type ZonePolicy } from './zones.js';

const LOOKBACK_LETTER: Readonly<Record<string, string>> = {
  second: 's',
  minute: 'm',
  hour: 'h',
  day: 'd',
  week: 'w',
};

/** Elapsed instants stay anchored at the message; the zone is what the person asked to see. */
export function lookbackBuilt(
  parts: TimeParts,
  clock: ResolveClock,
  policy: ZonePolicy | undefined,
): Built[] | Unresolved | undefined {
  const rel = parts.relative;
  if (rel === undefined || !('count' in rel)) return undefined;
  if (Object.keys(parts).some((k) => k !== 'relative' && k !== 'zoneToken')) {
    return { unsupported: 'a look-back with other parts' };
  }
  const duration = `${rel.count}${LOOKBACK_LETTER[rel.unit] as string}`;
  let range: TimeRange;
  try {
    range = lookbackRange(clock.now, duration, 'smhdw');
  } catch {
    return { unsupported: 'a look-back past the calendar' };
  }
  const zones = lookbackZoneReadsOf(parts.zoneToken, clock.zone, policy);
  if (!Array.isArray(zones)) return zones;
  return zones.map(({ read, zone, unconverted }) => {
    const via = viaOf(read);
    return {
      said:
        parts.zoneToken === undefined ? (['duration'] as const) : (['zone', 'duration'] as const),
      candidate: {
        window: { kind: 'lookback' as const, duration },
        range,
        zone,
        grain: rel.unit,
        implied: [],
        anchor: 'message' as const,
        notes: [
          ...via.notes,
          ...(unconverted !== undefined
            ? [{ kind: 'zone-unconverted' as const, token: unconverted }]
            : []),
        ],
        reading: via.tags,
      },
    };
  });
}
