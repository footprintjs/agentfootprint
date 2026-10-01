/**
 * stages/timeLineage — this turn's time spellings by lineage, as the evidence
 * gate reads them (time design § 9.5, step T7), in a module a plain agent
 * never loads.
 *
 * Pattern: Walker over the committed ledger — the turn's recorded windows
 *          (`core/time/forms.ts` · `turnFormsWindowsOf`), the values the
 *          library filled from a window (`./route.ts` · `isWindowFillRow`) and
 *          the served time line.
 * Role:    the Route decider loads it through `import()` under `.time()` only
 *          (`./route.ts` · `loadTimeLineage`): `forms.ts` re-resolves a
 *          confirmed reading (`resolve.ts`), so it stays off the graph
 *          `import { Agent }` loads (the optional-family law,
 *          `test/lib/trace-toolpack/browserGraph.test.ts`).
 * Emits:   N/A.
 *
 * @example
 * ```ts
 * const { said, derived } = timeLineageOf(scope); // said → the exempt corpus; derived → a time-derived row
 * ```
 */

import { timeFormsOf, turnFormsWindowsOf } from '../../time/forms.js';
import { clockOf, presentationZoneOf } from '../../time/rows.js';
import type { PeriodRow } from '../coverage/period.js';
import { HIDDEN_VALUE } from '../arguments/rows.js';
import type { FindingsLedger } from '../findings/types.js';
import { isWindowFillRow, type TimeLineage } from './route.js';

// FOLD · the one owner of this turn's time spellings by lineage, as the evidence gate reads them
// consumers read this and never re-derive it: judgeEvidence (the exempt corpus's `timeSaid`, checkAnswer's `derived`)
// detached: yes — fresh arrays per call, read from the committed ledger and the served time line.
/**
 * This turn's time spellings, split by lineage (time design § 9.5, step T7):
 * per recorded window and offered proposal (`core/time/forms.ts` ·
 * `turnFormsWindowsOf`), the spellings `timeFormsOf` files as the person's and
 * as the library's; the turn's clock at the grain it is served (G16); plus,
 * as the library's, every value it filled from a window into a call
 * (`isWindowFillRow`), the held span of a source that holds none or only part
 * of the asked time (a `period` row's `held`, spelled in the person's zone as
 * the served line names it) and the served time line (`timeLine` — library
 * text, never evidence, so an answer that echoes it is not the person's).
 */
export const timeLineageOf: TimeLineage = (scope) => {
  const ledger = [...((scope.findingsLedger as FindingsLedger | undefined) ?? [])];
  const said: string[] = [];
  const derived: string[] = [];
  for (const window of turnFormsWindowsOf(ledger)) {
    const forms = timeFormsOf({ window });
    said.push(...forms.said);
    derived.push(...forms.derived);
  }
  // The turn's clock, as served on every request (G16) — the library's value, never the person's.
  const clock = clockOf(ledger);
  if (clock !== undefined) derived.push(...timeFormsOf({ clock }).derived);
  const turn = scope.turnNumber as number;
  for (const row of ledger) {
    if (row.kind !== 'argument' || row.turn !== turn || !isWindowFillRow(row, ledger)) continue;
    if (row.value !== undefined && row.value !== HIDDEN_VALUE) derived.push(row.value);
  }
  // A source's held span, as the served time line names it in the person's zone
  // (`coverage/timeLimits.ts` · `heldLine`) — the library converted the tool's instants (take 3).
  const zone = presentationZoneOf(ledger);
  if (zone !== undefined) {
    for (const row of ledger) {
      if (row.kind !== 'period' || row.turn !== turn) continue;
      const held = (row as PeriodRow).held?.held;
      if (held !== undefined) derived.push(...timeFormsOf({ held: { ...held, zone } }).derived);
    }
  }
  const line = scope.timeLine as { readonly text: string } | undefined;
  if (line !== undefined) derived.push(line.text);
  return { said, derived };
};
