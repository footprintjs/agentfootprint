/**
 * artifacts/timeAxis — a dataset's TIME AXIS, declared by its producer.
 *
 * A table of rows is a time series only when one column IS time, and the
 * reader of the rows cannot know that honestly: `ts` holding 1726000000 is
 * epoch SECONDS to the tool that wrote it and a large integer to everything
 * else; `bucket` is a timestamp or a label; `'2026-09-14T10:00:00'` is UTC or
 * the collector's wall clock. A viewer that guesses draws some series and
 * leaves the rest as tables — and a guess that is right most of the time is
 * a guess nobody notices is wrong.
 *
 * So the producer SAYS it, on the ticket (`PutArtifactInput.timeAxis`, carried
 * on `ArtifactMeta.timeAxis`): which column is time, how its values are
 * written, the zone when they are wall-clock, and how each row summarises its
 * interval. A consumer that honours a declaration draws a time series without
 * guessing and says what the points ARE ({@link describeTimeAxis} — "hourly
 * avg and max"); an undeclared dataset keeps whatever heuristic the consumer
 * had.
 *
 * ── The law: declared, never repaired ───────────────────────────────────────
 * A malformed declaration is REFUSED at mint ({@link timeAxisIssues} is the
 * one judge, asked by `prepareArtifact` and by `stageDatasetArtifacts` before
 * its first write) — never trimmed, defaulted or half-kept. A declaration a
 * store had "fixed" would be a promise the producer never made. The shape is
 * CLOSED: an unknown key is refused by name, because a misspelt `agg` that
 * was silently dropped would draw raw samples under a title claiming a
 * summary nobody declared.
 *
 * What the declaration does NOT promise: that the column is present in every
 * row, or that its values parse. The ticket is metadata; the rows are the
 * payload, and the store never scans a payload to judge its description. A
 * consumer that finds the declared column missing says so, visibly — the
 * declaration is what makes that absence a finding instead of a table.
 *
 * Pure and dependency-free: the browser half of an app imports it to read the
 * same declaration the server minted.
 */

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
  /** IANA zone (`'Europe/London'`) the values are WALL-CLOCK in. `'iso'`
   *  only — an epoch is an instant and has no zone to declare. Absent: the
   *  ISO strings carry their own offset (or are UTC). */
  readonly zone?: string;
  /** Width of the interval one row stands for: a positive integer and one of
   *  `s m h d w` (`'30s'`, `'5m'`, `'1h'`, `'1d'`, `'1w'`). With
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
const INTERVAL = /^([1-9][0-9]{0,5})([smhdw])$/;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isAggregate(value: unknown): value is TimeAxisAggregate {
  return (TIME_AXIS_AGGREGATES as readonly unknown[]).includes(value);
}

function validZone(zone: string): boolean {
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: zone });
    return true;
  } catch {
    return false;
  }
}

/**
 * THE ONE JUDGE of a time-axis declaration. Returns every problem, in words a
 * producer can act on; an empty list means the declaration is well-formed.
 * Never throws, never repairs.
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
    if (typeof zone !== 'string' || !validZone(zone)) {
      issues.push(
        `timeAxis.zone must be an IANA zone such as 'Europe/London', got ${describeValue(zone)}.`,
      );
    } else if (unit !== 'iso') {
      issues.push(
        `timeAxis.zone is for wall-clock ISO values; an epoch is an instant and has no zone — ` +
          `drop zone or use unit 'iso'.`,
      );
    }
  }
  if (interval !== undefined && (typeof interval !== 'string' || !INTERVAL.test(interval))) {
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
  const [, n, unit] = INTERVAL.exec(interval) ?? [];
  if (n === undefined || unit === undefined) return interval;
  return n === '1' ? SINGLE[unit]! : `${n}-${UNIT_WORDS[unit]!}`;
}

/** `'5m'` → `'5 minutes'`, `'1h'` → `'hour'`. */
function intervalNoun(interval: string): string {
  const [, n, unit] = INTERVAL.exec(interval) ?? [];
  if (n === undefined || unit === undefined) return interval;
  return n === '1' ? UNIT_WORDS[unit]! : `${n} ${UNIT_WORDS[unit]!}s`;
}

function joinWords(words: readonly string[]): string {
  if (words.length <= 1) return words[0] ?? '';
  return `${words.slice(0, -1).join(', ')} and ${words[words.length - 1]!}`;
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
