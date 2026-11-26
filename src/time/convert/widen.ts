import type { ConvertContext, WidenedConversion, WindowToConvert } from '../convert.js';
import { LOOKBACK_UNITS, spellDuration } from '../duration.js';
import { compareInstants, instantOf, spellInstant, type Instant } from '../instant.js';
import type { PeriodForm } from '../periodForm.js';
import { lookbackRange, type TimeRange } from '../range.js';
import { formZone } from './bounds.js';
import { dateAt, midnightOf, nextDay, spellDate } from './calendar.js';
import { absoluteOf, msOf, spanRange, type Ms } from './instants.js';
import { finestUnitMs } from './lookback.js';

/** The parts of `[sentFrom, sentTo)` outside `[from, to)`, in time order. */
function extraOf(sentFrom: number, sentTo: number, from: number, to: number): TimeRange[] {
  const parts: TimeRange[] = [];
  const before = from > sentFrom ? spanRange(sentFrom, from) : undefined;
  const after = sentTo > to ? spanRange(to, sentTo) : undefined;
  if (before !== undefined) parts.push(before);
  if (after !== undefined) parts.push(after);
  return parts;
}

/** Record widening only when the read-back covers the request, including fractional endpoints. */
function extraOfPrecise(sent: TimeRange, asked: TimeRange): readonly TimeRange[] | undefined {
  const from = instantOf(asked.from, 'strict');
  const to = instantOf(asked.to, 'strict');
  const sentFrom = instantOf(sent.from, 'strict');
  const sentTo = instantOf(sent.to, 'strict');
  if (from === undefined || to === undefined || sentFrom === undefined || sentTo === undefined) {
    return undefined;
  }
  const start = compareInstants(sentFrom, from);
  const end = compareInstants(sentTo, to);
  if (start > 0 || end < 0 || compareInstants(from, to) >= 0) return undefined;

  const utcRange = (from: Instant, to: Instant): TimeRange | undefined => {
    const lower = spellInstant(from, 0);
    const upper = spellInstant(to, 0);
    return lower === undefined || upper === undefined ? undefined : { from: lower, to: upper };
  };
  const before = start < 0 ? utcRange(sentFrom, from) : undefined;
  const after = end > 0 ? utcRange(to, sentTo) : undefined;
  if ((start < 0 && before === undefined) || (end > 0 && after === undefined)) return undefined;
  return [before, after].filter((range): range is TimeRange => range !== undefined);
}

/** A `day` form widened: the one calendar day that holds the whole window. */
function dayWidened(
  window: WindowToConvert,
  form: Extract<PeriodForm, { kind: 'day' }>,
  ctx: ConvertContext,
): Omit<WidenedConversion, 'form'> | undefined {
  const zone = formZone(form, ctx);
  const span = absoluteOf(window, ctx.now);
  if (zone === undefined || span === undefined) return undefined;
  const [from, to] = span;
  const date = dateAt(zone, from.ms);
  if (spellDate(dateAt(zone, to.ms - 1)) !== spellDate(date)) return undefined;
  const start = midnightOf(date, zone);
  const end = midnightOf(nextDay(date), zone);
  if (start === undefined || end === undefined) return undefined;
  const sent = spanRange(start, end);
  if (sent === undefined) return undefined;
  const zoneValue = form.zone !== undefined ? { [form.zone.argument]: ctx.zone } : {};
  return {
    values: { [form.argument]: spellDate(date), ...zoneValue },
    sent,
    extra: extraOf(start, end, from.ms, to.ms),
  };
}

/**
 * A `lookback` form widened: a range that ENDS BEFORE now (past the tool's
 * step) is covered by the look-back from now that reaches its `from` — the
 * smallest length in the form's units. A range ending at now is the exact
 * row's; one ending after it no look-back can hold.
 */
function lookbackWidened(
  window: WindowToConvert,
  form: Extract<PeriodForm, { kind: 'lookback' }>,
  ctx: ConvertContext,
): Omit<WidenedConversion, 'form'> | undefined {
  if (window.lookback !== undefined) return undefined;
  const now = msOf(ctx.now);
  // `absoluteOf` refuses an empty or inverted range, as every other form's reading does — a
  // look-back from now "covering" a range that ends before it starts would read a confident
  // wrong window (its `extra` outside its own `sent`).
  const span = absoluteOf(window, ctx.now);
  if (now === undefined || span === undefined) return undefined;
  const [from, to] = span;
  if (to.ms >= now.ms - ctx.granularityMs) return undefined;
  const units = form.units ?? LOOKBACK_UNITS;
  const finest = finestUnitMs(units);
  const length = Math.ceil((now.ms - from.ms) / finest) * finest;
  const spelled = spellDuration(length, units);
  if (spelled === undefined) return undefined;
  // The look-back reads `[now − L, now]`, both ends inside (`range.ts` · `lookbackRange`).
  const sent = lookbackRange(ctx.now, spelled, units);
  const sentTo = (msOf(sent.to) as Ms).ms;
  return {
    values: { [form.argument]: `${form.signed ? '-' : ''}${spelled}` },
    sent,
    extra: extraOf(now.ms - length, sentTo, from.ms, to.ms),
  };
}

export { dayWidened, extraOfPrecise, lookbackWidened };
