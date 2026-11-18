import type { CallExecution, CallResultCell } from '../stages/toolCalls/contracts/callCells.js';
import type { SourceCaptureLanding } from './capture.js';

/** Final native execution facts, after policy, placement and the truncation net. */
export function sourceLanding(
  execution: Pick<CallExecution, 'executed' | 'denied' | 'ceilingRefused'>,
  outcome: Pick<CallResultCell, 'error' | 'toolStatus'>,
  uncapped: boolean,
): SourceCaptureLanding {
  return {
    eligible:
      execution.executed &&
      !outcome.error &&
      !execution.denied &&
      !execution.ceilingRefused &&
      uncapped,
    ...(outcome.toolStatus !== undefined && { status: outcome.toolStatus }),
  };
}
