/**
 * core/time/axis — a dataset's TIME AXIS: the declaration, its one judge, and
 * the read-side view that turns the declared column into comparable instants.
 *
 * Pattern: declared, never guessed; judged at mint, never repaired; values
 *          read through ONE view ({@link normaliseInstants}) that never
 *          touches the stored rows. Moved here from `artifacts/timeAxis.ts`
 *          (which `artifacts/index.ts` still re-exports), so the axis speaks
 *          the time layer's one grammar: `interval` is a `duration.ts`
 *          duration under {@link AXIS_UNITS}, `zone` is a `zone.ts` zone name.
 * Role:    core/ leaf (the time layer's one owner). Imports `instant.ts`,
 *          `duration.ts` and `zone.ts`. Asked by `artifacts/minting.ts` ·
 *          `prepareArtifact` and `artifacts/datasetResult.ts` ·
 *          `stageDatasetArtifacts` (the judge), and by any consumer that
 *          compares a dataset's times (the view).
 * Emits:   N/A.
 *
 * ## Why a producer declares it
 *
 * A table of rows is a time series only when one column IS time, and the
 * reader of the rows cannot know that honestly: `ts` holding 1726000000 is
 * epoch SECONDS to the tool that wrote it and a large integer to everything
 * else; `'2026-09-14T10:00:00'` is UTC or the collector's wall clock. So the
 * producer SAYS it, on the ticket (`PutArtifactInput.timeAxis`, carried on
 * `ArtifactMeta.timeAxis`). A malformed declaration is REFUSED at mint
 * ({@link timeAxisIssues}) — never trimmed or defaulted — and the shape is
 * CLOSED: a misspelt `agg` is refused by name, never dropped.
 *
 * ## The view — values, not the declaration
 *
 * The judge never reads a value; {@link normaliseInstants} does, at read time.
 * It turns the declared column into UTC `Z` instants spelled at ONE precision,
 * so a lexicographic compare downstream is chronological, and it is honest
 * about every value it could not place:
 *
 * | Value | Under | Read as |
 * |-------|-------|---------|
 * | a number | `epoch-s` / `epoch-ms` | that instant, exactly as written (no float rounding) |
 * | ISO with `Z` or `±HH:MM` | `iso`, any zone | that instant (the lenient profile — a producer's spelling) |
 * | ISO with NO offset | `iso`, no `zone` | **naive** — counted, never read as UTC; `status: 'naive-values'`, or refused under `naive: 'refuse'` |
 * | ISO with no offset | `iso` + `zone` | a wall time in that zone; one instant, or — in a fall-back overlap — the row-order rule below; in a spring-forward gap, counted `dstGap` |
 * | anything else | — | counted `unreadable` (`missing` when the row lacks the column) |
 *
 * **The fall-back rule.** In the hour the clocks go back, one wall time names
 * two instants. Read in the rows' order, the values before the wall clock
 * steps back take the earlier offset and those from the step on the later
 * (a note `{ kind: 'dst-overlap', resolvedBy: 'row-order' }` per value). When
 * the order cannot tell — a lone `01:30`, no step back, two steps back, or a
 * column whose wall times are not in order anywhere — the value is counted
 * `dstAmbiguous` and handled like a naive one. Nothing is picked silently.
 *
 * @example
 * ```ts
 * timeAxisIssues({ column: 'ts', unit: 'epoch-s', zone: 'UTC' }); // ['timeAxis.zone is for wall-clock ISO values; …']
 * normaliseInstants([{ ts: 1726300800 }, { ts: 1726304400.5 }], { column: 'ts', unit: 'epoch-s' });
 * // { status: 'instants', precision: 'millisecond',
 * //   points: [{ row: 0, at: '2024-09-14T08:00:00.000Z' }, { row: 1, at: '2024-09-14T09:00:00.500Z' }], … }
 * normaliseInstants([{ t: '2026-09-14T10:00:00' }], { column: 't', unit: 'iso' });
 * // { status: 'naive-values', count: 1, points: [], … } — never read as UTC
 * ```
 */

