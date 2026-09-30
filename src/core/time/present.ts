/**
 * core/time/present — time rendered for a PERSON, in a named zone.
 *
 * Pattern: one renderer, every person-facing line (time design § 3.1, § 10.2):
 *          the limits block's `Period:` line (`coverage/period.ts` ·
 *          `periodLine`) and, later, every time label the layer shows. A
 *          label is never parsed back; the typed record keeps the instants.
 * Role:    core/ leaf (the time layer). Imports `instant.ts`, `zone.ts` and
 *          `range.ts` only.
 * Emits:   N/A.
 *
 * ## The form — locale-neutral, the zone always named
 *
 * With no locale (no reader armed) there is no language to speak: the
 * form is ISO-like and the same in every language — a date, a 24-hour wall
 * time in the presentation zone, then the zone's name and its offset at that
 * moment:
 *
 * ```
 * 2026-10-09 08:00–08:40 America/Los_Angeles (UTC-07:00)
 * 2026-10-09 23:00 – 2026-10-10 01:00 Asia/Kolkata (UTC+05:30)
 * 2026-11-01 01:00 (UTC-07:00) – 2026-11-01 01:30 (UTC-08:00) America/Los_Angeles
 * 2026-10-09 15:00–15:40 UTC
 * ```
 *
 * The time is written as finely as either end needs it (minutes, seconds, or
 * milliseconds), never finer. When the two ends sit on different offsets (the
 * span crosses a DST change) each end names its own; otherwise the offset is
 * named once.
 *
 * ## With a locale (the reader's, § 11)
 *
 * A {@link Presentation} with a `locale` — the armed reader's, the language
 * the person wrote in — is rendered through `Intl.DateTimeFormat` in that
 * locale, at the same precision, the zone named by its short name
 * (`Fri, Oct 9, 2026, 8:00 – 8:40 AM PDT` in `en-US`). The words are the
 * runtime's ICU data; the instants behind the label are the record.
 *
 * ## The said end (§ 3.3)
 *
 * Inside the library a person's range is half-open: "to 8:40" read to the end
 * of its grain is `[08:00, 08:41)`. {@link presentRange} with that grain shows
 * the end AS SAID — the last instant inside the range at the grain,
 * `08:40` — never `08:41`. A declared period's `queried` / `held` is
 * inclusive already, so {@link presentSpan} shows its ends as declared.
 *
 * @example
 * ```ts
 * const la = { zone: 'America/Los_Angeles' };
 * presentRange({ from: '2026-10-09T08:00:00-07:00', to: '2026-10-09T08:41:00-07:00' }, la, 'minute');
 * // '2026-10-09 08:00–08:40 America/Los_Angeles (UTC-07:00)'
 * presentSpan('2026-10-09T15:00:00Z', '2026-10-09T15:40:00Z', la);
 * // '2026-10-09 08:00–08:40 America/Los_Angeles (UTC-07:00)'
 * presentInstant('2026-10-09T15:40:03Z', la);
 * // '2026-10-09 08:40:03 America/Los_Angeles (UTC-07:00)'
 * ```
 */

import { instantOf, type InstantText, type ParsedInstant } from './instant.js';
import type { TimeRange } from './range.js';
import { isZoneName, offsetAt, wallAt, type WallTime, type ZoneName } from './zone.js';

/**
 * Where a label is rendered — the presentation zone, and the locale when a
 * reader is armed (its `locale`: the language the person wrote in). Without a
 * locale the form is the locale-neutral one above.
 */
export interface Presentation {
  readonly zone: ZoneName;
  /** A BCP 47 language tag (`'en-US'`). Rendered through `Intl`; the zone is always named. */
  readonly locale?: string;
}

/** How finely a person said a time (time design § 3.2). */
export type Grain = 'second' | 'minute' | 'hour' | 'day' | 'week' | 'month' | 'year';

/** How finely a label is written. */
type Precision = 'year' | 'month' | 'day' | 'hour' | 'minute' | 'second' | 'millisecond';

const ORDER: readonly Precision[] = [
  'year',
  'month',
  'day',
  'hour',
  'minute',
  'second',
  'millisecond',
];

/** A week is shown as its days: a calendar week has no one ISO-like spelling people share. */
const PRECISION_OF: Readonly<Record<Grain, Precision>> = {
  second: 'second',
  minute: 'minute',
  hour: 'hour',
  day: 'day',
  week: 'day',
  month: 'month',
  year: 'year',
};

const pad = (n: number, width = 2): string => String(n).padStart(width, '0');

function finer(a: Precision, b: Precision): Precision {
  return ORDER.indexOf(a) >= ORDER.indexOf(b) ? a : b;
}

/** The coarsest precision that writes this wall time exactly (never coarser than minutes). */
function naturalPrecision(wall: WallTime): Precision {
  if ((wall.millisecond ?? 0) !== 0) return 'millisecond';
  if ((wall.second ?? 0) !== 0) return 'second';
  return 'minute';
}

