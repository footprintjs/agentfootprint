import type { buildDispatchContext } from './dispatchContext.js';
import type { buildToolEffectsOperations } from '../routing/effectsOperations.js';
import type { TypedScope } from 'footprintjs';
import type { AgentState } from '../../../types.js';
import { typedEmit } from '../../../../../recorders/core/typedEmit.js';
import type { DispatchCall } from '../contracts/batchCall.js';

type DispatchContext = ReturnType<
  ReturnType<typeof buildDispatchContext>['prepareDispatchContext']
>;

interface CompleteToolBatchFrame {
  readonly newHistory: DispatchContext['newHistory'];
  readonly emitTransitionConflict: ReturnType<
    typeof buildToolEffectsOperations
  >['emitTransitionConflict'];
  readonly iteration: number;
  readonly transitionState: DispatchContext['transitionState'];
  readonly toolCalls: readonly DispatchCall[];
}

/** The existing synchronous batchCompletion phase; no new await or checkpoint carrier. */
export function completeToolBatch(
  scope: TypedScope<AgentState>,
  frame: CompleteToolBatchFrame,
): void {
  scope.history = frame.newHistory;

  // The batch-end aggregate for conflicting transition proposals
  // (9.19.0) — fires only when ≥2 accepted proposals named different
  // targets; the per-effect events above already told each story.
  frame.emitTransitionConflict(scope, frame.iteration, frame.transitionState);

  typedEmit(scope, 'agentfootprint.agent.iteration_end', {
    turnIndex: 0,
    iterIndex: frame.iteration,
    toolCallCount: frame.toolCalls.length,
    // The PLAIN local array, not `scope.history` — a TypedScope array
    // read returns a live deep-Proxy view, which is not structured-
    // clone-safe. Event payloads must be detached plain data so they
    // survive RFC-001 'clone' capture (observerDelivery: 'deferred')
    // and never hand consumers a mutable view of engine state.
    history: frame.newHistory,
  });
  scope.iteration = frame.iteration + 1;
}