import { AXIS_UNITS, durationParts, isDuration } from './duration.js';
import { instantOf, spellInstant, type Instant, type InstantText } from './instant.js';
import { isZoneName, readWall, type WallReading, type WallTime, type ZoneName } from './zone.js';

// ── The declaration ─────────────────────────────────────────────────────────

/** How the time column's values are written. */
export type TimeAxisUnit = 'iso' | 'epoch-s' | 'epoch-ms';

/** How one row summarises the interval it stands for. */
export type TimeAxisAggregate = 'avg' | 'min' | 'max' | 'sum' | 'count' | 'last';

/** The closed sets, in one place, for the judge and for its own messages. */
export const TIME_AXIS_UNITS: readonly TimeAxisUnit[] = ['iso', 'epoch-s', 'epoch-ms'];
export const TIME_AXIS_AGGREGATES: readonly TimeAxisAggregate[] = [
  'avg',
  'min',
  'max',
  'sum',
  'count',
  'last',
];

/**
 * A dataset's declared time axis.
 *
 * @example hourly buckets, two measures summarised differently
 *   { column: 'hour', unit: 'iso', interval: '1h',
 *     aggregate: { read_iops: 'avg', peak_iops: 'max' } }
 * @example raw samples every five minutes, epoch seconds
 *   { column: 'ts', unit: 'epoch-s', interval: '5m', aggregate: 'raw' }
 */
export interface DatasetTimeAxis {
  /** The column that holds time. */
  readonly column: string;
  /** `'iso'` — ISO-8601 strings; `'epoch-s'` / `'epoch-ms'` — numbers since
   *  1970-01-01T00:00:00Z in seconds / milliseconds. */
  readonly unit: TimeAxisUnit;
  /** IANA zone name (`'Europe/London'`) the values are WALL-CLOCK in — never
   *  an abbreviation such as `'PST'` or a bare offset. `'iso'` only — an epoch
   *  is an instant and has no zone to declare. Absent: every ISO value must
   *  carry its own offset (`Z` or `±HH:MM`); a value without one is NEVER
   *  read as UTC — {@link normaliseInstants} counts it (`naive-values`) or,
   *  by the reader's choice, refuses the column. */
  readonly zone?: string;
  /** Width of the interval one row stands for: a positive whole number and
   *  one of `s m h d w` (`'30s'`, `'5m'`, `'1h'`, `'1d'`, `'1w'`) — the time
   *  layer's one duration grammar, any number of digits. With
   *  `aggregate: 'raw'` it is the sampling cadence. */
  readonly interval?: string;
  /**
   * How each row summarises its interval. `'raw'` — every row is a sample as
   * collected, nothing was reduced. One aggregate — every measure column was
   * reduced the same way. A record — measure column to its own aggregate
   * (`{ avg_iops: 'avg', peak_iops: 'max' }`); a column not named there is
   * not a declared measure. Any aggregate other than `'raw'` requires
   * `interval`, and `interval` requires `aggregate`: a summary of an interval
   * nobody named, or an interval with no word for what happened in it, is
   * half a declaration.
   */
  readonly aggregate?: 'raw' | TimeAxisAggregate | Readonly<Record<string, TimeAxisAggregate>>;
}

const KEYS = new Set(['column', 'unit', 'zone', 'interval', 'aggregate']);

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isAggregate(value: unknown): value is TimeAxisAggregate {
  return (TIME_AXIS_AGGREGATES as readonly unknown[]).includes(value);
}

/**
 * THE ONE JUDGE of a time-axis declaration. Returns every problem, in words a
 * producer can act on; an empty list means the declaration is well-formed.
 * Never throws, never repairs, never reads a value.
 */
