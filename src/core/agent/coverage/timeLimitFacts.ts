/**
 * coverage/timeLimitFacts — WHAT the time layer's limits lines of one turn
 * say (step T8), read from the record and not yet rendered: the clock's zone,
 * the turn's `period` rows whose result checks hold, and the wall-clock
 * sources.
 *
 * Pattern: Walker over the committed ledger; pure, no rendering.
 * Role:    the record half of `timeLimits.ts`, split out BY FILE for the one
 *          synchronous door that needs it — the Tools mount's `inputMapper`
 *          (`agent/buildAgentChart.ts` · `timeLimitsArg`), which runs before
 *          any `import()` can: it hands these facts across, and the slot's
 *          served line renders them (`arguments/serve.ts` · `timeLimitsLine`,
 *          loaded under the arm). The renderer (`core/time/present.ts`) never
 *          reaches the graph `import { Agent }` loads (the optional-family
 *          law, `test/lib/trace-toolpack/browserGraph.test.ts`).
 * Emits:   N/A.
 *
 * `undefined` exactly when `timeLimits.ts` · `renderTimeLimits` would say
 * nothing for the same audience — so the mount arg stays value-conditional:
 * a turn whose reads match what was asked crosses no key.
 *
 * @example
 * ```ts
 * timeLimitFactsOf(ledger, 1, 'model');
 * // { zone: 'America/Los_Angeles', period: [{ kind: 'period', differs: { … }, … }], sources: [] }
 * ```
 */

import type { PeriodRow } from './period.js';
import { presentationZoneOf, sourceClocksOf } from '../../time/rows.js';
import {
  clocksDiffer,
  distinctSources,
  type ClocksDiffer,
  type SourceClock,
} from '../../time/checkRecord.js';
import type { ZoneName } from '../../time/zone.js';

/** Who reads the lines: the person (the limits block) or the model (the served time line). */
export type TimeLimitsAudience = 'person' | 'model';

/** The unrendered limits of one turn — see the file header. */
export interface TimeLimitFacts {
  /** The clock's zone — every range is rendered in it. */
  readonly zone: ZoneName;
  /** The turn's `period` rows that carry a check line, in the order filed. */
  readonly period: readonly PeriodRow[];
  /** The wall-clock sources, one per tool and zone (`checkRecord.ts` · `distinctSources`). */
  readonly sources: readonly SourceClock[];
  /** The label that two sources declare different zones (`checkRecord.ts` · `clocksDiffer`). */
  readonly differ?: ClocksDiffer;
}

/**
 * Whether a `period` row carries a limits line (`period.ts` · `periodCheckLine`
 * returns one exactly then): a read that differs, a shifted look-back, or a
 * window beyond retention.
 */
export function carriesCheckLine(row: PeriodRow): boolean {
  return row.differs !== undefined || row.shifted !== undefined || row.beyondRetention === true;
}

/**
 * The turn's limits facts from the ledger. `turn` undefined reads every row
 * (a ledger that carries one turn). `undefined` when there is no clock or,
 * for this `audience`, nothing to say: the person reads every wall-clock
 * source, the model only the label that two differ.
 */
export function timeLimitFactsOf(
  ledger: readonly unknown[] | undefined,
  turn: number | undefined,
  audience: TimeLimitsAudience = 'person',
): TimeLimitFacts | undefined {
  const zone = presentationZoneOf(ledger);
  if (zone === undefined || ledger === undefined) return undefined;
  const period: PeriodRow[] = [];
  for (const row of ledger) {
    const r = row as { readonly kind?: unknown; readonly turn?: unknown } | null;
    if (r === null || typeof r !== 'object' || r.kind !== 'period') continue;
    if (turn !== undefined && r.turn !== turn) continue;
    if (carriesCheckLine(row as PeriodRow)) period.push(row as PeriodRow);
  }
  const sources = distinctSources(sourceClocksOf(ledger, turn));
  const differ = clocksDiffer(sources);
  const clocks = audience === 'person' ? sources.length > 0 : differ !== undefined;
  if (period.length === 0 && !clocks) return undefined;
  return { zone, period, sources, ...(differ !== undefined && { differ }) };
}
