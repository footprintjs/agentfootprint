import type { TypedScope } from 'footprintjs';
import type { AgentState } from '../../../../types.js';
import type { ToolExecutionContext } from '../../../../../../tools/tools.js';

/** Explicit callback contract for existing progress operations. */
export interface ToolProgressOperations {
  readonly toolProgress: (
    scope: TypedScope<AgentState>,
    call: {
      readonly toolName: string;
      readonly toolCallId: string;
      readonly iteration: number;
    },
  ) => Pick<ToolExecutionContext, 'progress'>;
}