function spellDate(wall: WallTime, precision: Precision): string {
  const year = wall.year < 0 ? `-${pad(-wall.year, 4)}` : pad(wall.year, 4);
  if (precision === 'year') return year;
  if (precision === 'month') return `${year}-${pad(wall.month)}`;
  return `${year}-${pad(wall.month)}-${pad(wall.day)}`;
}

/** The time of day at `precision`, or `''` for a date-only precision. */
function spellClock(wall: WallTime, precision: Precision): string {
  switch (precision) {
    case 'year':
    case 'month':
    case 'day':
      return '';
    case 'hour':
      return `${pad(wall.hour)}:00`;
    case 'minute':
      return `${pad(wall.hour)}:${pad(wall.minute)}`;
    case 'second':
      return `${pad(wall.hour)}:${pad(wall.minute)}:${pad(wall.second ?? 0)}`;
    case 'millisecond':
      return `${pad(wall.hour)}:${pad(wall.minute)}:${pad(wall.second ?? 0)}.${pad(
        wall.millisecond ?? 0,
        3,
      )}`;
  }
}

/** `UTC-07:00`, `UTC+05:45`; a historical offset that is not whole minutes keeps its seconds. */
function spellOffset(offsetMinutes: number): string {
  const totalSeconds = Math.round(offsetMinutes * 60);
  const sign = totalSeconds < 0 ? '-' : '+';
  const abs = Math.abs(totalSeconds);
  const h = Math.floor(abs / 3600);
  const m = Math.floor((abs % 3600) / 60);
  const s = abs % 60;
  return `UTC${sign}${pad(h)}:${pad(m)}${s === 0 ? '' : `:${pad(s)}`}`;
}

/** Whether a zone is UTC itself, which needs no offset beside its name. */
const isUtcName = (zone: ZoneName): boolean => zone === 'UTC' || zone === 'Etc/UTC';

interface Point {
  readonly wall: WallTime;
  readonly offset: string;
}

function pointOf(instant: ParsedInstant, zone: ZoneName): Point {
  return { wall: wallAt(zone, instant.ms), offset: spellOffset(offsetAt(zone, instant.ms)) };
}

function assertZone(presentation: Presentation, caller: string): ZoneName {
  if (!isZoneName(presentation?.zone)) {
    throw new TypeError(
      `${caller}: ${JSON.stringify(presentation?.zone)} is not an IANA zone name.`,
    );
  }
  return presentation.zone;
}

/** The fields `Intl` writes at each precision — the date always, the zone always named. */
const LOCALE_FIELDS: Readonly<Record<Precision, Intl.DateTimeFormatOptions>> = {
  year: { year: 'numeric' },
  month: { year: 'numeric', month: 'short' },
  day: { weekday: 'short', year: 'numeric', month: 'short', day: 'numeric' },
  hour: {
    weekday: 'short',
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  },
  minute: {
    weekday: 'short',
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  },
  second: {
    weekday: 'short',
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
    second: '2-digit',
  },
  millisecond: {
    weekday: 'short',
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
    second: '2-digit',
    fractionalSecondDigits: 3,
  },
};

/** The locale's formatter at `precision` in `zone`; throws a `TypeError` on a tag `Intl` cannot read. */
function localeFormatter(
  locale: string,
  zone: ZoneName,
  precision: Precision,
  caller: string,
): Intl.DateTimeFormat {
  try {
    return new Intl.DateTimeFormat(locale, {
      ...LOCALE_FIELDS[precision],
      timeZone: zone,
      timeZoneName: 'short',
    });
  } catch {
    throw new TypeError(`${caller}: ${JSON.stringify(locale)} is not a language tag.`);
  }
}

/** Two instants (`b` not before `a`) in the locale's own words: one label, or a range. */
function renderLocale(
  aMs: number,
  bMs: number,
  presentation: Presentation,
  zone: ZoneName,
  precision: Precision,
  caller: string,
): string {
  const formatter = localeFormatter(presentation.locale as string, zone, precision, caller);
  return aMs === bMs
    ? formatter.format(new Date(aMs))
    : formatter.formatRange(new Date(aMs), new Date(bMs));
}

function readInstant(value: unknown, caller: string): ParsedInstant {
  const instant = instantOf(value, 'lenient');
  if (instant === undefined) {
    throw new TypeError(
      `${caller}: ${JSON.stringify(value)} is not an ISO 8601 instant with a zone.`,
    );
  }
  return instant;
}

function spellPoint(point: Point, precision: Precision): string {
  const clock = spellClock(point.wall, precision);
  const date = spellDate(point.wall, precision);
  return clock === '' ? date : `${date} ${clock}`;
}

function zoneTag(zone: ZoneName, offset: string): string {
  return isUtcName(zone) ? zone : `${zone} (${offset})`;
}

