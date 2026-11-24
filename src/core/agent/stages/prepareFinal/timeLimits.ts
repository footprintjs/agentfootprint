import type { TypedScope } from 'footprintjs';
import type { TimeLimitLines } from '../../../../semantics/coverage/timeLimits.js';
import type { BoundPresentation } from '../../../../time/present.js';
import { presentationZoneOf } from '../../../../time/rows.js';
import type { AgentState } from '../../types.js';
import {
  comparisonCoverageForAnswer,
  comparisonPeriodAdmission,
} from '../../honesty/comparisonPeriods.js';

function nativeOf(scope: TypedScope<AgentState>) {
  return comparisonPeriodAdmission(() => [scope.settledToolCalls, scope.settledToolCallsComplete]);
}

/** Under the time arm, only native comparison declarations reach the answer. */
export function declaredInZone(scope: TypedScope<AgentState>) {
  return (
    comparisonCoverageForAnswer(scope.coverageDeclared, scope.findingsLedger, nativeOf(scope)) ?? []
  );
}

/** Load the presentation renderer only under the time arm. */
export async function presentationOf(
  scope: TypedScope<AgentState>,
): Promise<BoundPresentation | undefined> {
  const zone = presentationZoneOf(scope.findingsLedger);
  if (zone === undefined) return undefined;
  const { bindPresentation } = await import('../../../../time/present.js');
  return bindPresentation({ zone });
}

export async function timeLinesOf(
  scope: TypedScope<AgentState>,
): Promise<TimeLimitLines | undefined> {
  const { timeLimitLinesOf } = await import('../../../../semantics/coverage/timeLimits.js');
  return timeLimitLinesOf(scope.findingsLedger, scope.turnNumber, 'person', nativeOf(scope));
}
