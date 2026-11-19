import type { LLMMessage } from '../../../../../provider-contract/types.js';
import {
  callOutcomeOf,
  reportedStatusOf,
  type DispatchSettlement,
} from '../../../../../semantics/toolOutcome.js';

/** The field to spread onto a committed tool message: `{ outcome }`, or nothing for a completed call. */
export function outcomeField(call: DispatchSettlement): Pick<LLMMessage, 'outcome'> {
  const outcome = callOutcomeOf(call);
  return outcome === undefined ? {} : { outcome };
}

/** Keep the admitted reported status only when the tool ran. */
export function reportedStatusField(call: DispatchSettlement): Pick<LLMMessage, 'reportedStatus'> {
  const reportedStatus = call.ran ? reportedStatusOf(call.status) : undefined;
  return reportedStatus === undefined ? {} : { reportedStatus };
}
