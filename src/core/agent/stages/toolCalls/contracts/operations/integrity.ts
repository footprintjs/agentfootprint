import type { TypedScope } from 'footprintjs';
import type { AgentState } from '../../../../types.js';
import type { LLMMessage } from '../../../../../../provider-contract/types.js';

/** Explicit callback contract for existing integrity operations. */
export interface ToolIntegrityOperations {
  readonly judgeColumns: (
    scope: TypedScope<AgentState>,
    call: { readonly toolName: string; readonly toolCallId: string; readonly iteration: number },
    value: unknown,
  ) => string | undefined;
  readonly noticeEmptyLookup: (
    scope: TypedScope<AgentState>,
    call: { readonly toolName: string; readonly toolCallId: string; readonly iteration: number },
    args: Readonly<Record<string, unknown>>,
    result: unknown,
    history: readonly LLMMessage[],
    answered: boolean,
  ) => void;
}
