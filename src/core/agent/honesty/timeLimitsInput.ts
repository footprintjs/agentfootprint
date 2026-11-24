import {
  timeLimitFactsOf,
  type TimeLimitFacts,
} from '../../../semantics/coverage/timeLimitFacts.js';
import { clockOf } from '../../../time/rows.js';
import { comparisonPeriodAdmission } from './comparisonPeriods.js';

/** The Tools mount hands facts to the optional served time-line renderer. */
export function timeLimitsArg(parent: Readonly<Record<string, unknown>>): {
  timeLimits?: TimeLimitFacts;
} {
  const rows = parent.findingsLedger as readonly unknown[] | undefined;
  const native = comparisonPeriodAdmission(() => [
    parent.settledToolCalls,
    parent.settledToolCallsComplete,
  ]);
  const facts = timeLimitFactsOf(rows, clockOf(rows)?.turn, 'model', native);
  return facts === undefined ? {} : { timeLimits: facts };
}
