/**
 * HandleResponse stage — execute tools or finalize.
 *
 * If the LLM returned tool calls: execute them and let the loop continue.
 * If no tool calls (or max iterations reached): extract result and breakPipeline.
 */

import type { ScopeFacade } from 'footprintjs';
import type { ToolRegistry } from '../tools';
import { getTextContent } from '../types/content';
import { AgentScope } from '../scope';
import { lastAssistantMessage } from '../memory';
import { executeToolCalls } from './helpers';

export function createHandleResponseStage(registry: ToolRegistry) {
  return async (scope: ScopeFacade, breakPipeline: () => void) => {
    const parsed = AgentScope.getParsedResponse(scope);
    const loopCount = AgentScope.getLoopCount(scope);
    const maxIterations = AgentScope.getMaxIterations(scope);

    // Finalize: no tool calls, or max iterations reached
    if (!parsed || !parsed.hasToolCalls || loopCount >= maxIterations) {
      const messages = AgentScope.getMessages(scope);
      const lastAsst = lastAssistantMessage(messages);
      AgentScope.setResult(scope, lastAsst ? getTextContent(lastAsst.content) : '');
      breakPipeline();
      return;
    }

    // Execute tools
    const messages = AgentScope.getMessages(scope);
    const updatedMessages = await executeToolCalls(parsed.toolCalls, registry, messages);
    AgentScope.setMessages(scope, updatedMessages);
    AgentScope.setLoopCount(scope, loopCount + 1);
    // Don't call breakPipeline — the loop continues back to CallLLM
  };
}
