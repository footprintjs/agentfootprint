import type { TypedScope } from 'footprintjs';
import type { AgentState } from '../../../../types.js';
import type { ReadToolResultEnvelope } from '../../../../../../semantics/toolEffects.js';
import type { TransitionBatchState } from '../callFacts.js';

/** Explicit callback contract for existing effects operations. */
export interface ToolEffectsOperations {
  readonly warnEffect: (toolName: string, sentence: string) => void;
  readonly applyToolEffects: (
    scope: TypedScope<AgentState>,
    call: { readonly toolName: string; readonly toolCallId: string; readonly iteration: number },
    envelope: ReadToolResultEnvelope,
    state: TransitionBatchState,
  ) => string;
  readonly emitTransitionConflict: (
    scope: TypedScope<AgentState>,
    iteration: number,
    state: TransitionBatchState,
  ) => void;
}
