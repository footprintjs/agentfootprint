import type { TypedScope } from 'footprintjs';
import type { AgentState } from '../../../../types.js';
import type { LLMMessage } from '../../../../../../provider-contract/types.js';
import type { BatchSettlement } from '../callFacts.js';

/** Explicit callback contract for existing settlement operations. */
export interface ToolSettlementOperations {
  readonly historyForCheckIn: (
    scope: TypedScope<AgentState>,
    history: readonly LLMMessage[],
  ) => LLMMessage[];
  readonly settleBatch: (
    answered: LLMMessage[],
    paused: { readonly toolName: string; readonly toolCallId: string },
  ) => BatchSettlement;
  readonly bracketSettled: (scope: TypedScope<AgentState>, settlement: BatchSettlement) => void;
}
