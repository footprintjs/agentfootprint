import type { AnswerAccountEvidence } from '../recorders/observability/answerAccount/evidence.js';
import { viewFromEvidence, type RecordingView } from './view.js';

/** Use the same guarded view and fact rules on a complete in-memory recorder input. */
export function bundleView(bundle: AnswerAccountEvidence): RecordingView | undefined {
  if (bundle.version !== 1 || bundle.gaps.length !== 0 || bundle.state === undefined)
    return undefined;
  const positions = bundle.events.map((row) => row.index);
  const eventShapes = new Map(
    bundle.events.flatMap(({ index, toolResult }) =>
      toolResult === undefined ? [] : [[index, toolResult] as const],
    ),
  );
  const historyShapes = new Map(bundle.historyResults?.map(({ index, shape }) => [index, shape]));
  return viewFromEvidence({
    events: bundle.events.map((row) => row.event),
    recordingIndex: (offset) => positions[offset],
    served: false,
    state: bundle.state,
    toolEventShape: (index) => eventShapes.get(index),
    historyToolShape: (index) => historyShapes.get(index),
  });
}