export function timeAxisIssues(value: unknown): string[] {
  if (!isRecord(value)) {
    return [`timeAxis must be an object like { column, unit }, got ${describeValue(value)}.`];
  }
  const issues: string[] = [];
  for (const key of Object.keys(value)) {
    if (!KEYS.has(key)) {
      issues.push(
        `timeAxis has an unknown key '${key}'; the keys are column, unit, zone, interval, aggregate.`,
      );
    }
  }
  const { column, unit, zone, interval, aggregate } = value;
  if (typeof column !== 'string' || column.trim() === '') {
    issues.push(`timeAxis.column must name the time column, got ${describeValue(column)}.`);
  }
  if (!(TIME_AXIS_UNITS as readonly unknown[]).includes(unit)) {
    issues.push(
      `timeAxis.unit must be one of ${TIME_AXIS_UNITS.join(', ')}, got ${describeValue(unit)}.`,
    );
  }
  if (zone !== undefined) {
    if (!isZoneName(zone)) {
      issues.push(
        `timeAxis.zone must be an IANA zone such as 'Europe/London' (an abbreviation such as ` +
          `'PST' or a bare offset is not one), got ${describeValue(zone)}.`,
      );
    } else if (unit !== 'iso') {
      issues.push(
        `timeAxis.zone is for wall-clock ISO values; an epoch is an instant and has no zone — ` +
          `drop zone or use unit 'iso'.`,
      );
    }
  }
  if (interval !== undefined && !isDuration(interval, AXIS_UNITS)) {
    issues.push(
      `timeAxis.interval must be a positive whole number and one of s m h d w ('5m', '1h', '1d'), ` +
        `got ${describeValue(interval)}.`,
    );
  }
  if (aggregate !== undefined && aggregate !== 'raw' && !isAggregate(aggregate)) {
    if (!isRecord(aggregate)) {
      issues.push(
        `timeAxis.aggregate must be 'raw', one of ${TIME_AXIS_AGGREGATES.join(', ')}, or a ` +
          `record of measure column to one of them, got ${describeValue(aggregate)}.`,
      );
    } else {
      const entries = Object.entries(aggregate);
      if (entries.length === 0) {
        issues.push('timeAxis.aggregate names no measure; declare at least one, or omit it.');
      }
      for (const [measure, how] of entries) {
        if (measure.trim() === '') issues.push('timeAxis.aggregate has a blank measure name.');
        if (measure === column) {
          issues.push(`timeAxis.aggregate names the time column '${measure}' as a measure.`);
        }
        if (!isAggregate(how)) {
          issues.push(
            `timeAxis.aggregate['${measure}'] must be one of ${TIME_AXIS_AGGREGATES.join(', ')}, ` +
              `got ${describeValue(how)}.`,
          );
        }
      }
    }
  }
  if (aggregate !== undefined && aggregate !== 'raw' && interval === undefined) {
    issues.push(
      'timeAxis.aggregate summarises an interval, so timeAxis.interval must say how wide it is.',
    );
  }
  if (interval !== undefined && aggregate === undefined) {
    issues.push(
      `timeAxis.interval needs timeAxis.aggregate — say how each interval was summarised, or 'raw'.`,
    );
  }
  return issues;
}

/** What a consumer finds on a ticket. `malformed` exists for tickets minted
 *  outside this library's put (a foreign writer, an old store) — a consumer
 *  shows it as an error, never as an undeclared dataset. */
export type TimeAxisReading =
  | { readonly status: 'absent' }
  | { readonly status: 'declared'; readonly axis: DatasetTimeAxis }
  | { readonly status: 'malformed'; readonly issues: readonly string[] };

/** Read the declaration off a ticket (`ArtifactMeta`, or anything shaped like
 *  one). Absent is absent; anything present is judged. */
export function readTimeAxis(meta: unknown): TimeAxisReading {
  const value = isRecord(meta) ? meta.timeAxis : undefined;
  if (value === undefined) return { status: 'absent' };
  const issues = timeAxisIssues(value);
  return issues.length > 0
    ? { status: 'malformed', issues }
    : { status: 'declared', axis: value as unknown as DatasetTimeAxis };
}

// ── The wording ─────────────────────────────────────────────────────────────

const UNIT_WORDS: Record<string, string> = {
  s: 'second',
  m: 'minute',
  h: 'hour',
  d: 'day',
  w: 'week',
};
const SINGLE: Record<string, string> = {
  s: 'per-second',
  m: 'per-minute',
  h: 'hourly',
  d: 'daily',
  w: 'weekly',
};

