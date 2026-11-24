/**
 * time/convert — a tool's period FORMS (time design § 7.1) and the EXACT
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
 * Role:    L0 leaf (the time layer). Imports `instant.ts`, `duration.ts`,
 *          `range.ts`, `zone.ts` and `periodForm.ts` — the declaration half
 *          (the shapes, the sugar, each form's own rules, a declared value's
 *          spelling, the tool's facts), split out for the synchronous doors
 *          (`tools/declare.ts`, `ask.ts`, `rows.ts`) and re-exported
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
 * | a confirmed interval rounded by an `epoch-s` bound | an absolute form | outward whole-second bound values | `sent` and the precise `extra` on each end |
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
 * A confirmed endpoint reads an inclusive ISO bound as a point, including
 * in a form whose other bound uses a different encoding.
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
  type DurationText,
} from './duration.js';
import { instantOf, type InstantText } from './instant.js';
import { lookbackRange, reachMs, sameRange, type Edge, type TimeRange } from './range.js';

// `sameRange` moved to `range.ts` (the range owner) so the turn's windows
// (`windows.ts`) read it without this module; re-exported for its callers.
export { sameRange };
import { isZoneName, readWall, type ZoneName } from './zone.js';
import {
  dateOf,
  DEFAULT_GRANULARITY_MS,
  FACT_UNITS,
  formMaxRange,
  isPlain,
  needsZone,
  periodFactProblem,
  toolFacts,
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
  formFacts,
  formIssue,
  formMaxRange,
  isBoundValue,
  needsZone,
  parsesUnderForm,
  PERIOD_SPELLINGS,
  periodFactProblem,
  primaryArgument,
  sugarForm,
  sugarForms,
  TIME_REFUSALS,
  toolFacts,
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

import { epochOrText, formZone, readPeriodBounds, readZone } from './convert/bounds.js';
import { dateAt, midnightOf, nextDay, spellDate } from './convert/calendar.js';
import { sourceClockLookback } from './convert/covering.js';
import { convertOne, supportsFrozenLookback } from './convert/exact.js';
import type { WindowEndpoint } from './windowEndpoint.js';
import { absoluteOf, msOf, spanRange } from './convert/instants.js';
import { dayWidened, extraOfPrecise, lookbackWidened } from './convert/widen.js';

export { supportsFrozenLookback };

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
  /** The admitted clock already bound this look-back to `range`; dispatch absolute bounds only. */
  readonly freezeLookback?: true;
  readonly endpoint?: WindowEndpoint;
}

/** One exact conversion: the form used (its index), the argument values, and whether it rounded outward. */
export interface Conversion {
  readonly form: number;
  readonly values: Readonly<Record<string, unknown>>;
  readonly rounded?: true;
  /**
   * A confirmed look-back in a form that takes only a length: the SOURCE reads
   * it against its own clock, so the library lengthens it at dispatch to
   * still reach the window's start (`convert/covering.ts`). `values` holds
   * the window's own length until then.
   */
  readonly coversAtDispatch?: true;
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
    const form = forms[i] as PeriodForm;
    if (window.freezeLookback === true && !supportsFrozenLookback(form)) continue;
    const done = convertOne(window, form, ctx);
    const exactBounds = window.endpoint !== undefined && form.kind !== 'lookback';
    if (done !== undefined && (!done.rounded || (!exactBounds && window.freezeLookback !== true))) {
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
    const absolute =
      window.freezeLookback === true ||
      (window.endpoint !== undefined && form.kind !== 'day' && form.kind !== 'lookback');
    const done = absolute
      ? roundedAbsolute(window, form, ctx)
      : form.kind === 'day'
      ? dayWidened(window, form, ctx)
      : form.kind === 'lookback'
      ? lookbackWidened(window, form, ctx)
      : undefined;
    if (done === undefined || done.extra.length === 0) continue;
    if (widestMs !== undefined && !fitsCap(window, widestMs, done.sent)) continue;
    return { form: i, ...done };
  }
  return undefined;
}

