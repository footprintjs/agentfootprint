import type { TypedScope } from 'footprintjs';
import type { AgentState } from '../../../types.js';
import type { LLMMessage } from '../../../../../provider-contract/types.js';
import { TOOL_BATCH_FRAME_PREFIX } from '../../../../../lib/saidByPerson.js';
import { typedEmit } from '../../../../../recorders/core/typedEmit.js';
import type { ToolBatchFailure } from '../../toolCallShape.js';
import type { DispatchCall } from '../contracts/batchCall.js';
import { assistantToolTurn } from './assistantTurn.js';

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

/** Valid IDs keep their genuine correlations; these notices contain no producer bytes. */
export function refuseSourceDeclarationBatch(
  scope: TypedScope<AgentState>,
  calls: readonly DispatchCall[],
  contents: readonly string[],
  shownCalls: readonly DispatchCall[],
): void {
  const iteration = scope.iteration as number;
  const history: LLMMessage[] = [...scope.history];
  const assistant = assistantToolTurn(scope, calls);
  const assistantAt = history.length;
  if (assistant !== undefined) history.push(assistant);
  for (const [index, call] of calls.entries()) {
    history.push({
      role: 'tool',
      content: contents[index]!,
      toolCallId: call.id,
      toolName: call.name,
      toolChars: 0,
      toolResultOrigin: 'not-entered',
    });
  }
  scope.history = history;
  scope.toolResults = [];
  scope.lastToolResult = undefined;
  const payload = {
    turnIndex: 0,
    iterIndex: iteration,
    toolCallCount: 0,
    history,
  };
  // The actual current batch only. Historical calls retain their existing caller policy;
  // resolving them by a current name could select a different party's view.
  const shownHistory = [...history];
  if (assistant !== undefined)
    shownHistory[assistantAt] = {
      ...assistant,
      toolCalls: shownCalls,
    };
  // Private computation/checkpoint reducers receive payload unchanged. Only the existing
  // native record branch receives this shown view, followed by the caller's policy.
  typedEmit(scope, 'agentfootprint.agent.iteration_end', payload, {
    ...payload,
    history: shownHistory,
  });
  scope.iteration = iteration + 1;
}
