/**
 * core/time/convert — a tool's period FORMS (time design § 7.1) and the EXACT
 * conversions of one range into them (§ 7.2), with the inverse a binding reads.
 *
 * Pattern: one table per direction. A tool declares every SHAPE its period
 *          takes (`PeriodForm` — two arguments, one joined string, an object,
 *          a day, a look-back); the library converts a resolved range into the
 *          first form that holds it EXACTLY ({@link convertExact}) and reads a
 *          sent value back into a range ({@link readBack}). Both cross the
 *          argument boundary of § 3.3 through `range.ts` (`boundInto` /
 *          `boundFrom` for a `to` bound; `lookbackRange` for a look-back) —
 *          never inline.
 * Role:    core/ leaf (the time layer). Imports `instant.ts`, `duration.ts`,
 *          `range.ts`, `zone.ts` and `periodForm.ts` — the declaration half
 *          (the shapes, the sugar, each form's own rules, a declared value's
 *          spelling, the tool's facts), split out for the synchronous doors
 *          (`arguments/declare.ts`, `ask.ts`, `rows.ts`) and re-exported
 *          here. Asked by `bind.ts` (the fill and the binding) and `drift.ts`,
 *          which only an armed agent loads.
 * Emits:   N/A.
 *
 * ## The sugar (§ 7.1)
 *
 * | Sugar | Means |
 * |-------|-------|
 * | `{ argument, spelling: 'lookback' }` | `{ kind: 'lookback', argument, signed: false }` |
 * | `spelling: 'signed-lookback'` | the same with `signed: true` |
 * | `spelling: 'iso-range'` | `{ kind: 'joined', argument, as: 'iso', joiner: '..', edge: 'inclusive' }` |
 * | `'wall-range'` + `zoneArgument` | `{ kind: 'joined', argument, as: 'wall', joiner: '..', edge: 'inclusive', zone: { argument } }` |
 * | `accepts: [a, b]` | `[sugar(a), sugar(b)]` |
 *
 * ## The exact rows (§ 7.2) — what {@link convertExact} sends
 *
 * | Asked | Form | Sent | Note |
 * |-------|------|------|------|
 * | a look-back | `lookback` | the same length, the sign added or removed, respelled in the form's `units` | none when no unit of `units` spells it |
 * | a look-back | `bounds` / `joined` / `object` | `[now − L, now)` in that `as` | |
 * | a range | `bounds` / `joined` / `object`, `as` `iso` · `epoch-ms` · `epoch-s` | the range; a `to` bound per its `edge` | `epoch-s` rounds outward to whole seconds: `rounded` |
 * | a range | `as: 'wall'` / `'date'` + a zone | the wall times (dates) in the zone | exact only when the tool reads back the same instants (no doubled hour; a date only at midnights) |
 * | a whole day | `day` | that day | any other range is not exact — see the inexact rows |
 * | a range ending at now (within `granularity`) | `lookback` | the smallest spelling in `units` that covers `from` | `rounded` when it is longer |
 *
 * Every other row of § 7.2 is not exact, and {@link convertExact} answers
 * `undefined` for it.
 *
 * ## The inexact rows (§ 7.2, step T5b) — what {@link convertWidened} sends
 *
 * | Asked | Form | Sent | Reads |
 * |-------|------|------|-------|
 * | a range inside one calendar day (in the form's zone) | `day` | that day | the whole day — the rest of it is `extra` |
 * | a range ending before now (past the tool's step) | `lookback` | the covering look-back from now, in the form's units | `[now − L, now]` — the gap after the range (and any rounding before it) is `extra` |
 *
 * A form whose read would be wider than the tool's `maxRange` is skipped.
 * The refusals are tests the binding asks: a range across days when every
 * form is a `day` ({@link spansDaysForDayOnly}), a sent wall time the zone
 * skips ({@link wallGapArgument}), and the facts ({@link periodFactProblem};
 * a range only partly older than `retention` runs —
 * {@link partlyBeyondRetention}).
 *
 * ## Precision and the inclusive edge
 *
 * An ISO or wall bound is written to the second when the instant is a whole
 * second, else to the millisecond; an inclusive `to` is "the last instant
 * inside at that precision" (`to − 1 s`, or `to − 1 ms`). Read back, a bound's
 * precision is how it was written: minutes (`to + 1 min`), seconds, or a
 * fraction (`+ 1 ms`). An epoch bound's precision is its unit; a date's is
 * the calendar day in the zone.
 *
 * @example
 * ```ts
 * const forms = sugarForms({ argument: 'window', spelling: 'iso-range' });
 * convertExact(
 *   { range: { from: '2026-10-09T08:00:00-07:00', to: '2026-10-09T08:41:00-07:00' } },
 *   forms,
 *   { now: '2026-10-09T15:40:00Z', zone: 'America/Los_Angeles', granularityMs: 60_000 },
 * );
 * // { form: 0, values: { window: '2026-10-09T08:00:00-07:00..2026-10-09T08:40:59-07:00' } }
 * ```
 */

