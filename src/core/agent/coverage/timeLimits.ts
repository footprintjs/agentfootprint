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

import { clockLines, periodCheckLine } from './period.js';
import { bindPresentation } from '../../time/present.js';
import type { TimeLimitLines } from './answer.js';
import {
  timeLimitFactsOf,
  type TimeLimitFacts,
  type TimeLimitsAudience,
} from './timeLimitFacts.js';

export type { TimeLimitLines };

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
  for (const row of facts.period) {
    const line = periodCheckLine(row, presentation, audience);
    if (line !== undefined) period.push(line);
  }
  // The person reads every wall-clock source; the model only the label that two differ — one
  // declared clock is compared as instants and changes nothing the answer states.
  const clocks =
    audience === 'person'
      ? clockLines(facts.sources, facts.differ)
      : facts.differ === undefined
      ? []
      : clockLines([], facts.differ);
  return period.length + clocks.length === 0 ? undefined : { period, clocks };
}
