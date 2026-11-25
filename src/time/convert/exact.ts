import type { ConvertContext, WindowToConvert } from '../convert.js';
import { needsZone, type BoundAs, type PeriodForm } from '../periodForm.js';
import { wallAt, type ZoneName } from '../zone.js';
import { formZone, writeBound } from './bounds.js';
import { midnightOf, nextDay, spellDate } from './calendar.js';
import { absoluteOf, msOf } from './instants.js';
import { lookbackInto } from './lookback.js';
import { adjacentInstant } from '../windowEndpoint.js';
import { instantOf, spellInstant, type InstantText } from '../instant.js';

const isAbsoluteBound = (as: BoundAs): boolean =>
  as === 'iso' || as === 'epoch-ms' || as === 'epoch-s';

function writeIso(value: InstantText | undefined, utc: boolean) {
  if (value === undefined) return undefined;
  const at = instantOf(value, 'strict');
  if (at === undefined) return undefined;
  const text = utc ? spellInstant(at, 0) : value;
  return text === undefined ? undefined : { value: text, rounded: false };
}

/**
 * A confirmed cutoff as an INCLUSIVE ISO end: the last instant inside on the grid the cutoff
 * sits on — one second before a whole-second cutoff, one millisecond before a millisecond one
 * (the wire law tools were built against, `bounds.ts` · `writeBound`). A cutoff written past
 * the millisecond keeps its exact neighbour, which no coarser grid can name; when that
 * neighbour lands on a grid point the read is a grid step wider, and the write says `rounded`.
 */
function inclusiveIsoEnd(cutoff: InstantText, utc: boolean) {
  const at = instantOf(cutoff, 'strict');
  if (at === undefined) return undefined;
  if (at.nanos !== 0) {
    // One nanosecond past a grid point (an inclusive control point): the neighbour IS that grid
    // point, which a tool reads through its whole second — wider than the window, so not exact.
    const neighbour = adjacentInstant(cutoff, -1);
    const written = writeIso(neighbour, utc);
    const onGrid = neighbour !== undefined && instantOf(neighbour, 'strict')?.nanos === 0;
    return written === undefined ? undefined : { value: written.value, rounded: onGrid };
  }
  const ms = at.ms - (at.ms % 1000 === 0 ? 1_000 : 1);
  const text = spellInstant({ ms, nanos: 0 }, utc ? 0 : at.offsetMinutes);
  return text === undefined ? undefined : { value: text, rounded: false };
}

/** A form that can carry both absolute bounds of a frozen look-back. */
function supportsFrozenLookback(form: PeriodForm): boolean {
  switch (form.kind) {
    case 'bounds':
      return isAbsoluteBound(form.from.as) && isAbsoluteBound(form.to.as);
    case 'joined':
    case 'object':
      return isAbsoluteBound(form.as);
    case 'day':
    case 'lookback':
      return false;
  }
}

/** One form's exact values for a window, or `undefined` when the form does not hold it exactly. */
function convertOne(
  window: WindowToConvert,
  form: PeriodForm,
  ctx: ConvertContext,
): { readonly values: Record<string, unknown>; readonly rounded: boolean } | undefined {
  if (form.kind === 'lookback') {
    const sent = lookbackInto(window, form, ctx);
    return sent === undefined
      ? undefined
      : { values: { [form.argument]: sent.value }, rounded: sent.rounded };
  }
  const zone = formZone(form, ctx);
  if (needsZone(form) && zone === undefined) return undefined;
  const zoneValue: Record<string, unknown> =
    'zone' in form && form.zone !== undefined ? { [form.zone.argument]: ctx.zone } : {};
  const span = absoluteOf(window, ctx.now);
  if (form.kind === 'day') {
    if (span === undefined) return undefined;
    const [from, to] = span;
    const z = zone as ZoneName;
    const wall = wallAt(z, from.ms);
    const date = { year: wall.year, month: wall.month, day: wall.day };
    if (midnightOf(date, z) !== from.ms || midnightOf(nextDay(date), z) !== to.ms) return undefined;
    return { values: { [form.argument]: spellDate(date), ...zoneValue }, rounded: false };
  }
  const fromAs = form.kind === 'bounds' ? form.from.as : form.as;
  const toAs = form.kind === 'bounds' ? form.to.as : form.as;
  // `bounds` / `object` declare their edge (TQ18); only a `joined` form (the sugar's) defaults.
  const edge =
    form.kind === 'joined'
      ? form.edge ?? 'inclusive'
      : form.kind === 'bounds'
      ? form.to.edge
      : form.edge;
  const exactFrom = window.endpoint !== undefined && fromAs === 'iso';
  const exactTo = window.endpoint !== undefined && toAs === 'iso';
  const utc = window.freezeLookback === true;
  // The other bound may be fractional ISO and prevent a millisecond pair.
  const from = span?.[0] ?? (exactTo ? msOf(window.range.from) : undefined);
  const to = span?.[1] ?? (exactFrom ? msOf(window.range.to) : undefined);
  const a = exactFrom
    ? writeIso(window.range.from, utc)
    : from === undefined
    ? undefined
    : writeBound(from, 'from', fromAs, 'inclusive', zone);
  const b = exactTo
    ? edge === 'exclusive'
      ? writeIso(window.range.to, utc)
      : inclusiveIsoEnd(window.range.to, utc)
    : to === undefined
    ? undefined
    : writeBound(to, 'to', toAs, edge, zone);
  if (a === undefined || b === undefined) return undefined;
  const rounded = a.rounded || b.rounded;
  switch (form.kind) {
    case 'bounds':
      return {
        values: { [form.from.argument]: a.value, [form.to.argument]: b.value, ...zoneValue },
        rounded,
      };
    case 'joined':
      return {
        values: { [form.argument]: `${a.value}${form.joiner}${b.value}`, ...zoneValue },
        rounded,
      };
    case 'object':
      return {
        values: {
          [form.argument]: { [form.keys.from]: a.value, [form.keys.to]: b.value },
          ...zoneValue,
        },
        rounded,
      };
  }
}

export { convertOne, supportsFrozenLookback };
