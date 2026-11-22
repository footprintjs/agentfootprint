import { statePointer } from '../../pointer.js';
import { isRecord } from '../../recordValues.js';
import type { AssessmentPointer, AssessmentReason } from '../../types.js';

interface CompletionReason {
  readonly reason: AssessmentReason;
  readonly witness: AssessmentPointer;
}

/** The answer's completion reasons, from the two stage-owned record keys. */
export function answerCompletionReasons(
  state: Readonly<{
    stoppedEarly?: unknown;
    llmLatestStopReason?: unknown;
    pausedToolCallId?: unknown;
  }>,
): readonly CompletionReason[] {
  const reasons: CompletionReason[] = [];
  if (isRecord(state.stoppedEarly)) {
    reasons.push({ reason: 'stopped-early', witness: statePointer('stoppedEarly', 'iteration') });
  }
  const paused = typeof state.pausedToolCallId === 'string' && state.pausedToolCallId.length > 0;
  if (!paused && state.llmLatestStopReason === 'max_tokens') {
    reasons.push({ reason: 'answer-output-limit', witness: statePointer('llmLatestStopReason') });
  }
  return reasons;
}