import {
  AXIS_UNITS,
  durationMs,
  isDuration,
  LOOKBACK_UNITS,
  spellDuration,
  type DurationText,
} from './duration.js';
import { instantOf, spellInstant, utcWallMs, type InstantText } from './instant.js';
import { lookbackRange, reachMs, sameRange, type Edge, type TimeRange } from './range.js';

// `sameRange` moved to `range.ts` (the range owner) so the turn's windows
// (`windows.ts`) read it without this module; re-exported for its callers.
export { sameRange };
import { isZoneName, readWall, wallAt, type WallTime, type ZoneName } from './zone.js';
import {
  dateOf,
  DEFAULT_GRANULARITY_MS,
  epochFromText,
  FACT_UNITS,
  isPlain,
  needsZone,
  periodFactProblem,
  wallOf,
  type BoundAs,
  type PeriodFacts,
  type PeriodForm,
  type TimeRefusal,
} from './periodForm.js';

export {
  BOUND_AS,
  DEFAULT_GRANULARITY_MS,
  FACT_UNITS,
  FORM_KINDS,
  formArguments,
  formIssue,
  isBoundValue,
  needsZone,
  parsesUnderForm,
  PERIOD_SPELLINGS,
  periodFactProblem,
  primaryArgument,
  sugarForm,
  sugarForms,
  TIME_REFUSALS,
} from './periodForm.js';
export type {
  Bound,
  BoundAs,
  FormArgument,
  PeriodDirection,
  PeriodFactProblem,
  PeriodFacts,
  PeriodForm,
  PeriodShapes,
  PeriodSpelling,
  TimeRefusal,
  ToBound,
  ZoneArgument,
} from './periodForm.js';

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

// ─── Converting a range into a form ──────────────────────────────────────

/** What a conversion knows beyond the window: the turn's clock, the zones, the tool's step. */
export interface ConvertContext {
  /** The turn's clock (§ 4) — a look-back ends here. */
  readonly now: InstantText;
  /** The zone a wall or date form is written in and its zone argument is sent: the window's. */
  readonly zone: ZoneName;
  /** The app's `.time({ zone })` — the zone of a form that declares `wallZone: 'app'` and no zone argument. */
  readonly appZone?: ZoneName;
  /** The tool's `granularity` in milliseconds, else {@link DEFAULT_GRANULARITY_MS}. */
  readonly granularityMs: number;
}

/** The window to convert: its half-open range and, when it was said as one, its look-back. */
export interface WindowToConvert {
  readonly range: TimeRange;
  /** The look-back length the window was said as (`smhdw`), ending at the clock's `now`. */
  readonly lookback?: DurationText;
}

/** One exact conversion: the form used (its index), the argument values, and whether it rounded outward. */
export interface Conversion {
  readonly form: number;
  readonly values: Readonly<Record<string, unknown>>;
  readonly rounded?: true;
}

type Ms = { readonly ms: number; readonly offsetMinutes: number };

/** An instant a range bound names, exactly to the millisecond — `undefined` for a sub-millisecond one. */
function msOf(text: InstantText): Ms | undefined {
  const at = instantOf(text, 'strict');
  if (at === undefined || at.nanos !== 0) return undefined;
  return { ms: at.ms, offsetMinutes: at.offsetMinutes };
}

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

