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
import { HIDDEN_VALUE } from '../arguments/rows.js';
import type { FindingsLedger } from '../findings/types.js';
import { isWindowFillRow, type TimeLineage } from './route.js';

// FOLD · the one owner of this turn's time spellings by lineage, as the evidence gate reads them
// consumers read this and never re-derive it: judgeEvidence (the exempt corpus's `timeSaid`, checkAnswer's `derived`)
// detached: yes — fresh arrays per call, read from the committed ledger and the served time line.
/**
 * This turn's time spellings, split by lineage (time design § 9.5, step T7):
 * per recorded window (`core/time/forms.ts` · `turnFormsWindowsOf`), the
 * spellings `timeFormsOf` files as the person's and as the library's; plus,
 * as the library's, every value it filled from a window into a call
 * (`isWindowFillRow`) and the served time line (`timeLine` — library text,
 * never evidence, so an answer that echoes it is not the person's).
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
  const turn = scope.turnNumber as number;
  for (const row of ledger) {
    if (row.kind !== 'argument' || row.turn !== turn || !isWindowFillRow(row, ledger)) continue;
    if (row.value !== undefined && row.value !== HIDDEN_VALUE) derived.push(row.value);
  }
  const line = scope.timeLine as { readonly text: string } | undefined;
  if (line !== undefined) derived.push(line.text);
  return { said, derived };
};
