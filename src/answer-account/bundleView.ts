import type { AnswerAccountEvidence } from '../recorders/observability/answerAccount/evidence.js';
import { viewFromEvidence, type RecordingView } from './view.js';

/** Use the same guarded view and fact rules on a complete in-memory recorder input. */
export function bundleView(bundle: AnswerAccountEvidence): RecordingView | undefined {
  if (bundle.version !== 1 || bundle.gaps.length !== 0 || bundle.state === undefined)
    return undefined;
  const positions = bundle.events.map((row) => row.index);
  return viewFromEvidence({
    events: bundle.events.map((row) => row.event),
    recordingIndex: (offset) => positions[offset],
    served: false,
    state: bundle.state,
  });
}
