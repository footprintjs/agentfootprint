import type { TypedScope } from 'footprintjs';
import { typedEmit } from '../../../../recorders/core/typedEmit.js';
import { retainedStateValue, runKeepsOut } from '../../../../redaction/runRedaction.js';
import { activeTimeReadings } from '../../honesty/timeInputs.js';
import type { AgentState } from '../../types.js';

/** State the admitted window as the library's own fact, using the run's native serving rule. */
export function capturedAnswerOf(
  scope: TypedScope<AgentState>,
  answer: string,
  stateProvenWindow: boolean,
): string {
  if (
    !stateProvenWindow ||
    runKeepsOut(scope, 'findingsLedger') ||
    runKeepsOut(scope, 'userMessage') ||
    runKeepsOut(scope, 'history')
  ) {
    return answer;
  }
  const row = activeTimeReadings(scope)[0];
  if (row?.choice?.by !== 'only' || row.qualifiedLookback === undefined) return answer;
  const window = row.candidates?.[row.choice.candidate];
  if (window?.endpoint?.end !== 'exclusive') return answer;
  const line = `Window: ${window.range.from} to ${window.endpoint.cutoff} (end excluded).`;
  const served = retainedStateValue(scope, 'finalContent', line);
  return typeof served === 'string' && served !== '' ? `${answer}\n\n${served}` : answer;
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
