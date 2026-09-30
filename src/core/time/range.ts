/**
 * core/time/range — the library's one range, its two spellings, and one
 * conversion per boundary a range crosses.
 *
 * Pattern: one internal shape, converted at every edge by a named function —
 *          never inline. Inside the library a range is HALF-OPEN `[from, to)`;
 *          the places a range crosses do not share that edge (the time design,
 *          `docs/design/time/README.md` § 3.3), so each crossing is a function
 *          here and its inverse.
 * Role:    core/ leaf (the time layer's one owner). Imports `instant.ts` and
 *          `duration.ts`. Asked by `arguments/declare.ts` ·
 *          `parsesUnderSpelling` (an `iso-range` argument is
 *          {@link splitRange} under `'..'` and the strict profile). No other
 *          file splits or joins a range.
 * Emits:   N/A.
 *
 * ## The boundaries
 *
 * | Boundary | Its edge | Into it from `[from, to)` | Back |
 * |----------|----------|---------------------------|------|
 * | a result's `DeclaredPeriod.queried` / `held` | inclusive at both ends | not converted — the tool declares it | {@link fromInclusive} with the tool's step (`granularity`, else 1 ms) |
 * | a tool argument bound | declared on every `bounds`/`object` end (TQ18); only the sugar defaults inclusive | {@link boundInto} | {@link boundFrom} |
 * | a look-back argument | `[until − L, until]` | {@link lookbackRange} | {@link lookbackOf} |
 * | an ask answer / an ISO 8601 interval | `from/to`, half-open | identity: {@link spellRange} | identity: {@link parseRange} |
 * | an inclusive interval clause (SQL `BETWEEN`, a chart brush) | inclusive at both ends | {@link toInclusive} | {@link fromInclusive} |
 *
 * `coverage/period.ts` · `periodVerdict` stays inclusive and is NOT routed
 * through here: it compares the two inclusive spans a result declared.
 *
 * A derived bound keeps the offset its source was written in, spelled in the
 * strict profile; a bound that is not derived is kept as written.
 *
 * @example
 * ```ts
 * parseRange('2026-10-09T08:00:00-07:00/2026-10-09T08:41:00-07:00');
 * // { from: '2026-10-09T08:00:00-07:00', to: '2026-10-09T08:41:00-07:00' }
 * toInclusive({ from: '2026-10-09T08:00:00-07:00', to: '2026-10-09T08:41:00-07:00' }, 60_000);
 * // { from: '2026-10-09T08:00:00-07:00', to: '2026-10-09T08:40:00-07:00' } — "through 08:40"
 * ```
 */

import { durationMs, spellDuration, type DurationText } from './duration.js';
import {
  compareInstants,
  instantOf,
  shiftInstant,
  spellInstant,
  type Instant,
  type InstantProfile,
  type InstantText,
  type ParsedInstant,
} from './instant.js';

/**
 * The library's INTERNAL range: half-open `[from, to)`, `from` before `to`.
 * NOT the same reading as `DeclaredPeriod.queried`, whose bounds are
 * inclusive — every boundary converts (the module table).
 */
export interface TimeRange {
  readonly from: InstantText;
  readonly to: InstantText;
}

/** Two instants with inclusive ends, `from` not after `to` — a declared period's span, an SQL `BETWEEN`. */
export interface InclusiveSpan {
  readonly from: InstantText;
  readonly to: InstantText;
}

/** How two bounds are joined in one string: an ISO 8601 interval (`/`) or a tool's joined argument (`..`). */
export type RangeJoiner = '/' | '..';

/** Whether a tool's bound includes the instant it names. */
export type Edge = 'inclusive' | 'exclusive';

/**
 * The two bounds of a joined range string — exactly one `joiner`, each half an
 * instant under `profile` — or `undefined`. The ORDER is not checked: a format
 * check, for a declaration that only promises a spelling.
 */
export function splitRange(
  value: unknown,
  joiner: RangeJoiner,
  profile: InstantProfile,
): readonly [ParsedInstant, ParsedInstant] | undefined {
  if (typeof value !== 'string') return undefined;
  const halves = value.split(joiner);
  if (halves.length !== 2) return undefined;
  const from = instantOf(halves[0], profile);
  const to = instantOf(halves[1], profile);
  return from === undefined || to === undefined ? undefined : [from, to];
}

/**
 * A joined string read as a {@link TimeRange} — strict instants, `from`
 * before `to` — or `undefined`. The bounds are kept as written.
 */
