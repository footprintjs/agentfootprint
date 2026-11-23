import type { HistoryCall, historyCallResolver } from '../recordedCalls.js';
import type { ArgumentRowRead } from './argumentRows.js';
import type { CoverageRow } from './coverageRows.js';
import type { Gathered } from './gathered.js';
import type { CallPlaces } from './recordValues.js';
import type { deliveredResults } from './resultDispositions.js';
import type { ResultRead } from './resultEvidence.js';
import type { standingAdmission } from './standingAdmission.js';
import type { TurnResult } from './turnResults.js';
import type { AnswerAssessment } from './types.js';

/** Recorded inputs and the accumulator shared by the ordered warning steps. */
export interface PreparedWarning {
  readonly state: Readonly<Record<string, unknown>>;
  readonly recorded: Readonly<Record<string, unknown>>;
  readonly admission: ReturnType<typeof standingAdmission>;
  readonly g: Gathered;
  readonly results: readonly TurnResult[];
  readonly periods: ReturnType<typeof deliveredResults>['periods'];
  readonly history: readonly unknown[];
  readonly current: readonly HistoryCall[];
  readonly historyCalls: readonly HistoryCall[];
  readonly from: AnswerAssessment['turnFrom'];
  readonly begins: number;
  readonly asked: ReadonlySet<string>;
  readonly resolveCurrent: ReturnType<typeof historyCallResolver>;
  readonly argumentVerdicts: readonly ArgumentRowRead[];
}

export interface WarningContext extends PreparedWarning {
  readonly places: CallPlaces;
  readonly coverage: readonly CoverageRow[];
  readonly reads: readonly ResultRead[];
  readonly resultOpportunities: number;
}
