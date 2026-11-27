import type { TypedScope } from 'footprintjs';
import { readCallOccurrenceKey } from '../../../../lib/callOccurrence.js';
import { typedEmit } from '../../../../recorders/core/typedEmit.js';
import { sameRange } from '../../../../time/range.js';
import { callWindowOfCall } from '../../../../time/rows.js';
import { canDiscloseProvenWindow, provenWindowLine } from '../../honesty/provenWindowVisibility.js';
import { activeTimeReadings } from '../../honesty/timeInputs.js';
import type { FindingsLedger } from '../../findings/types.js';
import type { AgentState } from '../../types.js';

/** State the admitted window as the library's own fact, using the run's native serving rule. */
export function capturedAnswerOf(
  scope: TypedScope<AgentState>,
  answer: string,
  stateProvenWindow: boolean,
): string {
  if (!stateProvenWindow) return answer;
  const row = activeTimeReadings(scope, stateProvenWindow)[0];
  if (row?.choice?.by !== 'only' || row.qualifiedLookback === undefined) return answer;
  const window = row.candidates?.[row.choice.candidate];
  if (window?.endpoint?.end !== 'exclusive') return answer;
  const ledger = scope.findingsLedger as FindingsLedger | undefined;
  for (const call of ledger ?? []) {
    if (call.kind !== 'call' || call.turn !== row.turn) continue;
    const key = readCallOccurrenceKey(call);
    if (key === null) continue;
    const plan = callWindowOfCall(
      ledger,
      call.toolCallId,
      row.turn,
      (entry) => entry.toolName === call.toolName && readCallOccurrenceKey(entry) === key,
    );
    const sent = plan?.sent ?? plan?.asked;
    if (
      plan?.person?.source !== 'derived-from-reading' ||
      plan.person.mention !== row.mention ||
      plan.person.frozenLookback !== true ||
      (plan.how !== 'filled' && plan.how !== 'bound') ||
      sent === undefined ||
      call.drift !== undefined ||
      !sameRange(sent, window.range)
    )
      continue;
    return canDiscloseProvenWindow(scope, sent) ? `${answer}\n\n${provenWindowLine(sent)}` : answer;
  }
  return answer;
}

/** The stream carries the captured answer after all transformations, or emits nothing. */
export function emitCapturedAnswer(
  scope: TypedScope<AgentState>,
  iteration: number,
  answer: string,
): void {
  if (answer.length > 0) {
    typedEmit(scope, 'agentfootprint.stream.token', {
      iteration,
      tokenIndex: 0,
      content: answer,
    });
  }
}
