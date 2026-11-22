import { statePointer } from '../../pointer.js';
import { isRecord } from '../../recordValues.js';
import { waitingArgumentIteration } from '../../argumentRows.js';
import type { AssessmentPointer, AssessmentReason } from '../../types.js';

interface CompletionReason {
  readonly reason: AssessmentReason;
  readonly witness: AssessmentPointer;
}

/** The answer's completion reasons, from the two stage-owned record keys. */
export function answerCompletionReasons(
  state: Readonly<Record<string, unknown>>,
): readonly CompletionReason[] {
  const reasons: CompletionReason[] = [];
  if (isRecord(state.stoppedEarly)) {
    reasons.push({ reason: 'stopped-early', witness: statePointer('stoppedEarly', 'iteration') });
  }
  const toolPause = state.pausedToolCallId;
  const paused =
    (typeof toolPause === 'string' && toolPause.length > 0) ||
    waitingArgumentIteration(state) !== undefined;
  if (!paused && state.llmLatestStopReason === 'max_tokens') {
    reasons.push({ reason: 'answer-output-limit', witness: statePointer('llmLatestStopReason') });
  }
  return reasons;
}
