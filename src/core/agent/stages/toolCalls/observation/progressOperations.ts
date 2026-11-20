import { type TypedScope, isDevMode } from 'footprintjs';
import type { AgentState } from '../../../types.js';
import type { ToolExecutionContext } from '../../../../../tools/tools.js';
import type { ToolCallEventIdentity } from '../../../../../events/types.js';
import { callOccurrenceField } from '../../../../../lib/callOccurrence.js';
import { typedEmit } from '../../../../../recorders/core/typedEmit.js';
import type { ToolProgressOperations } from '../contracts/operations/progress.js';

interface ToolProgressOperationsLinks {
  readonly progressWarned: Set<string>;
}

/** Compose the existing progress callbacks once for this handler. */
export function buildToolProgressOperations(
  links: ToolProgressOperationsLinks,
): ToolProgressOperations {
  const toolProgress = (
    scope: TypedScope<AgentState>,
    call: ToolCallEventIdentity & { readonly toolName: string },
  ): Pick<ToolExecutionContext, 'progress'> => ({
    progress: (payload: unknown): void => {
      try {
        typedEmit(scope, 'agentfootprint.stream.tool_progress', {
          toolCallId: call.toolCallId,
          toolName: call.toolName,
          iteration: call.iteration,
          ...callOccurrenceField(call.callOccurrenceKey),
          payload,
        });
      } catch (err) {
        if (isDevMode() && !links.progressWarned.has(call.toolName)) {
          links.progressWarned.add(call.toolName);
          // eslint-disable-next-line no-console
          console.warn(
            `[agentfootprint] tool '${call.toolName}': ctx.progress could not file a report ` +
              `(${err instanceof Error ? err.message : String(err)}). The call itself is ` +
              'unaffected — progress is telemetry, and a dropped report never fails a tool.',
          );
        }
      }
    },
  });

  return { toolProgress };
}
