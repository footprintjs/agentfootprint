/**
 * HandleResponse stage — execute tool calls or finalize the turn.
 *
 * If the LLM returned tool calls: execute them and let the loop continue.
 * If no tool calls (or max iterations reached): extract result and breakPipeline.
 *
 * Reads from scope:
 *   - parsedResponse (set by ParseResponse)
 *   - loopCount, maxIterations
 *   - messages
 *
 * Writes to scope:
 *   - messages (appends tool results)
 *   - loopCount (increments)
 *   - result (final answer text)
 */

import type { ScopeFacade } from 'footprintjs/advanced';
import type { ToolRegistry } from '../../tools';
import type { ToolProvider } from '../../core';
import { getTextContent } from '../../types/content';
import { AgentScope } from '../../scope';
import { lastAssistantMessage } from '../../memory';
import { executeToolCalls } from './helpers';

export interface HandleResponseOptions {
  /** Tool registry for executing tool calls. */
  readonly registry: ToolRegistry;
  /** Optional ToolProvider for providers with their own execute() method. */
  readonly toolProvider?: ToolProvider;
  /**
   * When true, set `memory_shouldCommit=true` instead of calling breakPipeline() directly.
   * Use when CommitMemory stage is present — it will call breakPipeline after saving.
   */
  readonly useCommitFlag?: boolean;
}

/**
 * Create the HandleResponse stage function.
 */
export function createHandleResponseStage(options: HandleResponseOptions) {
  const { registry, toolProvider, useCommitFlag } = options;
  return async (scope: ScopeFacade, breakPipeline: () => void) => {
    const parsed = AgentScope.getParsedResponse(scope);
    const loopCount = AgentScope.getLoopCount(scope);
    const maxIterations = AgentScope.getMaxIterations(scope);

    // Finalize: no tool calls, or max iterations reached
    if (!parsed || !parsed.hasToolCalls || loopCount >= maxIterations) {
      const messages = AgentScope.getMessages(scope);
      const lastAsst = lastAssistantMessage(messages);
      AgentScope.setResult(scope, lastAsst ? getTextContent(lastAsst.content) : '');
      if (useCommitFlag) {
        AgentScope.setShouldCommit(scope, true);
      } else {
        breakPipeline();
      }
      return;
    }

    // Execute tools
    const messages = AgentScope.getMessages(scope);
    const signal = scope.getEnv()?.signal;
    const updatedMessages = await executeToolCalls(
      parsed.toolCalls,
      registry,
      messages,
      toolProvider,
      signal,
    );
    AgentScope.setMessages(scope, updatedMessages);
    AgentScope.setLoopCount(scope, loopCount + 1);
    // Don't call breakPipeline — the loop continues back to CallLLM
  };
}