/** The range a form's bounds hold, for a window: a look-back's is `[now − L, now)`. */
function absoluteOf(window: WindowToConvert, now: InstantText): readonly [Ms, Ms] | undefined {
  if (window.lookback !== undefined) {
    const n = msOf(now);
    const length = durationMs(window.lookback, AXIS_UNITS);
    if (n === undefined || length === undefined) return undefined;
    return [
      { ms: n.ms - length, offsetMinutes: n.offsetMinutes },
      { ms: n.ms, offsetMinutes: n.offsetMinutes },
    ];
  }
  const from = msOf(window.range.from);
  const to = msOf(window.range.to);
  return from === undefined || to === undefined || from.ms >= to.ms ? undefined : [from, to];
}

function lookbackInto(
  window: WindowToConvert,
  form: Extract<PeriodForm, { kind: 'lookback' }>,
  ctx: ConvertContext,
): { readonly value: string; readonly rounded: boolean } | undefined {
  const units = form.units ?? LOOKBACK_UNITS;
  const sign = form.signed ? '-' : '';
  if (window.lookback !== undefined) {
    const ms = durationMs(window.lookback, AXIS_UNITS);
    const spelled = ms === undefined ? undefined : spellDuration(ms, units);
    return spelled === undefined ? undefined : { value: `${sign}${spelled}`, rounded: false };
  }
  // A range ending at now (within the tool's step): the smallest spelling that covers `from`.
  const now = msOf(ctx.now);
  const from = msOf(window.range.from);
  const to = msOf(window.range.to);
  if (now === undefined || from === undefined || to === undefined) return undefined;
  if (Math.abs(to.ms - now.ms) > ctx.granularityMs) return undefined;
  const need = now.ms - from.ms;
  if (need <= 0) return undefined;
  const finest = finestUnitMs(units);
  const length = Math.ceil(need / finest) * finest;
  const spelled = spellDuration(length, units);
  // Rounded when the length grew, or the end moved to now (a look-back ends at now, both ends inside).
  const endMoved = to.ms !== now.ms && to.ms !== now.ms + 1;
  return spelled === undefined
    ? undefined
    : { value: `${sign}${spelled}`, rounded: length !== need || endMoved };
}

const UNIT_MS: Readonly<Record<string, number>> = {
  s: 1_000,
  m: 60_000,
  h: 3_600_000,
  d: 86_400_000,
  w: 604_800_000,
};

