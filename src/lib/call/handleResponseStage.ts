/**
 * HandleResponse stage — finalize the turn when no tool calls remain.
 *
 * @deprecated Use the RouteResponse decider pattern in buildAgentLoop instead.
 * The loop now uses addDeciderFunction('RouteResponse') with 'tool-calls' and
 * 'final' branches. The Finalize branch (createFinalizeStage) replaces this stage.
 * Kept for backward compatibility with custom chart builders.
 *
 * Reads from scope:
 *   - parsedResponse (set by ParseResponse)
 *   - loopCount, maxIterations
 *   - messages
 *
 * Writes to scope:
 *   - result (final answer text)
 *   - memory_shouldCommit (when useCommitFlag)
 */

import type { TypedScope } from 'footprintjs';
import type { AgentLoopState } from '../../scope/types';
import { getTextContent } from '../../types/content';
import { lastAssistantMessage } from '../../memory';

export interface HandleResponseOptions {
  /**
   * When true, set `memory_shouldCommit=true` instead of calling $break() directly.
   * Use when CommitMemory stage is present — it will call $break() after saving.
   */
  readonly useCommitFlag?: boolean;
}

/**
 * Create the HandleResponse stage function.
 *
 * Tool execution is handled by the upstream sf-execute-tools subflow.
 * HandleResponse only finalizes: if no tool calls remain, extract result + break.
 * If tools were executed (loopCount incremented by subflow), loop continues.
 */
export function createHandleResponseStage(options: HandleResponseOptions) {
  const { useCommitFlag } = options;
  return (scope: TypedScope<AgentLoopState>) => {
    const parsed = scope.parsedResponse;
    const loopCount = scope.loopCount ?? 0;
    const maxIterations = scope.maxIterations ?? 10;

    // If tools were executed by sf-execute-tools, loop continues
    if (parsed?.hasToolCalls && loopCount < maxIterations) {
      return;
    }

    // Finalize: no tool calls, or max iterations reached
    const messages = scope.messages ?? [];
    const lastAsst = lastAssistantMessage(messages);
    scope.result = lastAsst ? getTextContent(lastAsst.content) : '';

    if (useCommitFlag) {
      scope.memory_shouldCommit = true;
    } else {
      scope.$break();
    }
  };
}
