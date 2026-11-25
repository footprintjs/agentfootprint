import { instantOf, spellInstant } from '../instant.js';
import { dateOf, epochFromText, wallOf, type BoundAs, type PeriodForm } from '../periodForm.js';
import type { Edge, TimeRange } from '../range.js';
import { readControlWindow } from '../windowEndpoint.js';
import { isZoneName, wallAt, type ZoneName } from '../zone.js';
import {
  midnightOf,
  nextDay,
  previousDay,
  spellDate,
  spellWall,
  uniqueInstant,
} from './calendar.js';
import { spanRange, type Ms } from './instants.js';

/** The zone a wall or date form is written in: its zone argument's (the window's), else the app's under `wallZone`. */
function formZone(
  form: PeriodForm,
  ctx: { readonly zone?: ZoneName; readonly appZone?: ZoneName },
) {
  return 'zone' in form && form.zone !== undefined ? ctx.zone : ctx.appZone;
}

/** One bound written in `as`: the value, and whether writing it moved the instant (epoch seconds, outward). */
function writeBound(
  at: Ms,
  which: 'from' | 'to',
  as: BoundAs,
  edge: Edge,
  zone: ZoneName | undefined,
): { readonly value: string | number; readonly rounded: boolean } | undefined {
  switch (as) {
    case 'iso': {
      const step = at.ms % 1000 === 0 ? 1_000 : 1;
      const ms = which === 'to' && edge === 'inclusive' ? at.ms - step : at.ms;
      const text = spellInstant({ ms, nanos: 0 }, at.offsetMinutes);
      return text === undefined ? undefined : { value: text, rounded: false };
    }
    case 'epoch-ms':
      return { value: which === 'to' && edge === 'inclusive' ? at.ms - 1 : at.ms, rounded: false };
    case 'epoch-s': {
      const whole =
        which === 'from' ? Math.floor(at.ms / 1000) * 1000 : Math.ceil(at.ms / 1000) * 1000;
      const seconds = whole / 1000 - (which === 'to' && edge === 'inclusive' ? 1 : 0);
      return { value: seconds, rounded: whole !== at.ms };
    }
    case 'wall': {
      if (zone === undefined) return undefined;
      const step = at.ms % 1000 === 0 ? 1_000 : 1;
      const ms = which === 'to' && edge === 'inclusive' ? at.ms - step : at.ms;
      const wall = wallAt(zone, ms);
      // Exact only when the tool reads the wall time back as this instant.
      if (uniqueInstant(wall, zone) !== ms) return undefined;
      return { value: spellWall(wall, step === 1), rounded: false };
    }
    case 'date': {
      if (zone === undefined) return undefined;
      const wall = wallAt(zone, at.ms);
      const date = { year: wall.year, month: wall.month, day: wall.day };
      if (midnightOf(date, zone) !== at.ms) return undefined;
      const day = which === 'to' && edge === 'inclusive' ? previousDay(date) : date;
      return { value: spellDate(day), rounded: false };
    }
  }
}

// ─── Reading a sent value back ───────────────────────────────────────────

/** A bound read back: the instant it names as a half-open end, in milliseconds. */
function readBound(
  value: unknown,
  which: 'from' | 'to',
  as: BoundAs,
  edge: Edge,
  zone: ZoneName | undefined,
): number | undefined {
  const inclusiveTo = which === 'to' && edge === 'inclusive';
  switch (as) {
    case 'iso': {
      const at = instantOf(value, 'strict');
      if (at === undefined || at.nanos !== 0) return undefined;
      const step = at.precision === 'minute' ? 60_000 : at.precision === 'second' ? 1_000 : 1;
      return inclusiveTo ? at.ms + step : at.ms;
    }
    case 'epoch-ms':
      if (typeof value !== 'number' || !Number.isSafeInteger(value)) return undefined;
      return inclusiveTo ? value + 1 : value;
    case 'epoch-s':
      if (typeof value !== 'number' || !Number.isSafeInteger(value)) return undefined;
      return (inclusiveTo ? value + 1 : value) * 1000;
    case 'wall': {
      if (zone === undefined) return undefined;
      const read = wallOf(value);
      if (read === undefined) return undefined;
      const ms = uniqueInstant(read.wall, zone);
      return ms === undefined ? undefined : inclusiveTo ? ms + read.stepMs : ms;
    }
    case 'date': {
      if (zone === undefined) return undefined;
      const date = dateOf(value);
      if (date === undefined) return undefined;
      return midnightOf(inclusiveTo ? nextDay(date) : date, zone);
    }
  }
}

/** Read each bound on its own declared grid, with ISO cutoffs as exact points when confirmed. */
function readPeriodBounds(
  lower: { readonly value: unknown; readonly as: BoundAs },
  upper: { readonly value: unknown; readonly as: BoundAs },
  edge: Edge,
  zone: ZoneName | undefined,
  precise: true | undefined,
): TimeRange | undefined {
  if (precise === true && (lower.as === 'iso' || upper.as === 'iso')) {
    const atUtc = (ms: number | undefined) =>
      ms === undefined ? undefined : spellInstant({ ms, nanos: 0 }, 0);
    const from =
      lower.as === 'iso'
        ? lower.value
        : atUtc(readBound(lower.value, 'from', lower.as, 'inclusive', zone));
    const to =
      upper.as === 'iso' ? upper.value : atUtc(readBound(upper.value, 'to', upper.as, edge, zone));
    const window = readControlWindow({ from, to, end: upper.as === 'iso' ? edge : 'exclusive' });
    return window === undefined ? undefined : { from: window.from, to: window.to };
  }
  const from = readBound(lower.value, 'from', lower.as, 'inclusive', zone);
  const to = readBound(upper.value, 'to', upper.as, edge, zone);
  return from === undefined || to === undefined ? undefined : spanRange(from, to);
}

const epochOrText = (as: BoundAs, text: string): unknown =>
  as === 'epoch-ms' || as === 'epoch-s' ? epochFromText(text) : text;

/** The zone `form`'s arguments are read in: the zone argument's value when the form has one, else the app's. */
function readZone(
  args: Readonly<Record<string, unknown>>,
  form: PeriodForm,
  ctx: { readonly appZone?: ZoneName },
): ZoneName | undefined {
  const sentZone = 'zone' in form && form.zone !== undefined ? args[form.zone.argument] : undefined;
  return formZone(form, {
    zone: isZoneName(sentZone) ? sentZone : undefined,
    ...(ctx.appZone !== undefined && { appZone: ctx.appZone }),
  });
}

export { formZone, writeBound, readBound, readPeriodBounds, epochOrText, readZone };
