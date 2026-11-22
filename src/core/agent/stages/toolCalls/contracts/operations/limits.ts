import type { TypedScope } from 'footprintjs';
import type { AgentState } from '../../../../types.js';
import type { Tool } from '../../../../../../tools/tools.js';
import type { ToolResultStatus } from '../../../../../../semantics/toolEffects.js';

import type { ToolResultCut } from '../../../../toolResultCap.js';

export interface CappedResults {
  readonly result: unknown;
  readonly modelResult: unknown;
  /** Present only when the net replaced the model-facing result. */
  readonly cut?: ToolResultCut;
}

/** Explicit callback contract for existing limits operations. */
export interface ToolLimitsOperations {
  readonly capResults: (
    toolName: string,
    values: { readonly result: unknown; readonly modelResult: unknown },
  ) => CappedResults;
  readonly refuseOverCeiling: (
    scope: TypedScope<AgentState>,
    call: { readonly toolName: string; readonly toolCallId: string; readonly iteration: number },
    tool: Tool | undefined,
    value: unknown,
    declaredStatus?: ToolResultStatus,
  ) => string | undefined;
}
