/**
 * core/time/periodForm — a tool's period FORMS as DECLARED (time design § 7.1):
 * the shapes, the sugar, each form's own rules, a declared value's spelling,
 * and the tool's facts against a range.
 *
 * Pattern: the declaration half of `convert.ts`, split from the conversions so
 *          the SYNCHRONOUS doors — `defineTool({ period })`
 *          (`agent/arguments/declare.ts`), a time answer's check at the resume
 *          door (`ask.ts` · `checkTimeAnswer`) and the checkpoint door's
 *          refusal codes (`rows.ts`) — reach it without the conversion
 *          engine, which only an armed agent loads (`bind.ts`, `drift.ts`,
 *          reached through `import()`: the optional-family law of docs-next's
 *          site budget). `convert.ts` re-exports everything public here.
 * Role:    core/ leaf (the time layer). Imports `instant.ts`, `duration.ts`
 *          and `zone.ts` only.
 * Emits:   N/A.
 *
 * @example
 * ```ts
 * const [form] = sugarForms({ argument: 'window', spelling: 'iso-range' });
 * formIssue(form); // undefined — a well-formed form
 * parsesUnderForm('2026-10-09T08:00:00-07:00..2026-10-09T08:40:59-07:00', form, 'window'); // true
 * ```
 */

import {
  AXIS_UNITS,
  durationMs,
  isDuration,
  isUnitSet,
  LOOKBACK_UNITS,
  type DurationText,
} from './duration.js';
import { compareInstants, daysInMonth, instantOf, type InstantText } from './instant.js';
import type { Edge, TimeRange } from './range.js';
import { isZoneName, type WallTime } from './zone.js';

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
export const isPlain = (value: unknown): value is Plain =>
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

/** A wall time written with no offset, and the step its spelling is precise to. */
export function wallOf(
  text: unknown,
): { readonly wall: WallTime; readonly stepMs: number } | undefined {
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
export function dateOf(
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
export const epochFromText = (text: string): number | undefined =>
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

/**
 * Why a call is refused before dispatch (§ 7.2, step T5b): one of the tool's
 * facts ({@link PeriodFactProblem}), a range across days to a tool that reads
 * one day (`multi-day`), or a wall time the zone skips (`dst-gap`).
 */
export type TimeRefusal = PeriodFactProblem | 'multi-day' | 'dst-gap';

export const TIME_REFUSALS: readonly TimeRefusal[] = Object.freeze([
  'time-future',
  'time-past',
  'beyond-retention',
  'over-max-range',
  'multi-day',
  'dst-gap',
]);
