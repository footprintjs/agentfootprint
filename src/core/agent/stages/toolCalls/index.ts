import type { PausableHandler, TypedScope } from 'footprintjs';
import type { AgentState } from '../../types.js';
import type { ToolCallsHandlerDeps } from './contracts/handlerDeps.js';
import { composeToolCallOperations } from './compose.js';
import { buildCallDispatch } from './execution/dispatchCall.js';
import { buildToolBatchExecution } from './batch/execute.js';
import { buildToolResume } from './resume/handler.js';

export { atMountedCursor } from './helpers/mountedCursor.js';
export { notServedResult, unknownToolResult } from './helpers/dispatchRefusals.js';
export { composeReadSkillRefusal } from './helpers/readSkillRefusal.js';
export { pausedBatchOf } from './batch/paused.js';
export type { ProposedCall } from './batch/paused.js';
export { _resetPeriodUnjudgedWarnings } from './helpers/periodWarnings.js';
export { notDispatchedResult } from './batch/settle.js';
export { producerCorpusOf } from './evidence/producerCorpus.js';
export type { ToolCallsHandlerDeps } from './contracts/handlerDeps.js';

/** Compose one native tool-call handler; runtime call state remains invocation-local. */
export function buildToolCallsHandler(
  deps: ToolCallsHandlerDeps,
): PausableHandler<TypedScope<AgentState>> {
  const operations = composeToolCallOperations(deps);
  const dispatchCall = buildCallDispatch(deps, operations);
  return {
    execute: buildToolBatchExecution(deps, operations, dispatchCall),
    resume: buildToolResume(deps, operations),
  };
}
