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
 * What it reads: the turn's `period` rows whose result checks hold
 * (`period.ts` · `periodCheckLine`), the turn's `source-clock` rows
 * (`core/time/check.ts` · `clocksDiffer`), and the clock row's zone
 * (`core/time/rows.ts` · `presentationZoneOf`). `undefined` when there is no
 * clock (nothing to render in) or nothing to say.
 */

import { clockLines, periodCheckLine, type PeriodRow } from './period.js';
import { presentationZoneOf, sourceClocksOf } from '../../time/rows.js';
import { clocksDiffer, distinctSources } from '../../time/check.js';
import type { TimeLimitLines } from './answer.js';

export type { TimeLimitLines };

/**
 * The turn's time limits lines, from the ledger. `turn` undefined reads every
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
  audience: 'person' | 'model' = 'person',
): TimeLimitLines | undefined {
  const zone = presentationZoneOf(ledger);
  if (zone === undefined || ledger === undefined) return undefined;
  const presentation = { zone };
  const period: string[] = [];
  for (const row of ledger) {
    const r = row as { readonly kind?: unknown; readonly turn?: unknown } | null;
    if (r === null || typeof r !== 'object' || r.kind !== 'period') continue;
    if (turn !== undefined && r.turn !== turn) continue;
    const line = periodCheckLine(row as PeriodRow, presentation, audience);
    if (line !== undefined) period.push(line);
  }
  const sources = distinctSources(sourceClocksOf(ledger, turn));
  const differ = clocksDiffer(sources);
  // The person reads every wall-clock source; the model only the label that two differ — one
  // declared clock is compared as instants and changes nothing the answer states.
  const clocks =
    audience === 'person'
      ? clockLines(sources, differ)
      : differ === undefined
      ? []
      : clockLines([], differ);
  return period.length + clocks.length === 0 ? undefined : { period, clocks };
}
