/**
 * core/time/clock — the run clock: a declared, recorded input, never a hidden read.
 *
 * Pattern: normalize-or-refuse at a boundary (`core/runInput.ts`'s shape): the
 *          app's `.time({ zone })` and the run's `time: { now, zone, window }`
 *          are read here into one {@link TimeClock}, or refused by name.
 * Role:    core/ leaf (the time layer's one owner). Imports `instant.ts`,
 *          `zone.ts` and `range.ts` only. The Agent reads the two inputs
 *          (`Agent.run`, `Agent.resume`); seed stamps the clock once per turn
 *          (`rows.ts` · `ClockRow`); the ToolCalls resume door compares a
 *          resume's `time` with the kept clock ({@link clockChange}).
 * Emits:   N/A.
 *
 * ## The laws (time design § 4)
 *
 * - **The zone is per run; the builder's is a fallback.** The run's
 *   `time.zone` wins, `.time({ zone })` is used when the run names none, and
 *   with neither the run is REFUSED before the turn starts — never the
 *   server's zone ({@link draftClock} answers `'no-zone'`).
 * - **`now` is the app's, else the turn's start** — admitted as
 *   `nowSource: 'default'`, like any default nobody chose.
 * - **Frozen across a pause.** The clock is written once per turn. A resume
 *   that passes a different `time` keeps the frozen clock and records what was
 *   passed ({@link clockChange}); it is not refused, because an app that
 *   passes the current time on every call is doing nothing wrong.
 * - **A window set in a UI is a run input** (`time.window`), recorded with
 *   `source: 'control'` — the person's own typed value, never filed as an
 *   answer to an ask.
 *
 * @example
 * ```ts
 * const run = readRunTime({ now: '2026-10-09T15:40:00Z', zone: 'America/Los_Angeles' });
 * const draft = draftClock(run.value, readTimeOptions({}).value!);
 * // { now: '2026-10-09T15:40:00Z', zone: 'America/Los_Angeles', zoneSource: 'run' }
 * completeClock(draft as ClockDraft, Date.parse('2026-10-09T15:40:02Z'));
 * // { now: '2026-10-09T15:40:00Z', nowSource: 'app', zone: 'America/Los_Angeles', zoneSource: 'run' }
 * ```
 */

import { instantOf, type InstantText } from './instant.js';
import { isTimeRange, type TimeRange } from './range.js';
import { isZoneName, type ZoneName } from './zone.js';

// ─── The shapes ─────────────────────────────────────────────────────────

/** The run's clock, stamped once per turn (time design § 4). */
export interface TimeClock {
  /** The anchor for this turn — the app's `now`, else the turn's start. */
  readonly now: InstantText;
  /** The app passed `now`, or the library took the turn's start. */
  readonly nowSource: 'app' | 'default';
  /** The person's zone for this run — an IANA name. */
  readonly zone: ZoneName;
  /** The run's `time.zone`, else the `.time({ zone })` fallback. */
  readonly zoneSource: 'run' | 'builder';
}

/**
 * The run's time input — `agent.run({ message, time })`, or the options bag of
 * `run`, `followUp`, `resume` and `resumeOnError`. Every key is optional; a
 * run with no zone here needs the builder's fallback.
 *
 * @example
 * ```ts
 * await agent.run({ message: 'errors since 8?', time: { now: sentAt, zone: 'America/Los_Angeles' } });
 * ```
 */
export interface RunTime {
  /**
   * The turn's anchor — the MESSAGE's time, so a replay or a late resume
   * reads "yesterday" the same way. An ISO 8601 instant with a zone (upper
   * case `T` and `Z`, no leap second), or a `Date`. Omitted: the turn's start,
   * recorded `nowSource: 'default'`.
   */
  readonly now?: string | Date;
  /** The person's IANA zone for this run (`'America/Los_Angeles'`). Never an abbreviation. */
  readonly zone?: string;
  /**
   * A window set in a UI — a brushed chart range, a range picker — as a
   * half-open `{ from, to }` of instants. Recorded with `source: 'control'`.
   */
  readonly window?: TimeRange;
}

