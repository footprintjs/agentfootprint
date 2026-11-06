/** Map: select the existing display zone from both typed endpoint offsets. */
import { instantOf } from '../../../../../time/instant.js';
import type { TimeRange } from '../../../../../time/range.js';
import { fixedOffsetZone, offsetAt, type ZoneName } from '../../../../../time/zone.js';

/**
 * The zone a window the person TYPED is recorded in: the first of the
 * offered readings' zones — then the app's — whose offsets at both ends are
 * the ones typed; else the fixed-offset zone the typed offsets spell
 * (`Etc/GMT-1` for `+01:00`, `zone.ts` · `fixedOffsetZone`); else the app's.
 * A London day typed with `+01:00` under an app in Los Angeles is recorded
 * in Europe/London (the zone the mention named), never in the app's zone.
 */
export function editedZone(
  range: TimeRange,
  offered: readonly ZoneName[] | undefined,
  appZone: ZoneName | undefined,
): ZoneName | undefined {
  const from = instantOf(range.from, 'lenient');
  const to = instantOf(range.to, 'lenient');
  if (from === undefined || to === undefined) return appZone;
  const shows = (zone: ZoneName): boolean =>
    offsetAt(zone, from.ms) === from.offsetMinutes && offsetAt(zone, to.ms) === to.offsetMinutes;
  const zones = [...(offered ?? []), ...(appZone !== undefined ? [appZone] : [])];
  const match = zones.find(shows);
  if (match !== undefined) return match;
  const fixed =
    from.offsetMinutes === to.offsetMinutes ? fixedOffsetZone(from.offsetMinutes) : undefined;
  return fixed ?? appZone;
}
