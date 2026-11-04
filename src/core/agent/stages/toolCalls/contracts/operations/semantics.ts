import type { TypedScope } from 'footprintjs';
import type { AgentState } from '../../../../types.js';

/** Explicit callback contract for existing semantics operations. */
export interface ToolSemanticsOperations {
  readonly declareSemantics: (
    scope: TypedScope<AgentState>,
    call: { readonly toolName: string; readonly toolCallId: string; readonly iteration: number },
    value: unknown,
  ) => unknown | undefined;
}
