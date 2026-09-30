/**
 * core/time/checkRecord — the record half of the result checks (time design
 * § 9.2, § 9.6, step T8): the shapes a `period` row carries
 * (`PeriodDiffers`, `ReadSource`), the checkpoint door's tests for them
 * (`isPeriodDiffers`, `isShifted`), and the two reads over the turn's
 * wall-clock sources (`distinctSources`, `clocksDiffer`).
 *
 * Pattern: pure shapes and guards; no conversion, no drift, no clock.
 * Role:    split from `check.ts` BY FILE for the synchronous doors — the
 *          checkpoint door's row test (`coverage/period.ts` ·
 *          `periodRowIsWellFormed`) is on every agent's graph, and a bundler
 *          places a whole file there — so this file imports only
 *          `instant.ts` and the range and zone types (the optional-family
 *          law, `test/lib/trace-toolpack/browserGraph.test.ts`). `check.ts`
 *          re-exports every public name.
 * Emits:   N/A.
 *
 * @example
 * ```ts
 * clocksDiffer([
 *   { toolName: 'orders', zone: 'America/New_York' },
 *   { toolName: 'tickets', zone: 'Europe/Berlin' },
 * ]); // { tools: ['orders', 'tickets'], zones: ['America/New_York', 'Europe/Berlin'] }
 * ```
 */

import { instantOf } from './instant.js';
import type { TimeRange } from './range.js';
import type { ZoneName } from './zone.js';

// ─── The shapes ──────────────────────────────────────────────────────────

/** Where a check's read range came from — see the module table. */
export type ReadSource = 'declared' | 'sent' | 'shifted' | 'asked';

/**
 * `period-differs-from-asked` (§ 9.2): the range compared against, what was
 * read, and the two lists — each piece half-open, in time order, spelled in
 * UTC. At least one list is non-empty (an empty check is not filed).
 */
export interface PeriodDiffers {
  /** `asked` — the call's asked range; `person` — the person's window, for a window the model chose. */
  readonly against: 'asked' | 'person';
  /** The range compared against. */
  readonly asked: TimeRange;
  /** What the call read — one range per declared period, else one. */
  readonly read: readonly TimeRange[];
  readonly source: ReadSource;
  /** The step a declared inclusive end was read back with (§ 3.3) — `source: 'declared'` only. */
  readonly stepMs?: number;
  /** Asked but not read. */
  readonly missing: readonly TimeRange[];
  /** Read but not asked. */
  readonly extra: readonly TimeRange[];
}

/** A dataset of one call whose declared time axis names a zone — a wall-clock source. */
export interface SourceClock {
  readonly toolName: string;
  readonly zone: ZoneName;
}

/** `clocks-differ` (§ 9.6): the wall-clock sources of one answer, when they declare different zones. */
export interface ClocksDiffer {
  readonly tools: readonly string[];
  readonly zones: readonly ZoneName[];
}

// ─── Clocks ──────────────────────────────────────────────────────────────

/**
 * The wall-clock sources of one answer, one per tool and zone in the order
 * met — the limits block names each. Fresh plain objects.
 */
export function distinctSources(sources: readonly SourceClock[]): SourceClock[] {
  const seen = new Set<string>();
  const out: SourceClock[] = [];
  for (const s of sources) {
    const key = JSON.stringify([s.toolName, s.zone]);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ toolName: s.toolName, zone: s.zone });
  }
  return out;
}

/**
 * `clocks-differ` (§ 9.6) — the tools and zones when the wall-clock sources
 * of one answer declare more than one zone; `undefined` otherwise. A label
 * only: it changes no standing, and every comparison is made on instants.
 */
export function clocksDiffer(sources: readonly SourceClock[]): ClocksDiffer | undefined {
  const distinct = distinctSources(sources);
  const zones = [...new Set(distinct.map((s) => s.zone))];
  if (zones.length < 2) return undefined;
  return { tools: [...new Set(distinct.map((s) => s.toolName))], zones };
}

// ─── The row arm ─────────────────────────────────────────────────────────

const isRange = (value: unknown): value is TimeRange => {
  if (typeof value !== 'object' || value === null) return false;
  const r = value as Record<string, unknown>;
  const from = instantOf(r.from, 'lenient')?.ms;
  const to = instantOf(r.to, 'lenient')?.ms;
  return from !== undefined && to !== undefined && from < to;
};
const isRanges = (value: unknown): boolean => Array.isArray(value) && value.every(isRange);

/** The checkpoint door's test for a row's {@link PeriodDiffers}. */
export function isPeriodDiffers(value: unknown): value is PeriodDiffers {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;
  const d = value as Record<string, unknown>;
  return (
    (d.against === 'asked' || d.against === 'person') &&
    isRange(d.asked) &&
    isRanges(d.read) &&
    (d.read as unknown[]).length > 0 &&
    (d.source === 'declared' ||
      d.source === 'sent' ||
      d.source === 'shifted' ||
      d.source === 'asked') &&
    (d.stepMs === undefined || (Number.isInteger(d.stepMs) && (d.stepMs as number) > 0)) &&
    isRanges(d.missing) &&
    isRanges(d.extra) &&
    (d.missing as unknown[]).length + (d.extra as unknown[]).length > 0
  );
}

/** The checkpoint door's test for a row's `shifted`. */
export function isShifted(value: unknown): boolean {
  return (
    typeof value === 'object' &&
    value !== null &&
    Number.isInteger((value as Record<string, unknown>).byMs)
  );
}
