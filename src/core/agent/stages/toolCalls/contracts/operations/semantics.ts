import type { TypedScope } from 'footprintjs';
import type { AgentState } from '../../../../types.js';
import type { ToolCallEventIdentity } from '../../../../../../events/types.js';

/** Explicit callback contract for existing semantics operations. */
export interface ToolSemanticsOperations {
  readonly declareSemantics: (
    scope: TypedScope<AgentState>,
    call: ToolCallEventIdentity & { readonly toolName: string },
    value: unknown,
  ) => unknown | undefined;
}