export function parseRange(value: unknown, joiner: RangeJoiner = '/'): TimeRange | undefined {
  const bounds = splitRange(value, joiner, 'strict');
  if (bounds === undefined || compareInstants(bounds[0], bounds[1]) >= 0) return undefined;
  const [from, to] = (value as string).split(joiner) as [string, string];
  return { from, to };
}

/** Whether `value` is a well-formed {@link TimeRange}: strict instants, `from` before `to`, no other key. */
export function isTimeRange(value: unknown): value is TimeRange {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;
  const keys = Object.keys(value);
  if (keys.length !== 2 || !keys.includes('from') || !keys.includes('to')) return false;
  const { from, to } = value as Record<string, unknown>;
  const a = instantOf(from, 'strict');
  const b = instantOf(to, 'strict');
  return a !== undefined && b !== undefined && compareInstants(a, b) < 0;
}

function assertRange(range: TimeRange, caller: string): readonly [ParsedInstant, ParsedInstant] {
  if (!isTimeRange(range)) {
    throw new TypeError(
      `${caller}: ${JSON.stringify(
        range,
      )} is not a TimeRange — two strict ISO 8601 instants with a zone, from before to.`,
    );
  }
  return [instantOf(range.from, 'strict'), instantOf(range.to, 'strict')] as [
    ParsedInstant,
    ParsedInstant,
  ];
}

function assertStep(stepMs: number, caller: string): void {
  if (!Number.isSafeInteger(stepMs) || stepMs <= 0) {
    throw new TypeError(
      `${caller}: the step ${String(stepMs)} is not a positive whole number of milliseconds.`,
    );
  }
}

function respell(instant: Instant, offsetMinutes: number, caller: string): InstantText {
  const text = spellInstant(instant, offsetMinutes);
  if (text === undefined)
    throw new RangeError(`${caller}: the bound falls outside years 0000–9999.`);
  return text;
}

/** The range spelled as one string: `from<joiner>to`, bounds as written. Throws on a range that is not well formed. */
export function spellRange(range: TimeRange, joiner: RangeJoiner = '/'): string {
  assertRange(range, 'spellRange');
  return `${range.from}${joiner}${range.to}`;
}

/** The step a tool's `granularity` names (under `units`), else 1 ms — the § 3.3 rule. */
export function stepMsOf(granularity: DurationText | undefined, units: string): number {
  if (granularity === undefined) return 1;
  const ms = durationMs(granularity, units);
  if (ms === undefined)
    throw new TypeError(`stepMsOf: '${String(granularity)}' is not a duration in '${units}'.`);
  return ms;
}

/**
 * An inclusive span read back as half-open: `[from, to + step)`. The step is
 * the source's smallest step (a tool's `granularity`, else 1 ms). The span is
 * read in the LENIENT profile — a result declares it.
 */
export function fromInclusive(span: InclusiveSpan, stepMs = 1): TimeRange {
  assertStep(stepMs, 'fromInclusive');
  const from = instantOf(span.from, 'lenient');
  const to = instantOf(span.to, 'lenient');
  if (from === undefined || to === undefined || compareInstants(from, to) > 0) {
    throw new TypeError(
      `fromInclusive: ${JSON.stringify(span)} is not an inclusive span of instants.`,
    );
  }
  return {
    // Kept as written when it is already strict; a lenient spelling (`t`, `z`, `:60`) is respelled.
    from:
      instantOf(span.from, 'strict') !== undefined
        ? span.from
        : respell(from, from.offsetMinutes, 'fromInclusive'),
    to: respell(shiftInstant(to, stepMs), to.offsetMinutes, 'fromInclusive'),
  };
}

/**
 * A half-open range written with inclusive ends: `[from, to − step]` — the
 * last instant inside the range at the reader's precision. Refused when the
 * range is narrower than one step (it holds no instant at that precision).
 */
export function toInclusive(range: TimeRange, stepMs = 1): InclusiveSpan {
  assertStep(stepMs, 'toInclusive');
  const [from, to] = assertRange(range, 'toInclusive');
  const last = shiftInstant(to, -stepMs);
  if (compareInstants(from, last) > 0) {
    throw new RangeError(
      `toInclusive: ${spellRange(range)} is narrower than one step of ${stepMs} ms.`,
    );
  }
  return { from: range.from, to: respell(last, to.offsetMinutes, 'toInclusive') };
}

/**
 * A half-open range's end as a tool's `to` bound: `exclusive` → as is;
 * `inclusive` → the last instant inside at the argument's precision
 * (`to − step`).
 */