/** An absolute form can widen only to the bounds its actual arguments read back. */
function roundedAbsolute(
  window: WindowToConvert,
  form: PeriodForm,
  ctx: ConvertContext,
): Omit<WidenedConversion, 'form'> | undefined {
  if (window.freezeLookback === true && !supportsFrozenLookback(form)) return undefined;
  const converted = convertOne(window, form, ctx);
  if (converted?.rounded !== true) return undefined;
  const sent = readBack(converted.values, form, {
    ...ctx,
    ...(window.endpoint !== undefined && { precise: true as const }),
  });
  if (sent === undefined) return undefined;
  const extra = extraOfPrecise(sent, window.range);
  return extra === undefined ? undefined : { values: converted.values, rounded: true, sent, extra };
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
 * A CONFIRMED look-back (`freezeLookback`) is read as its frozen absolute
 * bounds whatever the declared order; when no absolute form holds it, the
 * first length-only form reads it, `coversAtDispatch`: the source counts a
 * length back from its own clock, so the library lengthens it at dispatch to
 * still reach the window's start (`drift.ts` · `coverAtDispatch`).
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
  // A confirmed look-back is read by an absolute form (its frozen bounds) or, when none holds
  // it, by a length-only form the library lengthens at dispatch. A day or wall form reads neither.
  const frozen = window.freezeLookback === true;
  const eligible = frozen
    ? forms.filter((form) => supportsFrozenLookback(form) || form.kind === 'lookback')
    : forms;
  if (frozen && eligible.length === 0) {
    return { refused: 'no-form-holds' };
  }
  // The tool's facts before a form is chosen: `maxRange` is the widest any form reads, so a window
  // is over it only when NO form can read it (`periodForm.ts` · `toolFacts`; the period's own
  // facts when no form declares its own `maxRange`).
  const judged = facts === undefined ? undefined : toolFacts(eligible, facts);
  const problem =
    judged === undefined ? undefined : periodFactProblem(window.range, judged, ctx.now);
  if (problem !== undefined) return { refused: problem };
  const partly =
    facts !== undefined && partlyBeyondRetention(window.range, facts, ctx.now)
      ? { partlyBeyondRetention: true as const }
      : {};
  const toolCap = widestMsOf(facts);
  const checkEachCap =
    eligible.some((form) => form.maxRange !== undefined) ||
    (window.endpoint !== undefined && toolCap !== undefined);
  const read = checkEachCap
    ? convertWithinFormCaps(window, forms, facts, ctx)
    : convertExact(window, forms, ctx) ?? convertWidened(window, forms, ctx, toolCap);
  if (read !== undefined) return { conversion: read, ...partly };
  // The widening law for a confirmed look-back no absolute form holds: the covering look-back,
  // measured at dispatch. Asked last, so frozen bounds win whatever the declared order.
  const covering = frozen ? sourceClockConversion(window, forms, facts) : undefined;
  if (covering !== undefined) return { conversion: covering, ...partly };
  if (spansDaysForDayOnly(window, eligible, ctx)) return { refused: 'multi-day' };
  return { refused: 'no-form-holds' };
}

/**
 * The first length-only form (in declared order) that reads a confirmed
 * look-back within its own `maxRange` — the value it holds until dispatch
 * (`convert/covering.ts` · `sourceClockLookback`), marked `coversAtDispatch`.
 */
function sourceClockConversion(
  window: WindowToConvert,
  forms: readonly PeriodForm[],
  facts: PeriodFacts | undefined,
): Conversion | undefined {
  for (let i = 0; i < forms.length; i++) {
    const form = forms[i] as PeriodForm;
    if (form.kind !== 'lookback') continue;
    const sent = sourceClockLookback(window.range, form, formCapMs(form, facts));
    if (sent === undefined) continue;
    return {
      form: i,
      values: sent.values,
      ...(sent.rounded && { rounded: true as const }),
      coversAtDispatch: true,
    };
  }
  return undefined;
}

/** One form's effective `maxRange` in milliseconds (`periodForm.ts` · `formMaxRange`), when it has one. */
export function formCapMs(form: PeriodForm, facts: PeriodFacts | undefined): number | undefined {
  const text = formMaxRange(form, facts);
  return text === undefined ? undefined : durationMs(text, FACT_UNITS);
}

/**
 * {@link convertForTool}'s exact-then-wider search for confirmed windows
 * with a tool cap or forms with their own caps. Check exact forms first,
 * then widened forms. Skip any form whose read exceeds its effective cap
 * ({@link formMaxRange}).
 */
function convertWithinFormCaps(
  window: WindowToConvert,
  forms: readonly PeriodForm[],
  facts: PeriodFacts | undefined,
  ctx: ConvertContext,
): Conversion | WidenedConversion | undefined {
  const capMs = (form: PeriodForm): number | undefined => formCapMs(form, facts);
  for (let i = 0; i < forms.length; i++) {
    const form = forms[i] as PeriodForm;
    const cap = capMs(form);
    if (cap !== undefined && !fitsCap(window, cap)) continue;
    const exact = convertExact(window, [form], ctx);
    if (exact !== undefined) return { ...exact, form: i };
  }
  for (let i = 0; i < forms.length; i++) {
    const form = forms[i] as PeriodForm;
    const widened = convertWidened(window, [form], ctx, capMs(form));
    if (widened !== undefined) return { ...widened, form: i };
  }
  return undefined;
}

function fitsCap(window: WindowToConvert, cap: number, sent?: TimeRange): boolean {
  const range = sent ?? window.range;
  const end = sent?.to ?? window.endpoint?.cutoff ?? range.to;
  const from = instantOf(range.from, 'strict');
  const cutoff = instantOf(end, 'strict');
  if (from === undefined || cutoff === undefined) return false;
  if (window.endpoint === undefined) {
    const fractional = sent === undefined ? 0 : (cutoff.nanos - from.nanos) / 1_000_000;
    return reachMs(from.ms, cutoff.ms) + fractional <= cap;
  }
  // Compare the sub-millisecond remainder separately to keep it at long durations.
  const wholeMs = cutoff.ms - from.ms;
  return wholeMs < cap || (wholeMs === cap && cutoff.nanos <= from.nanos);
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
  ctx: { readonly now: InstantText; readonly appZone?: ZoneName; readonly precise?: true },
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
  return readPeriodBounds(
    { value: fromValue, as: fromAs },
    { value: toValue, as: toAs },
    edge,
    zone,
    ctx.precise,
  );
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
