import { issuedTicketsOf } from '../../placedTickets.js';
import { retentionRefusalsOf } from '../../../../time/retentionRefusals.js';
import type { ArgumentRowRead } from '../argumentRows.js';
import { readConflicts } from '../conflicts.js';
import type { WarningContext } from '../gather/stage.js';
import { callPlacement } from '../gather/calls.js';
import { fire, type Gathered } from '../gathered.js';
import { PERIOD_REASONS, periodRows, readPeriodVerdicts } from '../periodRows.js';
import { historyPointer, statePointer } from '../pointer.js';
import { callIndexOf } from '../recordValues.js';
import type { deliveredResults } from '../resultDispositions.js';
import {
  readCallOutcomes,
  readCoverageRows,
  readTurnCalls,
  readTurnResults,
} from '../resultEvidence.js';
import { placeSettledResults, readSettledResults } from '../settledResults.js';
import type { standingAdmission } from '../standingAdmission.js';
import { recoveredCallOutcomes } from '../turnResults.js';
import type { AssessmentDeclarations } from '../types.js';
import { libraryResultReasons } from './library-did/stage.js';

/** File withholding and legacy period reasons before reading coverage. */
export function readInitialResults(
  admission: ReturnType<typeof standingAdmission>,
  periods: ReturnType<typeof deliveredResults>['periods'],
  g: Gathered,
): void {
  // An occurrence witness would reveal how many results the host withheld.
  if (admission.withheldReturn) g.fired.set('result-withheld', []);
  for (const { result, verdict } of admission.settlements === undefined ? periods : []) {
    const reason = PERIOD_REASONS[verdict];
    if (reason !== undefined) fire(g, reason, historyPointer(result));
  }
}

/** File library limits and coverage before the inputs fold reads contingent values. */
export function readResultsCoverage({
  state,
  coverage,
  reads,
  resultOpportunities,
  g,
}: WarningContext): void {
  for (const { reason, witness } of libraryResultReasons(state)) fire(g, reason, witness);
  readCoverageRows(coverage, g);
  readTurnCalls(reads, coverage, resultOpportunities, g);
}

/** Read outcomes, result shape, period verdicts, and conflicts in their recorded order. */
export function readResultEvidence(
  {
    state,
    recorded,
    admission,
    results,
    history,
    current,
    places,
    begins,
    coverage,
    reads,
    resultOpportunities,
    resolveCurrent,
    g,
  }: WarningContext,
  declarations: AssessmentDeclarations | undefined,
  enteredArguments: readonly ArgumentRowRead[],
  retainedHistory?: (history: readonly unknown[]) => unknown,
): void {
  if (admission.settlements === undefined) {
    readCallOutcomes(results, recoveredCallOutcomes(results, history, begins, retainedHistory), g);
  } else {
    const placed = placeSettledResults(admission.settlements, results, current);
    const recovered = recoveredCallOutcomes(
      placed.retained,
      history,
      begins,
      retainedHistory,
      (index) => placed.byIndex.get(index)?.execution === 'returned',
    );
    readSettledResults(admission.settlements, placed, coverage, recovered, PERIOD_REASONS, g);
  }
  readTurnResults(
    reads,
    declarations,
    issuedTicketsOf(recorded.placedTickets),
    resultOpportunities,
    g,
    admission.settlements === undefined,
  );
  readPeriodVerdicts(
    periodRows(state, (row) => callIndexOf(row, resolveCurrent), admission.nativeResult),
    enteredArguments,
    g,
  );
  if (Array.isArray(state.findingsLedger)) {
    const turn = typeof state.turnNumber === 'number' ? state.turnNumber : undefined;
    for (const { index } of retentionRefusalsOf(state.findingsLedger, turn)) {
      fire(g, 'period-beyond-retention', statePointer('findingsLedger', index, 'refused'));
    }
  }
  readConflicts(state, (ref) => callPlacement(ref, places), g, admission.legacyConflictCheck);
}
