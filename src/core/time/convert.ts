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
 *          `range.ts` and `zone.ts` only. Asked by `arguments/declare.ts` (the
 *          declaration's shape — the sugar, each form's own rules, a declared
 *          value's spelling) and by `bind.ts` (the fill and the binding).
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
 * | a whole day | `day` | that day | any other range is not exact (the wider row is T5b's) |
 * | a range ending at now (within `granularity`) | `lookback` | the smallest spelling in `units` that covers `from` | `rounded` when it is longer |
 *
 * Every other row of § 7.2 is not exact, and {@link convertExact} answers
 * `undefined` for it — the widening and the refusals are the next step's.
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
  isUnitSet,
  LOOKBACK_UNITS,
  spellDuration,
  type DurationText,
} from './duration.js';
import {
  compareInstants,
  daysInMonth,
  instantOf,
  spellInstant,
  utcWallMs,
  type InstantText,
} from './instant.js';
import { lookbackRange, type Edge, type TimeRange } from './range.js';
import { isZoneName, readWall, wallAt, type WallTime, type ZoneName } from './zone.js';

// ─── The declaration's shapes ────────────────────────────────────────────

/** The single-argument spellings — today's three, and `wall-range` (wall times plus a zone argument). */
export type PeriodSpelling = 'lookback' | 'signed-lookback' | 'iso-range' | 'wall-range';

/** The spellings, in the order the docs list them. */
export const PERIOD_SPELLINGS: readonly PeriodSpelling[] = Object.freeze([
  'lookback',
  'signed-lookback',
  'iso-range',
  'wall-range',
]);

/** How one bound is written: an instant with its offset, epoch milliseconds or seconds, a calendar date, a wall time. */
export type BoundAs = 'iso' | 'epoch-ms' | 'epoch-s' | 'date' | 'wall';

export const BOUND_AS: readonly BoundAs[] = Object.freeze([
  'iso',
  'epoch-ms',
  'epoch-s',
  'date',
  'wall',
]);

/**
 * One bound of a two-argument period. A `from` bound is inclusive (its `edge`,
 * when written, can only say so); a `to` bound MUST say its edge
 * ({@link ToBound}) — TQ18: the library never guesses a tool's edge, only the
 * sugar defaults (`inclusive`).
 */
export interface Bound {
  readonly argument: string;
  readonly as: BoundAs;
  readonly edge?: Edge;
}

/** The end bound of a `bounds` form — its edge is declared, never defaulted (TQ18). */
export interface ToBound extends Bound {
  readonly edge: Edge;
}

/** The argument a wall or date form reads its zone from. */
export interface ZoneArgument {
  readonly argument: string;
}

/** Every shape a tool's period can take — one `TimeRange` onto one or more arguments. */
export type PeriodForm =
  | {
      readonly kind: 'bounds';
      readonly from: Bound;
      readonly to: ToBound;
      readonly zone?: ZoneArgument;
    }
  | {
      readonly kind: 'joined';
      readonly argument: string;
      readonly as: BoundAs;
      readonly joiner: '..' | '/';
      readonly edge?: Edge;
      readonly zone?: ZoneArgument;
    }
  | {
      readonly kind: 'object';
      readonly argument: string;
      readonly keys: { readonly from: string; readonly to: string };
      readonly as: BoundAs;
      /** Declared, never defaulted (TQ18). */
      readonly edge: Edge;
      readonly zone?: ZoneArgument;
    }
  | { readonly kind: 'day'; readonly argument: string; readonly zone?: ZoneArgument }
  | {
      readonly kind: 'lookback';
      readonly argument: string;
      readonly signed: boolean;
      /** A unit set ⊆ `smhdw`; absent → today's `mhdw`. */
      readonly units?: string;
    };

export const FORM_KINDS: readonly PeriodForm['kind'][] = Object.freeze([
  'bounds',
  'joined',
  'object',
  'day',
  'lookback',
]);

/** Which side of now a source can hold. */
export type PeriodDirection = 'past' | 'future' | 'any';

/** Facts about the source — never policy (§ 7.1). Durations are in `smhdw`. */
export interface PeriodFacts {
  readonly direction?: PeriodDirection;
  readonly retention?: DurationText;
  readonly maxRange?: DurationText;
  readonly granularity?: DurationText;
  readonly filtersToAsked?: boolean;
}

/** The unit set of a fact's duration (`retention`, `maxRange`, `granularity`). */
export const FACT_UNITS = AXIS_UNITS;

/** The step a look-back ending "at now" may miss by when no `granularity` is declared (§ 7.4). */
export const DEFAULT_GRANULARITY_MS = 60_000;

// ─── The sugar ───────────────────────────────────────────────────────────

/** The form one single-argument spelling means (the module table). */
export function sugarForm(
  argument: string,
  spelling: PeriodSpelling,
  zoneArgument?: string,
): PeriodForm {
  switch (spelling) {
    case 'lookback':
      return { kind: 'lookback', argument, signed: false };
    case 'signed-lookback':
      return { kind: 'lookback', argument, signed: true };
    case 'iso-range':
      return { kind: 'joined', argument, as: 'iso', joiner: '..', edge: 'inclusive' };
    case 'wall-range':
      return {
        kind: 'joined',
        argument,
        as: 'wall',
        joiner: '..',
        edge: 'inclusive',
        ...(zoneArgument !== undefined && { zone: { argument: zoneArgument } }),
      };
  }
}

/** The sugar and general halves of a period declaration, as `sugarForms` reads them. */
export interface PeriodShapes {
  readonly argument?: string;
  readonly spelling?: PeriodSpelling;
  readonly accepts?: readonly PeriodSpelling[];
  readonly zoneArgument?: string;
  readonly forms?: readonly PeriodForm[];
}

/**
 * Every form a declaration names, in preference order: `forms` as written,
 * else the sugar (`accepts`, else `spelling`). A declaration that names an
 * argument and no spelling has no form — today's "which argument", nothing
 * the library can convert into.
 */
export function sugarForms(period: PeriodShapes): readonly PeriodForm[] {
  if (period.forms !== undefined) return period.forms;
  if (period.argument === undefined) return [];
  const spellings = period.accepts ?? (period.spelling !== undefined ? [period.spelling] : []);
  return spellings.map((s) => sugarForm(period.argument as string, s, period.zoneArgument));
}

// ─── One form's own rules ────────────────────────────────────────────────

type Plain = Record<string, unknown>;
const isPlain = (value: unknown): value is Plain =>
  typeof value === 'object' && value !== null && !Array.isArray(value);
const isName = (value: unknown): value is string =>
  typeof value === 'string' && value.trim() !== '';

const FORM_KEYS: Readonly<Record<PeriodForm['kind'], readonly string[]>> = Object.freeze({
  bounds: ['kind', 'from', 'to', 'zone'],
  joined: ['kind', 'argument', 'as', 'joiner', 'edge', 'zone'],
  object: ['kind', 'argument', 'keys', 'as', 'edge', 'zone'],
  day: ['kind', 'argument', 'zone'],
  lookback: ['kind', 'argument', 'signed', 'units'],
});

function boundIssue(value: unknown, which: 'from' | 'to'): string | undefined {
  if (!isPlain(value))
    return which === 'to' ? 'to must be { argument, as, edge }.' : 'from must be { argument, as }.';
  for (const key of Object.keys(value)) {
    if (key !== 'argument' && key !== 'as' && key !== 'edge') {
      return `${which} has an unknown key '${key}' — a bound reads \`argument\`, \`as\` and \`edge\`.`;
    }
  }
  if (!isName(value.argument)) return `${which}.argument must name an argument.`;
  if (!BOUND_AS.includes(value.as as BoundAs)) {
    return `${which}.as must be one of ${BOUND_AS.join(', ')}.`;
  }
  if (value.edge !== undefined && value.edge !== 'inclusive' && value.edge !== 'exclusive') {
    return `${which}.edge must be 'inclusive' or 'exclusive'.`;
  }
  if (which === 'from' && value.edge === 'exclusive') {
    return "from.edge is 'exclusive' — a start bound holds the instant it names; only a `to` bound says its edge.";
  }
  if (which === 'to' && value.edge === undefined) return EDGE_UNDECLARED('to.edge');
  return undefined;
}

/** TQ18: a `bounds` / `object` form declares its end edge — the library never guesses it. */
const EDGE_UNDECLARED = (where: string): string =>
  `${where} is missing — say whether the end instant is inside ('inclusive') or just past ('exclusive'); the library never guesses a tool's edge.`;

function zoneIssue(value: unknown): string | undefined {
  if (value === undefined) return undefined;
  if (
    !isPlain(value) ||
    Object.keys(value).some((k) => k !== 'argument') ||
    !isName(value.argument)
  ) {
    return 'zone must be { argument } naming the argument that carries the zone.';
  }
  return undefined;
}

const edgeIssue = (value: unknown): string | undefined =>
  value === undefined || value === 'inclusive' || value === 'exclusive'
    ? undefined
    : "edge must be 'inclusive' or 'exclusive'.";

/**
 * Why one form's own shape is not a form, or `undefined` when it is one. The
 * schema half (does the argument exist, is it the right type, does it carry a
 * rule) is `arguments/declare.ts`'s — this is the shape alone.
 */
export function formIssue(form: unknown): string | undefined {
  if (!isPlain(form)) return 'a form must be an object with a `kind`.';
  const kind = form.kind as PeriodForm['kind'];
  if (!FORM_KINDS.includes(kind)) return `kind must be one of ${FORM_KINDS.join(', ')}.`;
  for (const key of Object.keys(form)) {
    if (!FORM_KEYS[kind].includes(key)) {
      return `unknown key '${key}' on a '${kind}' form — it reads ${FORM_KEYS[kind]
        .map((k) => `\`${k}\``)
        .join(', ')}.`;
    }
  }
  switch (kind) {
    case 'bounds':
      return (
        boundIssue(form.from, 'from') ??
        boundIssue(form.to, 'to') ??
        ((form.from as Plain).argument === (form.to as Plain).argument
          ? 'from and to name the same argument — a `joined` form is one argument.'
          : undefined) ??
        zoneIssue(form.zone)
      );
    case 'joined':
      if (!isName(form.argument)) return 'argument must name an argument.';
      if (!BOUND_AS.includes(form.as as BoundAs))
        return `as must be one of ${BOUND_AS.join(', ')}.`;
      if (form.joiner !== '..' && form.joiner !== '/') return "joiner must be '..' or '/'.";
      return edgeIssue(form.edge) ?? zoneIssue(form.zone);
    case 'object': {
      if (!isName(form.argument)) return 'argument must name an argument.';
      const keys = form.keys;
      if (
        !isPlain(keys) ||
        Object.keys(keys).length !== 2 ||
        !isName(keys.from) ||
        !isName(keys.to) ||
        keys.from === keys.to
      ) {
        return 'keys must be { from, to }, two different property names.';
      }
      if (!BOUND_AS.includes(form.as as BoundAs))
        return `as must be one of ${BOUND_AS.join(', ')}.`;
      if (form.edge === undefined) return EDGE_UNDECLARED('edge');
      return edgeIssue(form.edge) ?? zoneIssue(form.zone);
    }
    case 'day':
      if (!isName(form.argument)) return 'argument must name an argument.';
      return zoneIssue(form.zone);
    case 'lookback':
      if (!isName(form.argument)) return 'argument must name an argument.';
      if (typeof form.signed !== 'boolean') return 'signed must be true or false.';
      if (form.units !== undefined && !isUnitSet(form.units)) {
        return `units '${String(form.units)}' is not a unit set — distinct letters from 'smhdw'.`;
      }
      return undefined;
  }
}

/** Whether a form reads wall-clock values and so needs a zone (`wall`, `date`, a `day`). */
export function needsZone(form: PeriodForm): boolean {
  switch (form.kind) {
    case 'bounds':
      return wallish(form.from.as) || wallish(form.to.as);
    case 'joined':
    case 'object':
      return wallish(form.as);
    case 'day':
      return true;
    case 'lookback':
      return false;
  }
}

const wallish = (as: BoundAs): boolean => as === 'wall' || as === 'date';

/** One argument a form names, and what the schema must say of it. */
export interface FormArgument {
  readonly argument: string;
  /** `bound`: carries a value of the window; `zone`: carries the zone; `object`: an object of both bounds. */
  readonly role: 'bound' | 'zone' | 'object';
  /** The JSON Schema type the property must have: a number for an epoch, else a string. */
  readonly type: 'number' | 'string' | 'object';
  /** For a `bound` of a `bounds` form — the bound it carries. */
  readonly bound?: Bound;
}

const typeOfAs = (as: BoundAs): 'number' | 'string' =>
  as === 'epoch-ms' || as === 'epoch-s' ? 'number' : 'string';

/** Every argument a form names, the zone argument last. */
export function formArguments(form: PeriodForm): readonly FormArgument[] {
  const zone = 'zone' in form && form.zone !== undefined ? form.zone : undefined;
  const zoneArg: FormArgument[] =
    zone !== undefined ? [{ argument: zone.argument, role: 'zone', type: 'string' }] : [];
  switch (form.kind) {
    case 'bounds':
      return [
        {
          argument: form.from.argument,
          role: 'bound',
          type: typeOfAs(form.from.as),
          bound: form.from,
        },
        { argument: form.to.argument, role: 'bound', type: typeOfAs(form.to.as), bound: form.to },
        ...zoneArg,
      ];
    case 'object':
      return [{ argument: form.argument, role: 'object', type: 'object' }, ...zoneArg];
    case 'joined':
    case 'day':
    case 'lookback':
      return [{ argument: form.argument, role: 'bound', type: 'string' }, ...zoneArg];
  }
}

/** The argument a form is known by — the results layer's join key (its first bound). */
export function primaryArgument(form: PeriodForm): string {
  return form.kind === 'bounds' ? form.from.argument : form.argument;
}

// ─── Wall times and dates as text ────────────────────────────────────────

const WALL_TEXT = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2})(?:\.(\d{1,3}))?)?$/;
const DATE_TEXT = /^(\d{4})-(\d{2})-(\d{2})$/;
const pad = (n: number, width: number): string => String(n).padStart(width, '0');

/** A wall time written with no offset, and the step its spelling is precise to. */
function wallOf(text: unknown): { readonly wall: WallTime; readonly stepMs: number } | undefined {
  if (typeof text !== 'string') return undefined;
  const m = WALL_TEXT.exec(text);
  if (m === null) return undefined;
  const wall: WallTime = {
    year: Number(m[1]),
    month: Number(m[2]),
    day: Number(m[3]),
    hour: Number(m[4]),
    minute: Number(m[5]),
    second: m[6] === undefined ? 0 : Number(m[6]),
    millisecond: m[7] === undefined ? 0 : Number(m[7].padEnd(3, '0')),
  };
  if (wall.year < 0 || wall.month < 1 || wall.month > 12) return undefined;
  if (wall.day < 1 || wall.day > daysInMonth(wall.year, wall.month)) return undefined;
  if (wall.hour > 23 || wall.minute > 59 || (wall.second ?? 0) > 59) return undefined;
  return { wall, stepMs: m[7] !== undefined ? 1 : m[6] !== undefined ? 1_000 : 60_000 };
}

/** A calendar date `YYYY-MM-DD`, day-checked. */
function dateOf(
  text: unknown,
): { readonly year: number; readonly month: number; readonly day: number } | undefined {
  if (typeof text !== 'string') return undefined;
  const m = DATE_TEXT.exec(text);
  if (m === null) return undefined;
  const year = Number(m[1]);
  const month = Number(m[2]);
  const day = Number(m[3]);
  if (month < 1 || month > 12 || day < 1 || day > daysInMonth(year, month)) return undefined;
  return { year, month, day };
}

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

// ─── A declared value's spelling ─────────────────────────────────────────

/** Whether a single bound value is written the way `as` declares. */
export function isBoundValue(value: unknown, as: BoundAs): boolean {
  switch (as) {
    case 'iso':
      return instantOf(value, 'strict') !== undefined;
    case 'epoch-ms':
    case 'epoch-s':
      return typeof value === 'number' && Number.isSafeInteger(value);
    case 'date':
      return dateOf(value) !== undefined;
    case 'wall':
      return wallOf(value) !== undefined;
  }
}

/** An epoch bound inside a joined string: its digits, read as a number. */
const EPOCH_TEXT = /^-?(0|[1-9][0-9]*)$/;
const epochFromText = (text: string): number | undefined =>
  EPOCH_TEXT.test(text) && Number.isSafeInteger(Number(text)) ? Number(text) : undefined;

/**
 * Whether a declared value (an `assume` default, an `ask` choice) of
 * `argument` is written the way `form` spells that argument. A format check:
 * no clock, no conversion. `true` for an argument the form does not name.
 */
export function parsesUnderForm(value: unknown, form: PeriodForm, argument: string): boolean {
  const named = formArguments(form).find((a) => a.argument === argument);
  if (named === undefined) return true;
  if (named.role === 'zone') return isZoneName(value);
  switch (form.kind) {
    case 'lookback': {
      if (typeof value !== 'string') return false;
      const units = form.units ?? LOOKBACK_UNITS;
      return form.signed
        ? value.startsWith('-') && isDuration(value.slice(1), units)
        : isDuration(value, units);
    }
    case 'joined': {
      if (typeof value !== 'string') return false;
      const halves = value.split(form.joiner);
      if (halves.length !== 2) return false;
      return halves.every((h) =>
        form.as === 'epoch-ms' || form.as === 'epoch-s'
          ? epochFromText(h) !== undefined
          : isBoundValue(h, form.as),
      );
    }
    case 'day':
      return dateOf(value) !== undefined;
    case 'bounds':
      return isBoundValue(value, (named.bound as Bound).as);
    case 'object':
      return true;
  }
}

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
  const sentZone = 'zone' in form && form.zone !== undefined ? args[form.zone.argument] : undefined;
  if ('zone' in form && form.zone !== undefined && !isZoneName(sentZone)) {
    if (needsZone(form)) return undefined;
  }
  const zone = formZone(form, {
    zone: isZoneName(sentZone) ? sentZone : undefined,
    appZone: ctx.appZone,
  });
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

/** Whether two ranges hold the same instants (their spellings and offsets aside). */
export function sameRange(a: TimeRange, b: TimeRange): boolean {
  const af = instantOf(a.from, 'strict');
  const at = instantOf(a.to, 'strict');
  const bf = instantOf(b.from, 'strict');
  const bt = instantOf(b.to, 'strict');
  if (af === undefined || at === undefined || bf === undefined || bt === undefined) return false;
  return compareInstants(af, bf) === 0 && compareInstants(at, bt) === 0;
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

// ─── The tool's facts against a range ────────────────────────────────────

/** Why a range breaks one of the tool's facts — a code; the sentence is the catalog's. */
export type PeriodFactProblem = 'time-future' | 'time-past' | 'beyond-retention' | 'over-max-range';

/**
 * Which of the tool's declared facts a half-open range breaks, against the
 * turn's clock — or `undefined`. `past`: a range that starts after now;
 * `future`: one that ends before now; `retention`: only a range WHOLLY older
 * than `now − retention` (a partial overlap is the result's to judge);
 * `maxRange`: a range longer than it. A fact the tool does not declare is not
 * checked.
 */
export function periodFactProblem(
  range: TimeRange,
  facts: PeriodFacts,
  now: InstantText,
): PeriodFactProblem | undefined {
  const from = instantOf(range.from, 'strict');
  const to = instantOf(range.to, 'strict');
  const at = instantOf(now, 'strict');
  if (from === undefined || to === undefined || at === undefined) return undefined;
  if (facts.direction === 'past' && compareInstants(from, at) > 0) return 'time-future';
  if (facts.direction === 'future' && compareInstants(to, at) <= 0) return 'time-past';
  const retention =
    facts.retention === undefined ? undefined : durationMs(facts.retention, FACT_UNITS);
  if (retention !== undefined && to.ms <= at.ms - retention) return 'beyond-retention';
  const widest = facts.maxRange === undefined ? undefined : durationMs(facts.maxRange, FACT_UNITS);
  if (widest !== undefined && to.ms - from.ms > widest) return 'over-max-range';
  return undefined;
}