/** The builder's `.time(options)` — T3's one switch; the reader and its policy arrive with later steps. */
export interface TimeOptions {
  /** The fallback zone for a run that names none. Omitted: every run must name its own. */
  readonly zone?: string;
}

/** {@link RunTime} as read: every value checked and kept as written, a `Date` spelled in UTC. */
export interface ReadRunTime {
  readonly now?: InstantText;
  readonly zone?: ZoneName;
  readonly window?: TimeRange;
}

/** {@link TimeOptions} as read. */
export interface ReadTimeOptions {
  readonly zone?: ZoneName;
}

/** What a turn's clock is before seed knows the turn's start. */
export interface ClockDraft {
  readonly now?: InstantText;
  readonly zone: ZoneName;
  readonly zoneSource: 'run' | 'builder';
  readonly window?: TimeRange;
}

/** A read answer: the value, or a problem named in words. */
export type Read<T> = { readonly value: T } | { readonly problem: string };

// ─── Reading the two inputs ──────────────────────────────────────────────

const RUN_KEYS: readonly string[] = ['now', 'zone', 'window'];
const OPTION_KEYS: readonly string[] = ['zone'];

function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return false;
  const proto = Object.getPrototypeOf(value) as unknown;
  return proto === Object.prototype || proto === null;
}

function unknownKeys(value: Record<string, unknown>, allowed: readonly string[]): string[] {
  return Object.keys(value).filter((k) => !allowed.includes(k));
}

/**
 * A zone as the app WROTE it, once `zone.ts` · `isZoneName` accepts it — never
 * `Intl`'s canonical form, which can be an older link the person did not name
 * (`Asia/Kolkata` resolves to `Asia/Calcutta` on some runtimes). The record
 * keeps spellings, as it keeps a passed `now`.
 */
function readZone(value: unknown): Read<ZoneName> {
  if (isZoneName(value)) return { value };
  return {
    problem:
      `zone must be an IANA zone name such as 'America/Los_Angeles' or 'UTC' — ` +
      `an abbreviation (PST) or a bare offset (+05:30) names no zone`,
  };
}

function readNow(value: unknown): Read<InstantText> {
  if (value instanceof Date) {
    const ms = value.getTime();
    // A Date's year can leave 0000–9999, which no instant spelling carries.
    if (!Number.isFinite(ms) || instantOf(new Date(ms).toISOString(), 'strict') === undefined) {
      return { problem: 'now is an invalid Date' };
    }
    return { value: new Date(ms).toISOString() };
  }
  if (instantOf(value, 'strict') !== undefined) return { value: value as InstantText };
  return {
    problem:
      `now must be an ISO 8601 instant with a zone (e.g. '2026-10-09T15:40:00Z' or ` +
      `'2026-10-09T08:40:00-07:00') or a Date`,
  };
}

/**
 * The run's `time` input, checked. `undefined` reads as "nothing passed".
 * Refused, by name: a non-object, an unknown key, a zone that is not an IANA
 * name, a `now` that is not an instant with a zone, a `window` that is not two
 * strict instants with `from` before `to`.
 */
export function readRunTime(value: unknown): Read<ReadRunTime | undefined> {
  if (value === undefined) return { value: undefined };
  if (!isPlainObject(value))
    return { problem: 'time must be an object — { now?, zone?, window? }' };
  const extra = unknownKeys(value, RUN_KEYS);
  if (extra.length > 0) {
    return {
      problem: `time takes { now?, zone?, window? } only — unknown key ${extra
        .map((k) => `'${k}'`)
        .join(', ')}`,
    };
  }
  let now: InstantText | undefined;
  let zone: ZoneName | undefined;
  if (value.now !== undefined) {
    const read = readNow(value.now);
    if ('problem' in read) return read;
    now = read.value;
  }
  if (value.zone !== undefined) {
    const read = readZone(value.zone);
    if ('problem' in read) return { problem: `time.${read.problem}` };
    zone = read.value;
  }
  if (value.window !== undefined && !isTimeRange(value.window)) {
    return {
      problem:
        'time.window must be { from, to } — two ISO 8601 instants with a zone, from before to',
    };
  }
  const window = value.window as TimeRange | undefined;
  return {
    value: {
      ...(now !== undefined && { now }),
      ...(zone !== undefined && { zone }),
      ...(window !== undefined && { window: { from: window.from, to: window.to } }),
    },
  };
}

