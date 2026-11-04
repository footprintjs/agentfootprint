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
  if (text) history.push({ role: 'assistant', content: text });
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