export function boundInto(to: InstantText, edge: Edge, stepMs: number): InstantText {
  assertStep(stepMs, 'boundInto');
  const at = instantOf(to, 'strict');
  if (at === undefined)
    throw new TypeError(`boundInto: ${JSON.stringify(to)} is not a strict instant.`);
  return edge === 'exclusive'
    ? to
    : respell(shiftInstant(at, -stepMs), at.offsetMinutes, 'boundInto');
}

/** The inverse of {@link boundInto}: a tool's `to` bound as a half-open range's end. */
export function boundFrom(to: InstantText, edge: Edge, stepMs: number): InstantText {
  assertStep(stepMs, 'boundFrom');
  const at = instantOf(to, 'strict');
  if (at === undefined)
    throw new TypeError(`boundFrom: ${JSON.stringify(to)} is not a strict instant.`);
  return edge === 'exclusive'
    ? to
    : respell(shiftInstant(at, stepMs), at.offsetMinutes, 'boundFrom');
}

/**
 * A look-back `duration` evaluated at `until` — `[until − L, until]`, both
 * ends inside — as a half-open range `[until − L, until + 1 ms)`.
 */
export function lookbackRange(
  until: InstantText,
  duration: DurationText,
  units: string,
): TimeRange {
  const at = instantOf(until, 'strict');
  if (at === undefined)
    throw new TypeError(`lookbackRange: ${JSON.stringify(until)} is not a strict instant.`);
  const ms = durationMs(duration, units);
  if (ms === undefined)
    throw new TypeError(`lookbackRange: '${String(duration)}' is not a duration in '${units}'.`);
  return fromInclusive({
    from: respell(shiftInstant(at, -ms), at.offsetMinutes, 'lookbackRange'),
    to: until,
  });
}

/**
 * The inverse of {@link lookbackRange}: the `until` and the smallest exact
 * look-back spelling a half-open range is, or `undefined` when its length is
 * no whole duration in `units`.
 */
export function lookbackOf(
  range: TimeRange,
  units: string,
): { readonly until: InstantText; readonly duration: DurationText } | undefined {
  const [from, to] = assertRange(range, 'lookbackOf');
  const until = shiftInstant(to, -1);
  if (from.nanos !== until.nanos) return undefined;
  const duration = spellDuration(until.ms - from.ms, units);
  return duration === undefined
    ? undefined
    : { until: respell(until, to.offsetMinutes, 'lookbackOf'), duration };
}

/** Whether `outer` holds every instant of `inner` (half-open). */
export function covers(outer: TimeRange, inner: TimeRange): boolean {
  const [of, ot] = assertRange(outer, 'covers');
  const [inf, int] = assertRange(inner, 'covers');
  return compareInstants(of, inf) <= 0 && compareInstants(int, ot) <= 0;
}

/** Whether `a` and `b` share at least one instant (half-open: touching ends do not overlap). */
export function overlaps(a: TimeRange, b: TimeRange): boolean {
  const [af, at] = assertRange(a, 'overlaps');
  const [bf, bt] = assertRange(b, 'overlaps');
  return compareInstants(af, bt) < 0 && compareInstants(bf, at) < 0;
}

const floorTo = (instant: Instant, stepMs: number): Instant => ({
  ms: instant.ms - (((instant.ms % stepMs) + stepMs) % stepMs),
  nanos: 0,
});

/**
 * The range widened to whole steps — `from` down, `to` up, never inward —
 * with `rounded` saying whether anything moved. Steps are counted from the
 * epoch in UTC: right for seconds, minutes and hours; a calendar day or week
 * in a zone is `zone.ts`'s question, not this one.
 */
export function roundOutward(
  range: TimeRange,
  stepMs: number,
): { readonly range: TimeRange; readonly rounded: boolean } {
  assertStep(stepMs, 'roundOutward');
  const [from, to] = assertRange(range, 'roundOutward');
  const down = floorTo(from, stepMs);
  const toFloor = floorTo(to, stepMs);
  const up = compareInstants(toFloor, to) === 0 ? toFloor : shiftInstant(toFloor, stepMs);
  const fromMoved = compareInstants(down, from) !== 0;
  const toMoved = compareInstants(up, to) !== 0;
  return {
    range: {
      from: fromMoved ? respell(down, from.offsetMinutes, 'roundOutward') : range.from,
      to: toMoved ? respell(up, to.offsetMinutes, 'roundOutward') : range.to,
    },
    rounded: fromMoved || toMoved,
  };
}
