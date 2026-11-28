import { capturePlainResultShape } from '../core/agent/plainResultShape.js';
import { readCallOccurrenceKey } from '../lib/callOccurrence.js';
import type { CaptureToolEvidence } from '../recorders/observability/answerAccount/evidence.js';
import { recordAnswerAccount } from '../recorders/observability/answerAccount/recorder.js';

const capture: CaptureToolEvidence = {
  captureHistory: capturePlainResultShape,
  captureEvent(payload) {
    if (
      typeof readCallOccurrenceKey(payload) !== 'string' ||
      payload.entered !== true ||
      payload.error === true ||
      payload.notExecuted === true ||
      payload.notDispatched !== undefined ||
      payload.status === 'absent' ||
      'modelResult' in payload
    )
      return { kind: 'tool-results' };
    return capturePlainResultShape(payload.result);
  },
};

/** Enable plain-result comparison on the private recorder. The writer stays disconnected. */
export function recordAnswerAccountWithTools(
  runner: Parameters<typeof recordAnswerAccount>[0],
  maxBytes: number,
): ReturnType<typeof recordAnswerAccount> {
  return recordAnswerAccount(runner, maxBytes, undefined, undefined, capture);
}