/** `'1h'` → `'hourly'`, `'5m'` → `'5-minute'`. */
function intervalAdjective(interval: string): string {
  const parts = durationParts(interval, AXIS_UNITS);
  if (parts === undefined) return interval;
  return parts.digits === '1'
    ? (SINGLE[parts.unit] as string)
    : `${parts.digits}-${UNIT_WORDS[parts.unit] as string}`;
}

/** `'5m'` → `'5 minutes'`, `'1h'` → `'hour'`. */
function intervalNoun(interval: string): string {
  const parts = durationParts(interval, AXIS_UNITS);
  if (parts === undefined) return interval;
  return parts.digits === '1'
    ? (UNIT_WORDS[parts.unit] as string)
    : `${parts.digits} ${UNIT_WORDS[parts.unit] as string}s`;
}

function joinWords(words: readonly string[]): string {
  if (words.length <= 1) return words[0] ?? '';
  return `${words.slice(0, -1).join(', ')} and ${words[words.length - 1] as string}`;
}

/**
 * The declared SUMMARY in words, for a chart title — the one wording every
 * consumer shares, so two screens never describe one ticket two ways.
 *
 *   `{ interval: '1h', aggregate: { a: 'avg', b: 'max' } }` → `'hourly avg and max'`
 *   `{ interval: '5m', aggregate: 'max' }`                 → `'5-minute max'`
 *   `{ interval: '5m', aggregate: 'raw' }`                 → `'raw samples every 5 minutes'`
 *   `{ aggregate: 'raw' }`                                 → `'raw samples'`
 *
 * `undefined` when the declaration says nothing about summarising (column and
 * unit only) — there is no summary to put in a title, and inventing "raw"
 * would claim something the producer did not.
 */
export function describeTimeAxis(axis: DatasetTimeAxis): string | undefined {
  const { aggregate, interval } = axis;
  if (aggregate === undefined) return undefined;
  if (aggregate === 'raw') {
    return interval === undefined ? 'raw samples' : `raw samples every ${intervalNoun(interval)}`;
  }
  const words =
    typeof aggregate === 'string' ? [aggregate] : [...new Set(Object.values(aggregate))];
  const how = joinWords(words);
  return interval === undefined ? how : `${intervalAdjective(interval)} ${how}`;
}

function describeValue(value: unknown): string {
  if (value === undefined) return 'nothing';
  try {
    const text = JSON.stringify(value);
    if (text === undefined) return typeof value;
    return text.length > 60 ? `${text.slice(0, 57)}...` : text;
  } catch {
    return typeof value;
  }
}

// ── The view ────────────────────────────────────────────────────────────────

/** What {@link normaliseInstants} does with a naive value: count it (`'flag'`, the default) or refuse the column. */
export type NaiveValues = 'flag' | 'refuse';

/** Options of {@link normaliseInstants}. */
export interface NormaliseOptions {
  /** A value whose clock is unknown (naive, or a fall-back wall time the row
   *  order cannot place): `'flag'` counts it and reads the rest; `'refuse'`
   *  places nothing. Never read as UTC either way. Default `'flag'`. */
  readonly naive?: NaiveValues;
}

/** The one precision every point of a view is spelled at: the finest any value was written in. */
export type AxisPrecision = 'second' | 'millisecond' | 'nanosecond';

/** One placed value: the row it came from and its UTC instant. */
export interface AxisPoint {
  /** The row's index in the rows as stored. */
  readonly row: number;
  /** The instant in UTC (`Z`), at the view's one precision — so comparing two
   *  spellings as text compares them in time. */
  readonly at: InstantText;
}

/** A value the fall-back overlap doubled, placed by the rows' order. */
export interface AxisOverlapNote {
  readonly kind: 'dst-overlap';
  readonly resolvedBy: 'row-order';
  readonly row: number;
  /** Which of the two instants the wall time names: before the clock stepped back, or after. */
  readonly which: 'earlier' | 'later';
}

