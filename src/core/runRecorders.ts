import type { CombinedRecorder } from 'footprintjs';
import type { RunContext } from '../bridge/eventMeta.js';
import type { EventDispatcher } from '../events/dispatcher.js';
import type { RunRedaction } from '../redaction/runRedaction.js';
import { ContextRecorder } from '../recorders/core/ContextRecorder.js';
import { contextRecordedRecorder } from '../recorders/core/ContextRecordedRecorder.js';
import { streamRecorder } from '../recorders/core/StreamRecorder.js';
import { agentRecorder } from '../recorders/core/AgentRecorder.js';
import { compositionRecorder } from '../recorders/core/CompositionRecorder.js';

/** Composition-native recorder wiring; all retain the captured invocation. */
export function compositionRecorders(
  dispatcher: EventDispatcher,
  getRunContext: () => RunContext,
  redaction: RunRedaction,
  extra: readonly CombinedRecorder[],
  attached: readonly CombinedRecorder[],
): readonly CombinedRecorder[] {
  return [
    ...redaction.recorders,
    contextRecordedRecorder({ dispatcher, getRunContext }),
    new ContextRecorder({ dispatcher, getRunContext, realWrites: redaction }),
    streamRecorder({ dispatcher, getRunContext }),
    agentRecorder({ dispatcher, getRunContext }),
    compositionRecorder({ dispatcher, getRunContext }),
    ...extra,
    ...attached,
  ];
}
