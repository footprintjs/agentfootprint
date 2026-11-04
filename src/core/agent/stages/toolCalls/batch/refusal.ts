import type { TypedScope } from 'footprintjs';
import type { AgentState } from '../../../types.js';
import type { LLMMessage } from '../../../../../provider-contract/types.js';
import { TOOL_BATCH_FRAME_PREFIX } from '../../../../../lib/saidByPerson.js';
import { typedEmit } from '../../../../../recorders/core/typedEmit.js';
import type { ToolBatchFailure } from '../../toolCallShape.js';

/** Malformed protocol IDs cannot acquire fabricated tool-result correlations. */
export function refuseToolBatch(scope: TypedScope<AgentState>, reason: ToolBatchFailure): void {
  const iteration = scope.iteration as number;
  const history: LLMMessage[] = [...scope.history];
  const text = scope.llmLatestContent;
  // A blank model response supplies no assistant wire turn. Keep the fixed
  // framework notice explicit, so Bedrock never receives adjacent user turns.
  history.push({
    role: 'assistant',
    content:
      text ||
      `${TOOL_BATCH_FRAME_PREFIX} — framework notice: the proposed calls could not be dispatched.]`,
  });
  history.push({
    role: 'user',
    content:
      `${TOOL_BATCH_FRAME_PREFIX} — framework feedback, not a person's words or evidence. ` +
      `The entire proposed batch was refused before dispatch (${reason}); no tools ran. ` +
      'Submit at most 1024 calls with nonempty unique IDs and nonempty tool names, each at most 1024 characters.]',
  });
  scope.history = history;
  scope.toolResults = [];
  scope.lastToolResult = undefined;
  typedEmit(scope, 'agentfootprint.agent.iteration_end', {
    turnIndex: 0,
    iterIndex: iteration,
    toolCallCount: 0,
    history,
  });
  scope.iteration = iteration + 1;
}