function finestUnitMs(units: string): number {
  return Math.min(...[...units].map((u) => UNIT_MS[u] as number));
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
  if (span === undefined) return undefined;
  const [from, to] = span;
  if (form.kind === 'day') {
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
  const a = writeBound(from, 'from', fromAs, 'inclusive', zone);
  const b = writeBound(to, 'to', toAs, edge, zone);
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

/**
 * The first form (in declared order) that holds `window` EXACTLY — the exact
 * rows of § 7.2 — as the argument values to send, or `undefined` when no form
 * does. A form that would widen, shift or drop part of the window is never
 * chosen here.
 */
export function convertExact(
  window: WindowToConvert,
  forms: readonly PeriodForm[],
  ctx: ConvertContext,
): Conversion | undefined {
  for (let i = 0; i < forms.length; i++) {
    const done = convertOne(window, forms[i] as PeriodForm, ctx);
    if (done !== undefined) {
      return { form: i, values: done.values, ...(done.rounded && { rounded: true as const }) };
    }
  }
  return undefined;
}

// ─── The inexact rows (§ 7.2, step T5b) ──────────────────────────────────

/**
 * One conversion that holds MORE than the window: the form, the values, the
 * range the tool reads with them (`sent`, half-open) and the parts of it the
 * window did not ask for (`extra` — one or two ranges, in time order).
 */
export interface WidenedConversion extends Conversion {
  readonly sent: TimeRange;
  readonly extra: readonly TimeRange[];
}

/** The parts of `[sentFrom, sentTo)` outside `[from, to)`, in time order. */
function extraOf(sentFrom: number, sentTo: number, from: number, to: number): TimeRange[] {
  const parts: TimeRange[] = [];
  const before = from > sentFrom ? spanRange(sentFrom, from) : undefined;
  const after = sentTo > to ? spanRange(to, sentTo) : undefined;
  if (before !== undefined) parts.push(before);
  if (after !== undefined) parts.push(after);
  return parts;
}

/** The calendar date an instant falls on in `zone`. */
function dateAt(zone: ZoneName, ms: number) {
  const wall = wallAt(zone, ms);
  return { year: wall.year, month: wall.month, day: wall.day };
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

/**
 * The first form (in declared order) that holds `window` by READING MORE than
 * it — the inexact rows of § 7.2: a range inside one calendar day → that day
 * (`day`); a range ending before now → the covering look-back from now
 * (`lookback`). `widestMs` (the tool's `maxRange`) skips a form whose read
 * would be wider than the tool reads at once. Asked only after
 * {@link convertExact} found no exact form.
 */
export function convertWidened(
  window: WindowToConvert,
  forms: readonly PeriodForm[],
  ctx: ConvertContext,
  widestMs?: number,
): WidenedConversion | undefined {
  for (let i = 0; i < forms.length; i++) {
    const form = forms[i] as PeriodForm;
    const done =
      form.kind === 'day'
        ? dayWidened(window, form, ctx)
        : form.kind === 'lookback'
        ? lookbackWidened(window, form, ctx)
        : undefined;
    if (done === undefined || done.extra.length === 0) continue;
    const sentFrom = msOf(done.sent.from) as Ms;
    const sentTo = msOf(done.sent.to) as Ms;
    // The read's reach, judged as `periodFactProblem` judges a window (`range.ts` · `reachMs`):
    // a look-back `[now − L, now]` reaches `L`, so one exactly `maxRange` long is read at once.
    if (widestMs !== undefined && reachMs(sentFrom.ms, sentTo.ms) > widestMs) continue;
    return { form: i, ...done };
  }
  return undefined;
}

/**
 * Whether every form is a `day` and the window spans more than one calendar
 * day in the form's zone — the row § 7.2 refuses before dispatch: one call per
 * day is the model's choice, not the library's.
 */
export function spansDaysForDayOnly(
  window: WindowToConvert,
  forms: readonly PeriodForm[],
  ctx: ConvertContext,
): boolean {
  if (forms.length === 0 || !forms.every((f) => f.kind === 'day')) return false;
  const span = absoluteOf(window, ctx.now);
  if (span === undefined) return false;
  return forms.every((f) => {
    const zone = formZone(f, ctx);
    if (zone === undefined) return false;
    return spellDate(dateAt(zone, span[0].ms)) !== spellDate(dateAt(zone, span[1].ms - 1));
  });
}

// ─── One window, one tool: the conversion or the reason (the one owner) ──

/** A window a tool can read — the conversion to send — or the reason it cannot, before dispatch. */
export type ToolConversion =
  | {
      /** Exact, or — when no form holds the window exactly — WIDENED (it carries `sent` and `extra`). */
      readonly conversion: Conversion | WidenedConversion;
      /** The window starts before the source's oldest data and ends after it: it dispatches, marked. */
      readonly partlyBeyondRetention?: true;
    }
  | { readonly refused: TimeRefusal };

/**
 * Whether one tool can read one window, and how — the ONE answer every door
 * that puts a person's window into a tool asks (the fill, the time ask's
 * answer and its choices, the served line): the tool's facts first
 * ({@link periodFactProblem}), then the first form that holds it exactly
 * ({@link convertExact}), then the first that holds it by reading MORE
 * ({@link convertWidened} — `maxRange` skips a read too wide), then `multi-day`
 * for a `day`-only tool ({@link spansDaysForDayOnly}), and otherwise
 * `no-form-holds`: no declared form can read it at all (a look-back ends at
 * now, so it cannot reach a window still running; a covering look-back wider
 * than `maxRange` is not read). Never the tool's own default in its place.
 *
 * @example
 * ```ts
 * const lookbackOnly = [{ kind: 'lookback', argument: 'window', signed: false }] as const;
 * const ctx = { now: '2026-10-09T15:40:00Z', zone: 'America/Los_Angeles', granularityMs: 60_000 };
 * const yesterday = { from: '2026-10-08T00:00:00-07:00', to: '2026-10-09T00:00:00-07:00' };
 * convertForTool({ range: yesterday }, lookbackOnly, {}, ctx);
 * // { conversion: { form: 0, values: { window: '1960m' }, sent: …, extra: [ …the gap after it… ] } }
 * convertForTool({ range: yesterday }, lookbackOnly, { maxRange: '24h' }, ctx);
 * // { refused: 'no-form-holds' } — reaching 8 Oct from now takes a look-back wider than 24h
 * ```
 */
export function convertForTool(
  window: WindowToConvert,
  forms: readonly PeriodForm[],
  facts: PeriodFacts | undefined,
  ctx: ConvertContext,
): ToolConversion {
  const problem = facts === undefined ? undefined : periodFactProblem(window.range, facts, ctx.now);
  if (problem !== undefined) return { refused: problem };
  const partly =
    facts !== undefined && partlyBeyondRetention(window.range, facts, ctx.now)
      ? { partlyBeyondRetention: true as const }
      : {};
  const exact = convertExact(window, forms, ctx);
  if (exact !== undefined) return { conversion: exact, ...partly };
  const widened = convertWidened(window, forms, ctx, widestMsOf(facts));
  if (widened !== undefined) return { conversion: widened, ...partly };
  if (spansDaysForDayOnly(window, forms, ctx)) return { refused: 'multi-day' };
  return { refused: 'no-form-holds' };
}

/**
 * The first argument of `form` whose sent value is a wall time the zone
 * SKIPS (a spring-forward gap) — the tool would read a time that never
 * happened; refused before dispatch (§ 7.2). `undefined` when the form reads
 * no wall bound, the zone is unknown, or every wall value exists.
 */
export function wallGapArgument(
  args: Readonly<Record<string, unknown>>,
  form: PeriodForm,
  ctx: { readonly appZone?: ZoneName },
): string | undefined {
  if (form.kind === 'day' || form.kind === 'lookback') return undefined;
  const sentZone = 'zone' in form && form.zone !== undefined ? args[form.zone.argument] : undefined;
  const zone = formZone(form, {
    zone: isZoneName(sentZone) ? sentZone : undefined,
    ...(ctx.appZone !== undefined && { appZone: ctx.appZone }),
  });
  if (zone === undefined) return undefined;
  const inGap = (value: unknown): boolean => {
    const read = wallOf(value);
    return read !== undefined && readWall(read.wall, zone).kind === 'gap';
  };
  if (form.kind === 'bounds') {
    for (const bound of [form.from, form.to]) {
      if (bound.as === 'wall' && inGap(args[bound.argument])) return bound.argument;
    }
    return undefined;
  }
  if (form.as !== 'wall') return undefined;
  const value = args[form.argument];
  if (form.kind === 'joined') {
    if (typeof value !== 'string') return undefined;
    return value.split(form.joiner).some(inGap) ? form.argument : undefined;
  }
  if (!isPlain(value)) return undefined;
  return inGap(value[form.keys.from]) || inGap(value[form.keys.to]) ? form.argument : undefined;
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

const epochOrText = (as: BoundAs, text: string): unknown =>
  as === 'epoch-ms' || as === 'epoch-s' ? epochFromText(text) : text;

function spanRange(fromMs: number, toMs: number): TimeRange | undefined {
  if (!(fromMs < toMs)) return undefined;
  const from = spellInstant({ ms: fromMs, nanos: 0 }, 0);
  const to = spellInstant({ ms: toMs, nanos: 0 }, 0);
  return from === undefined || to === undefined ? undefined : { from, to };
}

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

/**
 * Whether {@link readBack} cannot read `args` for want of a zone alone — a
 * wall or date form whose zone argument is not in the call yet and no app
 * zone stands in. A caller that finds every bound present and still gets no
 * range tells "the zone is still to come" (this) from "the bounds name no
 * window" (misspelled, a wall time the zone skips, `from` not before `to`).
 */
export function readBackLacksZone(
  args: Readonly<Record<string, unknown>>,
  form: PeriodForm,
  ctx: { readonly appZone?: ZoneName },
): boolean {
  return form.kind !== 'lookback' && needsZone(form) && readZone(args, form, ctx) === undefined;
}

/**
 * The half-open range the arguments of `form` name — the § 3.3 conversion back
 * from each bound — or `undefined` when they do not name one (missing,
 * misspelled, a wall time the zone doubles or skips, `from` not before `to`).
 * A look-back is read at the turn's clock (`lookbackRange`). The range is
 * spelled in UTC: compare it as instants ({@link sameRange}).
 */
export function readBack(
  args: Readonly<Record<string, unknown>>,
  form: PeriodForm,
  ctx: { readonly now: InstantText; readonly appZone?: ZoneName },
): TimeRange | undefined {
  if (form.kind === 'lookback') {
    const value = args[form.argument];
    if (typeof value !== 'string') return undefined;
    const units = form.units ?? LOOKBACK_UNITS;
    if (form.signed && !value.startsWith('-')) return undefined;
    const length = form.signed ? value.slice(1) : value;
    if (!isDuration(length, units) || durationMs(length, units) === undefined) return undefined;
    return lookbackRange(ctx.now, length, units);
  }
  const zone = readZone(args, form, ctx);
  if (needsZone(form) && zone === undefined) return undefined;
  if (form.kind === 'day') {
    if (zone === undefined) return undefined;
    const date = dateOf(args[form.argument]);
    if (date === undefined) return undefined;
    const from = midnightOf(date, zone);
    const to = midnightOf(nextDay(date), zone);
    return from === undefined || to === undefined ? undefined : spanRange(from, to);
  }
  let fromValue: unknown;
  let toValue: unknown;
  let fromAs: BoundAs;
  let toAs: BoundAs;
  let edge: Edge;
  if (form.kind === 'bounds') {
    fromValue = args[form.from.argument];
    toValue = args[form.to.argument];
    fromAs = form.from.as;
    toAs = form.to.as;
    edge = form.to.edge;
  } else if (form.kind === 'joined') {
    const text = args[form.argument];
    if (typeof text !== 'string') return undefined;
    const halves = text.split(form.joiner);
    if (halves.length !== 2) return undefined;
    fromValue = epochOrText(form.as, halves[0] as string);
    toValue = epochOrText(form.as, halves[1] as string);
    fromAs = toAs = form.as;
    edge = form.edge ?? 'inclusive';
  } else {
    const object = args[form.argument];
    if (!isPlain(object)) return undefined;
    fromValue = object[form.keys.from];
    toValue = object[form.keys.to];
    fromAs = toAs = form.as;
    edge = form.edge;
  }
  const from = readBound(fromValue, 'from', fromAs, 'inclusive', zone);
  const to = readBound(toValue, 'to', toAs, edge, zone);
  return from === undefined || to === undefined ? undefined : spanRange(from, to);
}

/**
 * The absolute range a look-back window was sent as to a bounds form —
 * `[now − L, now)`, which reads back one millisecond shorter than the
 * look-back's own `[now − L, now]` — so a binding recognises either.
 */
export function lookbackAsBounds(now: InstantText, lookback: DurationText): TimeRange | undefined {
  const n = msOf(now);
  const length = durationMs(lookback, AXIS_UNITS);
  if (n === undefined || length === undefined) return undefined;
  return spanRange(n.ms - length, n.ms);
}

/** The tool's step in milliseconds — its `granularity`, else one minute (§ 7.4). */
export function granularityMsOf(facts: PeriodFacts | undefined): number {
  const ms =
    facts?.granularity === undefined ? undefined : durationMs(facts.granularity, FACT_UNITS);
  return ms ?? DEFAULT_GRANULARITY_MS;
}

// ─── The tool's facts against a range (the checks live in periodForm.ts) ──

/**
 * Whether a half-open range is PARTLY older than what the source keeps — it
 * starts before `now − retention` and ends after it. It dispatches as asked
 * (§ 7.2); the result's `held` decides `partly-held`. `false` when the tool
 * declares no `retention`.
 */
export function partlyBeyondRetention(
  range: TimeRange,
  facts: PeriodFacts,
  now: InstantText,
): boolean {
  const retention =
    facts.retention === undefined ? undefined : durationMs(facts.retention, FACT_UNITS);
  const from = instantOf(range.from, 'strict');
  const to = instantOf(range.to, 'strict');
  const at = instantOf(now, 'strict');
  if (retention === undefined || from === undefined || to === undefined || at === undefined) {
    return false;
  }
  const oldest = at.ms - retention;
  return from.ms < oldest && to.ms > oldest;
}

/** The widest window the tool reads at once (`maxRange`) in milliseconds, when it declares one. */
export function widestMsOf(facts: PeriodFacts | undefined): number | undefined {
  return facts?.maxRange === undefined ? undefined : durationMs(facts.maxRange, FACT_UNITS);
}
