/**
 * coverage/timeLimits.ts — the time layer's limits lines for ONE turn (step T8),
 * composed from the record and nothing else.
 *
 * Two readers ask it, so the person and the model are told the same thing:
 *
 * - the limits block (`stages/prepareFinal.ts`), which prints the lines under
 *   `Period` and `Clocks` for the PERSON after the answer;
 * - the served time line (`agent/arguments/serve.ts` · `timeLimitsSentence`),
 *   which hands the MODEL the same lines as the library's conclusion, late, at
 *   the decision point, before it writes the answer.
 *
 * What it reads: the facts `timeLimitFacts.ts` · `timeLimitFactsOf` reads —
 * the turn's `period` rows whose result checks hold, the turn's
 * `source-clock` rows (`core/time/checkRecord.ts` · `clocksDiffer`) and the
 * clock row's zone — rendered here (`period.ts` · `periodCheckLine`,
 * `clockLines`). `undefined` when there is no clock (nothing to render in) or
 * nothing to say.
 *
 * Loaded through `import()` only, under `.time()` (`stages/prepareFinal.ts`;
 * `arguments/serve.ts`, itself loaded under the arm): it renders through
 * `core/time/present.ts`, which a plain agent never loads.
 */

import { clockLines, periodCheckLine, type PeriodRow } from './period.js';
import { bindPresentation, type BoundPresentation } from '../../time/present.js';
import type { TimeLimitLines } from './answer.js';
import {
  timeLimitFactsOf,
  type TimeLimitFacts,
  type TimeLimitsAudience,
} from './timeLimitFacts.js';

export type { TimeLimitLines };

// LENS · late-line · request-ephemeral (and the person's limits block)
// reads: nothing — a fixed clause, added when the turn's clock zone is unknown (G15)
// law: names WHY the ranges are in UTC, so no reader takes UTC for the person's zone.
/** The clocks line under an unknown zone (G15): the ranges are in UTC because the person's zone is not known. */
export const UNKNOWN_ZONE_LINE = "times are shown in UTC — the person's time zone is not known";

// LENS · late-line · request-ephemeral
// reads: one `period` row's `held` (the declared `queried` and `held` spans its `not-held` /
//        `partly-held` verdict came from), rendered in the person's zone by the bound renderer
// law: the library's CONCLUSION for the MODEL: the time the source holds, already in the person's
//      zone, beside the time the call asked about — so no model converts a source's UTC instants
//      (take 3: "9:22 AM–5:02 PM Pacific" for a 16:22–17:02 UTC span).
/**
 * The model's line for a call whose source holds none or only part of the
 * time it asked about (`PeriodRow.held`): what the call asked about and what
 * its source holds, each AS DECLARED (inclusive ends, no end moved) and
 * rendered in the presentation zone by the time layer's one renderer — the
 * same spans the person's `Period:` line prints (`period.ts` · `periodLine`) — then
 * how much of the asked time that is. `undefined` when the row carries none.
 *
 * @example
 * ```ts
 * heldLine(row, bindPresentation({ zone: 'America/Los_Angeles' }));
 * // 'pscale_client_health asked about 2026-09-30 06:00:00–11:59:50 America/Los_Angeles (UTC-07:00);
 * //  its source holds 2026-10-01 09:22:44.300–10:02:44.300 America/Los_Angeles (UTC-07:00), which
 * //  covers none of that time'
 * ```
 */
export function heldLine(row: PeriodRow, presentation: BoundPresentation): string | undefined {
  const h = row.held;
  if (h === undefined) return undefined;
  const share =
    row.verdict === 'partly-held'
      ? 'which covers only part of that time'
      : 'which covers none of that time';
  return (
    `${row.toolName} asked about ${presentation.span(h.queried.from, h.queried.to)}; ` +
    `its source holds ${presentation.span(h.held.from, h.held.to)}, ${share}`
  );
}

/**
 * The turn's time limits lines, from the ledger — {@link renderTimeLimits}
 * over `timeLimitFacts.ts` · `timeLimitFactsOf`. `turn` undefined reads every
 * row (a ledger that carries one turn). `audience` `'model'` (the served time
 * line) names the person's window as theirs and keeps, of the clocks, only the
 * label that two differ.
 *
 * @example
 * ```ts
 * timeLimitLinesOf(ledger, 1);
 * // { period: ['client_activity read less than was asked — asked: …; read: …'], clocks: [] }
 * ```
 */
export function timeLimitLinesOf(
  ledger: readonly unknown[] | undefined,
  turn: number | undefined,
  audience: TimeLimitsAudience = 'person',
): TimeLimitLines | undefined {
  return renderTimeLimits(timeLimitFactsOf(ledger, turn, audience), audience);
}

/**
 * The limits lines for `audience`, rendered in the facts' zone by the time
 * layer's one renderer (`core/time/present.ts` · `bindPresentation`) —
 * `undefined` when there are no facts or nothing to say.
 */
export function renderTimeLimits(
  facts: TimeLimitFacts | undefined,
  audience: TimeLimitsAudience = 'person',
): TimeLimitLines | undefined {
  if (facts === undefined) return undefined;
  const presentation = bindPresentation({ zone: facts.zone });
  const period: string[] = [];
  const held: string[] = [];
  for (const row of facts.period) {
    const line = periodCheckLine(row, presentation, audience);
    if (line !== undefined) period.push(line);
    // The source's held span, for the model (the person's `Period:` line already prints it).
    const holds = audience === 'model' ? heldLine(row, presentation) : undefined;
    if (holds !== undefined) held.push(holds);
  }
  // The person reads every wall-clock source; the model only the label that two differ — one
  // declared clock is compared as instants and changes nothing the answer states.
  const clocks = [
    ...(audience === 'person'
      ? clockLines(facts.sources, facts.differ)
      : facts.differ === undefined
      ? []
      : clockLines([], facts.differ)),
    // The ranges above are spelled in UTC only because the person's zone is unknown (G15).
    ...(facts.zoneUnknown === true && period.length + held.length > 0 ? [UNKNOWN_ZONE_LINE] : []),
  ];
  if (period.length + clocks.length + held.length === 0) return undefined;
  return { period, clocks, ...(held.length > 0 && { held }) };
}