/** Every value the view could not place, by reason. */
export interface AxisCounts {
  /** An ISO value with no offset under an axis with no `zone`. */
  readonly naive: number;
  /** A wall time the fall-back doubles, where the rows' order cannot tell which. */
  readonly dstAmbiguous: number;
  /** A wall time the spring-forward skips — it names no instant. */
  readonly dstGap: number;
  /** Present, but not a value of the declared unit (or outside years 0000–9999). */
  readonly unreadable: number;
  /** The row lacks the column, holds `null`, or is not a record. */
  readonly missing: number;
}

/**
 * The read-side view of a declared time column.
 *
 * - `instants` — every value whose clock is known was placed.
 * - `naive-values` — `count` values have no known clock (`naive` +
 *   `dstAmbiguous`); they are not in `points`, and nothing should compare or
 *   join the series with another source as if they were.
 * - `refused` — the same, under `naive: 'refuse'`: nothing is placed.
 *
 * `points` are sorted in time (ties by row); `unreadable`, `missing` and
 * `dstGap` are counted under every status.
 */
export type NormalisedAxis =
  | {
      readonly status: 'instants';
      readonly points: readonly AxisPoint[];
      readonly precision: AxisPrecision;
      readonly notes: readonly AxisOverlapNote[];
      readonly counts: AxisCounts;
    }
  | {
      readonly status: 'naive-values';
      readonly count: number;
      readonly points: readonly AxisPoint[];
      readonly precision: AxisPrecision;
      readonly notes: readonly AxisOverlapNote[];
      readonly counts: AxisCounts;
    }
  | {
      readonly status: 'refused';
      readonly reason: 'naive-values';
      readonly count: number;
      readonly counts: AxisCounts;
    };

/** One value's first reading, before the fall-back rule. */
type Classified =
  | { readonly kind: 'missing' | 'unreadable' | 'naive' | 'gap' }
  | { readonly kind: 'instant'; readonly instant: Instant; readonly wall?: number }
  | {
      readonly kind: 'overlap';
      readonly earlier: Instant;
      readonly later: Instant;
      readonly wall: number;
      readonly day: string;
    };

const NS_PER_MS = 1_000_000n;

/**
 * An epoch number read EXACTLY as written — through its decimal spelling, so
 * `1726304400.123` is 123 ms and not the double's nearest neighbour. An
 * exponent spelling (`1e21`) or a fraction finer than a nanosecond is
 * unreadable.
 */
function epochInstant(value: unknown, unit: 'epoch-s' | 'epoch-ms'): Instant | undefined {
  if (typeof value !== 'number' || !Number.isFinite(value)) return undefined;
  const m = /^(-?)(\d+)(?:\.(\d+))?$/.exec(String(value));
  if (m === null) return undefined;
  const fractionDigits = unit === 'epoch-s' ? 9 : 6; // down to one nanosecond
  const fraction = m[3] ?? '';
  if (fraction.length > fractionDigits) return undefined;
  const magnitude =
    BigInt(m[2] as string) * 10n ** BigInt(fractionDigits) +
    BigInt(fraction.padEnd(fractionDigits, '0') || '0');
  const ns = m[1] === '-' ? -magnitude : magnitude;
  let ms = ns / NS_PER_MS;
  if (ns < 0n && ms * NS_PER_MS !== ns) ms -= 1n; // floor, not truncate
  const whole = Number(ms);
  if (!Number.isSafeInteger(whole)) return undefined;
  return { ms: whole, nanos: Number(ns - ms * NS_PER_MS) };
}

const DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/;

/**
 * An ISO value with no offset, read as a UTC WALL reading only to get its
 * fields — never as an instant. `undefined` when it is not a date-time (or a
 * date) with no zone.
 */
function naiveFields(value: string): Instant | undefined {
  const spelled = DATE_ONLY.test(value) ? `${value}T00:00Z` : `${value}Z`;
  return instantOf(spelled, 'lenient');
}

function wallOf(fields: Instant): WallTime {
  const d = new Date(fields.ms);
  return {
    year: d.getUTCFullYear(),
    month: d.getUTCMonth() + 1,
    day: d.getUTCDate(),
    hour: d.getUTCHours(),
    minute: d.getUTCMinutes(),
    second: d.getUTCSeconds(),
    millisecond: d.getUTCMilliseconds(),
  };
}

