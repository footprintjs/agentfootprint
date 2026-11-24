/**
 * coverage/timeLimitFacts — WHAT the time layer's limits lines of one turn
 * say (step T8), read from the record and not yet rendered: the clock's zone,
 * the turn's `period` rows whose result checks hold, and the wall-clock
 * sources.
 *
 * Pattern: Walker over the committed ledger; pure, no rendering.
 * Role:    the record half of `timeLimits.ts`, split out BY FILE for the one
 *          synchronous door that needs it — the Tools mount's `inputMapper`
 *          (`agent/honesty/timeLimitsInput.ts`), which runs before
 *          any `import()` can: it hands these facts across, and the slot's
 *          served line renders them (`arguments/serve/clock.ts` · `timeLimitsLine`,
 *          loaded under the arm). The renderer (`time/present.ts`) never
 *          reaches the graph `import { Agent }` loads (the optional-family
 *          law, `test/trace-toolpack/browserGraph.test.ts`).
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
import { clockOf, presentationZoneOf, sourceClocksOf } from '../../time/rows.js';
import {
  clocksDiffer,
  distinctSources,
  type ClocksDiffer,
  type SourceClock,
} from '../../time/checkRecord.js';
import type { ZoneName } from '../../time/zone.js';
import { retentionRefusalsOf } from '../../time/retentionRefusals.js';

/** Who reads the lines: the person (the limits block) or the model (the served time line). */
export type TimeLimitsAudience = 'person' | 'model';

/** The unrendered limits of one turn — see the file header. */
export interface TimeLimitFacts {
  /** The clock's zone — every range is rendered in it. */
  readonly zone: ZoneName;
  /** The turn's `period` rows that carry a check line, in the order filed. */
  readonly period: readonly PeriodRow[];
  /** One generic line suffices when a native comparison result could not be established. */
  readonly unprovedComparison?: true;
  readonly retentionRefusals?: readonly string[];
  /** The wall-clock sources, one per tool and zone (`checkRecord.ts` · `distinctSources`). */
  readonly sources: readonly SourceClock[];
  /** The label that two sources declare different zones (`checkRecord.ts` · `clocksDiffer`). */
  readonly differ?: ClocksDiffer;
  /** The clock's zone is unknown (G15): `zone` is only the UTC spelling, and the lines say so. */
  readonly zoneUnknown?: true;
}

/**
 * Whether a `period` row carries a limits line for `audience`: a read that
 * differs, a shifted look-back, or a window beyond retention (`period.ts` ·
 * `periodCheckLine` returns one exactly then) — and, for the MODEL only, a
 * source that holds none or only part of the asked time (`held`, rendered by
 * `timeLimits.ts` · `heldLine`). The person's limits block already prints that
 * span on the call's `Period:` line (`period.ts` · `periodLine`), in their
 * zone, so it gets no second line.
 */
export function carriesCheckLine(row: PeriodRow, audience: TimeLimitsAudience = 'person'): boolean {
  return (
    row.differs !== undefined ||
    row.shifted !== undefined ||
    row.beyondRetention === true ||
    (row.comparison === true && (row.verdict === 'unknown' || row.verdict === 'undeclared')) ||
    (audience === 'model' && row.held !== undefined)
  );
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
  nativeComparison?: (row: object) => boolean,
): TimeLimitFacts | undefined {
  const zone = presentationZoneOf(ledger);
  if (zone === undefined || ledger === undefined) return undefined;
  const zoneUnknown = clockOf(ledger)?.zoneSource === 'unknown';
  const retentionRefusals = retentionRefusalsOf(ledger, turn).map(({ toolName }) => toolName);
  const period: PeriodRow[] = [];
  let unprovedComparison = false;
  for (const row of ledger) {
    const r = row as {
      readonly kind?: unknown;
      readonly turn?: unknown;
      readonly comparison?: unknown;
    } | null;
    if (r === null || typeof r !== 'object') continue;
    if (turn !== undefined && r.turn !== turn) continue;
    if (r.kind === 'call-window' && r.comparison !== undefined && nativeComparison?.(r) !== true)
      unprovedComparison = true;
    if (r.kind !== 'period') continue;
    const entry = row as PeriodRow;
    if (entry.comparison === true && nativeComparison?.(entry) !== true) {
      unprovedComparison = true;
      continue;
    }
    if (carriesCheckLine(entry, audience)) period.push(entry);
  }
  const sources = distinctSources(sourceClocksOf(ledger, turn));
  const differ = clocksDiffer(sources);
  const clocks = audience === 'person' ? sources.length > 0 : differ !== undefined;
  if (period.length === 0 && !unprovedComparison && retentionRefusals.length === 0 && !clocks)
    return undefined;
  return {
    zone,
    period,
    ...(unprovedComparison && { unprovedComparison: true as const }),
    ...(retentionRefusals.length > 0 && { retentionRefusals }),
    sources,
    ...(differ !== undefined && { differ }),
    ...(zoneUnknown && { zoneUnknown: true as const }),
  };
}
