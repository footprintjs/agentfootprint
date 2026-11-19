import type { TypedScope } from 'footprintjs';
import type { AgentState } from '../../../../types.js';
import type { ToolExecutionContext } from '../../../../../../tools/tools.js';
import type { ToolCallEventIdentity } from '../../../../../../events/types.js';

/** Explicit callback contract for existing progress operations. */
export interface ToolProgressOperations {
  readonly toolProgress: (
    scope: TypedScope<AgentState>,
    call: ToolCallEventIdentity & { readonly toolName: string },
  ) => Pick<ToolExecutionContext, 'progress'>;
}