function spellable(instant: Instant): boolean {
  return spellInstant(instant, 0) !== undefined;
}

function classifyIso(
  value: unknown,
  zone: ZoneName | undefined,
  walls: Map<number, WallReading>,
): Classified {
  if (typeof value !== 'string') return { kind: 'unreadable' };
  const instant = instantOf(value, 'lenient');
  if (instant !== undefined) return { kind: 'instant', instant };
  const fields = naiveFields(value);
  if (fields === undefined) return { kind: 'unreadable' };
  if (zone === undefined) return { kind: 'naive' };
  const wall = fields.ms;
  let reading = walls.get(wall);
  if (reading === undefined) {
    const w = wallOf(fields);
    if (w.year > 9999) return { kind: 'unreadable' };
    reading = readWall(w, zone);
    walls.set(wall, reading);
  }
  const at = (ms: number): Instant => ({ ms, nanos: fields.nanos });
  if (reading.kind === 'gap') return { kind: 'gap' };
  if (reading.kind === 'unique') return { kind: 'instant', instant: at(reading.ms), wall };
  return {
    kind: 'overlap',
    earlier: at(reading.earlier),
    later: at(reading.later),
    wall,
    day: value.slice(0, 10),
  };
}

function classifyEpoch(value: unknown, unit: 'epoch-s' | 'epoch-ms'): Classified {
  const instant = epochInstant(value, unit);
  return instant === undefined ? { kind: 'unreadable' } : { kind: 'instant', instant };
}

function classify(
  row: unknown,
  axis: DatasetTimeAxis,
  walls: Map<number, WallReading>,
): Classified {
  if (!isRecord(row)) return { kind: 'missing' };
  const value = row[axis.column];
  if (value === undefined || value === null) return { kind: 'missing' };
  const read =
    axis.unit === 'iso' ? classifyIso(value, axis.zone, walls) : classifyEpoch(value, axis.unit);
  if (read.kind === 'instant' && !spellable(read.instant)) return { kind: 'unreadable' };
  if (read.kind === 'overlap' && !(spellable(read.earlier) && spellable(read.later))) {
    return { kind: 'unreadable' };
  }
  return read;
}

/**
 * The fall-back rule over the rows' order: for each overlap day, the one
 * place its wall clock steps back (a value not after the one before it)
 * splits it into `earlier` then `later`. Any step back that is NOT inside one
 * overlap day means the rows are not in time order, and every overlap value
 * is left unplaced; so is a day with no step back or more than one.
 */
function resolveOverlaps(
  read: readonly Classified[],
  nanos: (i: number) => number,
): Map<number, 'earlier' | 'later'> {
  const placed = new Map<number, 'earlier' | 'later'>();
  const walled: number[] = [];
  for (let i = 0; i < read.length; i++) {
    const r = read[i] as Classified;
    if ((r.kind === 'instant' && r.wall !== undefined) || r.kind === 'overlap') walled.push(i);
  }
  const wallAt = (i: number): number => (read[i] as { wall: number }).wall;
  const stepsByDay = new Map<string, number[]>();
  for (let k = 1; k < walled.length; k++) {
    const prev = walled[k - 1] as number;
    const here = walled[k] as number;
    const notAfter =
      wallAt(here) < wallAt(prev) || (wallAt(here) === wallAt(prev) && nanos(here) <= nanos(prev));
    if (!notAfter) continue;
    const a = read[prev] as Classified;
    const b = read[here] as Classified;
    if (a.kind !== 'overlap' || b.kind !== 'overlap' || a.day !== b.day) return placed;
    stepsByDay.set(a.day, [...(stepsByDay.get(a.day) ?? []), here]);
  }
  for (const [day, steps] of stepsByDay) {
    if (steps.length !== 1) continue;
    const step = steps[0] as number;
    for (let i = 0; i < read.length; i++) {
      const r = read[i] as Classified;
      if (r.kind === 'overlap' && r.day === day) placed.set(i, i < step ? 'earlier' : 'later');
    }
  }
  return placed;
}

