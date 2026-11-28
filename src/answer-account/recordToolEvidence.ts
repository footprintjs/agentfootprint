import { capturePlainResultShape } from '../core/agent/plainResultShape.js';
import { copyJson, jsonBytes } from '../lib/boundedJson.js';
import { readCallOccurrenceKey } from '../lib/callOccurrence.js';
import type { CaptureToolEvidence } from '../recorders/observability/answerAccount/evidence.js';
import { recordAnswerAccount } from '../recorders/observability/answerAccount/recorder.js';

import { modelResultView } from './resultView.js';
import { linkToolRewrite, projectToolDecision, rewriteComparison } from './rewriteEvidence.js';

const capture: CaptureToolEvidence = {
  projectDecision: projectToolDecision,
  linkRewrite: linkToolRewrite,
  captureHistory: capturePlainResultShape,
  captureEvent(payload, budget, admitsRewrite) {
    if (
      typeof readCallOccurrenceKey(payload) !== 'string' ||
      payload.entered !== true ||
      payload.error === true ||
      payload.notExecuted === true ||
      payload.notDispatched !== undefined ||
      payload.status === 'absent'
    )
      return { kind: 'tool-results' };
    if (!('modelResult' in payload)) return capturePlainResultShape(payload.result);
    if (!admitsRewrite) return { kind: 'tool-results' };
    // The recorded channel comparison is exact on bounded plain data. The copies
    // are scratch only and unreachable from the sealed bundle.
    const original = copyJson(
      Object.getOwnPropertyDescriptor(payload, 'result')?.value,
      budget,
      false,
    );
    const served = copyJson(
      Object.getOwnPropertyDescriptor(payload, 'modelResult')?.value,
      budget - jsonBytes(original),
      false,
    );
    if (modelResultView(original, served) !== 'model-result') return { kind: 'tool-results' };
    const result = capturePlainResultShape(served);
    return result.kind === 'ready'
      ? {
          kind: 'ready',
          shape: { ...result.shape, view: 'model-result' },
          comparison: rewriteComparison(served, budget),
        }
      : result;
  },
};

/** Enable plain-result comparison on the private recorder. The writer stays disconnected. */
export function recordAnswerAccountWithTools(
  runner: Parameters<typeof recordAnswerAccount>[0],
  maxBytes: number,
): ReturnType<typeof recordAnswerAccount> {
  return recordAnswerAccount(runner, maxBytes, undefined, undefined, capture);
}
