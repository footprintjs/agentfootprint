import type { TypedScope } from 'footprintjs';
import type { AgentTurnEndPayload } from '../../../../events/payloads.js';
import type { AgentState } from '../../types.js';

export type StandingLineEvidence = Pick<
  AgentTurnEndPayload,
  'standingLineNames' | 'standingLineOmittedByRaiseOn'
>;

/** Read the display decision made by the assessment stage. */
export function finalStandingOf(
  scope: TypedScope<AgentState>,
  armed: boolean,
): { readonly line: string; readonly standing: StandingLineEvidence } {
  if (!armed) return { line: '', standing: {} };
  if (
    'answerStandingLineOmittedByRaiseOn' in scope &&
    scope.answerStandingLineOmittedByRaiseOn === true
  ) {
    return { line: '', standing: { standingLineOmittedByRaiseOn: true } };
  }
  const line = scope.answerStandingLine ?? '';
  // Keep the app's words on turn_end only when the composer named calls.
  const names = scope.answerStandingNames;
  return { line, standing: names === undefined ? {} : { standingLineNames: { ...names } } };
}