const pad = (n: number, width: number): string => String(n).padStart(width, '0');

function precisionOf(instants: readonly Instant[]): AxisPrecision {
  let precision: AxisPrecision = 'second';
  for (const { ms, nanos } of instants) {
    if (nanos !== 0) return 'nanosecond';
    if (((ms % 1000) + 1000) % 1000 !== 0) precision = 'millisecond';
  }
  return precision;
}

/** `instant` in UTC with exactly the digits `precision` names — fixed width, so text order is time order. */
function spellAt(instant: Instant, precision: AxisPrecision): InstantText {
  const msPart = ((instant.ms % 1000) + 1000) % 1000;
  const whole = spellInstant({ ms: instant.ms - msPart, nanos: 0 }, 0) as string;
  if (precision === 'second') return whole;
  const fraction = pad(msPart * 1_000_000 + instant.nanos, 9);
  const digits = precision === 'millisecond' ? fraction.slice(0, 3) : fraction;
  return `${whole.slice(0, -1)}.${digits}Z`;
}

/**
 * THE READ-SIDE VIEW of a declared time column: every value turned into a UTC
 * `Z` instant at one precision, sorted in time, with every value it could not
 * place counted by reason (the module table). The rows are only read — never
 * copied into, reordered or rewritten — so the stored bytes are unchanged.
 *
 * A malformed `axis` throws a `TypeError` naming its issues (read a ticket
 * with `readTimeAxis` first; a declaration is never repaired).
 */
export function normaliseInstants(
  rows: readonly unknown[],
  axis: DatasetTimeAxis,
  options: NormaliseOptions = {},
): NormalisedAxis {
  const issues = timeAxisIssues(axis);
  if (issues.length > 0) {
    throw new TypeError(`normaliseInstants: the time axis is malformed — ${issues.join(' ')}`);
  }
  const naive = options.naive ?? 'flag';
  if (naive !== 'flag' && naive !== 'refuse') {
    throw new TypeError(
      `normaliseInstants: naive must be 'flag' or 'refuse', got ${describeValue(naive)}.`,
    );
  }
  if (!Array.isArray(rows)) {
    throw new TypeError(`normaliseInstants: rows must be an array, got ${describeValue(rows)}.`);
  }

  const walls = new Map<number, WallReading>();
  const read = rows.map((row) => classify(row, axis, walls));
  const nanosOf = (i: number): number => {
    const r = read[i] as Classified;
    return r.kind === 'instant' ? r.instant.nanos : r.kind === 'overlap' ? r.earlier.nanos : 0;
  };
  const byOrder = read.some((r) => r.kind === 'overlap')
    ? resolveOverlaps(read, nanosOf)
    : new Map<number, 'earlier' | 'later'>();

  const counts = { naive: 0, dstAmbiguous: 0, dstGap: 0, unreadable: 0, missing: 0 };
  const placed: { row: number; instant: Instant }[] = [];
  const notes: AxisOverlapNote[] = [];
  read.forEach((r, row) => {
    if (r.kind === 'instant') placed.push({ row, instant: r.instant });
    else if (r.kind === 'overlap') {
      const which = byOrder.get(row);
      if (which === undefined) counts.dstAmbiguous++;
      else {
        placed.push({ row, instant: r[which] });
        notes.push({ kind: 'dst-overlap', resolvedBy: 'row-order', row, which });
      }
    } else if (r.kind === 'gap') counts.dstGap++;
    else counts[r.kind]++;
  });

  const count = counts.naive + counts.dstAmbiguous;
  if (count > 0 && naive === 'refuse') {
    return { status: 'refused', reason: 'naive-values', count, counts };
  }
  placed.sort(
    (a, b) => a.instant.ms - b.instant.ms || a.instant.nanos - b.instant.nanos || a.row - b.row,
  );
  const precision = precisionOf(placed.map((p) => p.instant));
  const points = placed.map((p) => ({ row: p.row, at: spellAt(p.instant, precision) }));
  return count > 0
    ? { status: 'naive-values', count, points, precision, notes, counts }
    : { status: 'instants', points, precision, notes, counts };
}