/**
 * The builder's `.time(options)`, checked. `undefined` reads as `{}` — the
 * layer armed with no fallback zone, so every run names its own.
 */
export function readTimeOptions(value: unknown): Read<ReadTimeOptions> {
  if (value === undefined) return { value: {} };
  if (!isPlainObject(value)) return { problem: 'options must be an object — { zone? }' };
  const extra = unknownKeys(value, OPTION_KEYS);
  if (extra.length > 0) {
    return {
      problem: `options take { zone? } only in this release — unknown key ${extra
        .map((k) => `'${k}'`)
        .join(', ')}`,
    };
  }
  if (value.zone === undefined) return { value: {} };
  const read = readZone(value.zone);
  return 'problem' in read ? read : { value: { zone: read.value } };
}

// ─── The clock ───────────────────────────────────────────────────────────

/**
 * The turn's clock as far as the run's inputs decide it — or `'no-zone'`
 * when neither the run nor the builder names a zone (the run is then refused;
 * never the server's zone).
 */
export function draftClock(
  run: ReadRunTime | undefined,
  options: ReadTimeOptions,
): ClockDraft | 'no-zone' {
  const zone = run?.zone ?? options.zone;
  if (zone === undefined) return 'no-zone';
  return {
    ...(run?.now !== undefined && { now: run.now }),
    zone,
    zoneSource: run?.zone !== undefined ? 'run' : 'builder',
    ...(run?.window !== undefined && { window: run.window }),
  };
}

/** The clock, once the turn's start is known: `now` is the app's, else that start. */
export function completeClock(draft: ClockDraft, turnStartMs: number): TimeClock {
  // Fixed width (`toISOString`, milliseconds always written) — the spelling
  // `rows.ts` · `callRow` gives `dispatchedAt`, so the two wall-clock reads
  // compare as text too.
  const now = draft.now ?? new Date(turnStartMs).toISOString();
  return {
    now,
    nowSource: draft.now !== undefined ? 'app' : 'default',
    zone: draft.zone,
    zoneSource: draft.zoneSource,
  };
}

/** What a resume passed that differs from the kept clock, and the kept values it would have replaced. */
export interface ClockChange {
  readonly passed: ReadRunTime;
  readonly kept: {
    readonly now: InstantText;
    readonly zone: ZoneName;
    readonly window?: TimeRange;
  };
}

/**
 * The difference between a resume's `time` and the turn's frozen clock, or
 * `undefined` when every value passed equals the kept one (a key not passed
 * is no difference). `now` compares as text: a resume passing the same
 * instant in another spelling is recorded, because the record keeps spellings.
 *
 * @example
 * ```ts
 * clockChange({ now: '2026-10-09T16:10:00Z' }, { now: '2026-10-09T15:40:00Z', zone: 'UTC' });
 * // { passed: { now: '2026-10-09T16:10:00Z' }, kept: { now: '2026-10-09T15:40:00Z', zone: 'UTC' } }
 * ```
 */
export function clockChange(
  passed: ReadRunTime,
  kept: { readonly now: InstantText; readonly zone: ZoneName; readonly window?: TimeRange },
): ClockChange | undefined {
  const nowDiffers = passed.now !== undefined && passed.now !== kept.now;
  const zoneDiffers = passed.zone !== undefined && passed.zone !== kept.zone;
  const windowDiffers =
    passed.window !== undefined &&
    (kept.window === undefined ||
      passed.window.from !== kept.window.from ||
      passed.window.to !== kept.window.to);
  if (!nowDiffers && !zoneDiffers && !windowDiffers) return undefined;
  return {
    passed,
    kept: {
      now: kept.now,
      zone: kept.zone,
      ...(kept.window !== undefined && { window: kept.window }),
    },
  };
}