function render(a: Point, b: Point, zone: ZoneName, precision: Precision): string {
  const left = spellPoint(a, precision);
  const right = spellPoint(b, precision);
  if (a.offset !== b.offset && !isUtcName(zone)) {
    return `${left} (${a.offset}) – ${right} (${b.offset}) ${zone}`;
  }
  const tag = zoneTag(zone, a.offset);
  if (left === right) return `${left} ${tag}`;
  const sameDate = spellDate(a.wall, precision) === spellDate(b.wall, precision);
  const clockA = spellClock(a.wall, precision);
  const clockB = spellClock(b.wall, precision);
  if (sameDate && clockA !== '' && clockB !== '') {
    return `${spellDate(a.wall, precision)} ${clockA}–${clockB} ${tag}`;
  }
  return `${left} – ${right} ${tag}`;
}

/**
 * One instant for a person: its wall time in the presentation zone, written
 * as finely as it needs (never coarser than minutes), and the zone named.
 */
export function presentInstant(value: InstantText, presentation: Presentation): string {
  const zone = assertZone(presentation, 'presentInstant');
  const instant = readInstant(value, 'presentInstant');
  const point = pointOf(instant, zone);
  if (presentation.locale !== undefined) {
    const precision = naturalPrecision(point.wall);
    return renderLocale(instant.ms, instant.ms, presentation, zone, precision, 'presentInstant');
  }
  return `${spellPoint(point, naturalPrecision(point.wall))} ${zoneTag(zone, point.offset)}`;
}

/**
 * Two INCLUSIVE ends — a declared period's `queried` or `held` — for a
 * person, each shown as declared (no end moved), in the presentation zone.
 * Accepts the lenient profile: a period a result declares.
 */
export function presentSpan(
  from: InstantText,
  to: InstantText,
  presentation: Presentation,
): string {
  const zone = assertZone(presentation, 'presentSpan');
  const fromInstant = readInstant(from, 'presentSpan');
  const toInstant = readInstant(to, 'presentSpan');
  const a = pointOf(fromInstant, zone);
  const b = pointOf(toInstant, zone);
  const precision = finer(naturalPrecision(a.wall), naturalPrecision(b.wall));
  if (presentation.locale !== undefined && fromInstant.ms <= toInstant.ms) {
    return renderLocale(fromInstant.ms, toInstant.ms, presentation, zone, precision, 'presentSpan');
  }
  return render(a, b, zone, precision);
}

/**
 * A presentation bound into the three renderers the coverage limits lines use
 * (`agent/coverage/period.ts` · `periodLine` for a `Period:` line, and
 * `periodCheckLine` for a result check's ranges). The coverage module is on every
 * agent's graph and this one loads only under `.time()`, so it is HANDED the
 * renderers (`agent/stages/prepareFinal.ts` loads this module through
 * `import()`) and never imports them — the optional-family law of docs-next's
 * site budget.
 */
export interface BoundPresentation {
  readonly span: (from: InstantText, to: InstantText) => string;
  readonly instant: (value: InstantText) => string;
  readonly range: (range: TimeRange, grain?: Grain) => string;
}

/** {@link presentSpan}, {@link presentInstant} and {@link presentRange}, bound to one presentation. */
export function bindPresentation(presentation: Presentation): BoundPresentation {
  return {
    span: (from, to) => presentSpan(from, to, presentation),
    instant: (value) => presentInstant(value, presentation),
    range: (range, grain) => presentRange(range, presentation, grain),
  };
}

/**
 * A half-open range for a person. With the `grain` the person said, the end
 * is the end AS SAID (§ 3.3): the last instant inside the range, written at
 * that grain — `[08:00, 08:41)` at `'minute'` shows `08:00–08:40`, and a
 * `'day'` range `[9 Oct, 10 Oct)` shows `2026-10-09`. Without a grain (an
 * exact range) both ends are shown as they are.
 */
export function presentRange(range: TimeRange, presentation: Presentation, grain?: Grain): string {
  const zone = assertZone(presentation, 'presentRange');
  const from = readInstant(range?.from, 'presentRange');
  const to = readInstant(range?.to, 'presentRange');
  if (from.ms > to.ms || (from.ms === to.ms && from.nanos >= to.nanos)) {
    throw new TypeError('presentRange: from must be before to.');
  }
  const a = pointOf(from, zone);
  if (grain === undefined) {
    const b = pointOf(to, zone);
    const precision = finer(naturalPrecision(a.wall), naturalPrecision(b.wall));
    if (presentation.locale !== undefined) {
      return renderLocale(from.ms, to.ms, presentation, zone, precision, 'presentRange');
    }
    return render(a, b, zone, precision);
  }
  const precision = PRECISION_OF[grain];
  if (precision === undefined) {
    throw new TypeError(`presentRange: ${JSON.stringify(grain)} is not a grain.`);
  }
  // The last instant inside the range: one millisecond (or the sub-millisecond
  // remainder) before `to`. Written at the grain, that is the end as said.
  const lastMs = to.nanos > 0 ? to.ms : to.ms - 1;
  if (presentation.locale !== undefined) {
    return renderLocale(from.ms, lastMs, presentation, zone, precision, 'presentRange');
  }
  const b = { wall: wallAt(zone, lastMs), offset: spellOffset(offsetAt(zone, lastMs)) };
  return render(a, b, zone, precision);
}
