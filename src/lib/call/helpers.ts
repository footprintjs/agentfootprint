/**
 * Shared helpers for call module stages.
 */

import type { LLMResponse, AdapterResult, ToolCall, Message } from '../../types';
import { toolResultMessage } from '../../types';
import type { ToolRegistry } from '../../tools';
import type { ToolProvider } from '../../core';

/**
 * Normalize an LLMResponse into an AdapterResult discriminated union.
 */
export function normalizeAdapterResponse(response: LLMResponse): AdapterResult {
  if (response.toolCalls && response.toolCalls.length > 0) {
    return {
      type: 'tools',
      content: response.content ?? '',
      toolCalls: response.toolCalls,
      usage: response.usage,
      model: response.model,
    };
  }
  return {
    type: 'final',
    content: response.content,
    usage: response.usage,
    model: response.model,
  };
}

/**
 * Execute tool calls and append results to conversation messages.
 *
 * Tries ToolProvider.execute() first (for remote tools like MCP/A2A),
 * falls back to ToolRegistry.get().handler (for local ToolDefinitions).
 */
export async function executeToolCalls(
  toolCalls: ToolCall[],
  registry: ToolRegistry,
  messages: Message[],
  toolProvider?: ToolProvider,
  signal?: AbortSignal,
): Promise<Message[]> {
  // Single copy upfront — O(M+N) instead of O(M*N) from repeated spreads
  const result = [...messages];

  for (const toolCall of toolCalls) {
    let resultContent: string;

    // Try ToolProvider.execute() first (handles remote tools, gated tools, etc.)
    if (toolProvider?.execute) {
      try {
        const execResult = await toolProvider.execute(toolCall, signal);
        resultContent = execResult.content;
      } catch (err) {
        resultContent = JSON.stringify({
          error: true,
          message: err instanceof Error ? err.message : String(err),
        });
      }
    } else {
      // Fall back to ToolRegistry (local ToolDefinition handlers)
      const tool = registry.get(toolCall.name);
      if (!tool) {
        // Sanitize tool name to prevent injection into error messages fed back to LLM
        const safeName = String(toolCall.name).slice(0, 100).replace(/[\n\r]/g, '');
        resultContent = JSON.stringify({
          error: true,
          message: `Tool '${safeName}' not found`,
        });
      } else {
        try {
          const execResult = await tool.handler(toolCall.arguments);
          resultContent = execResult.content;
        } catch (err) {
          resultContent = JSON.stringify({
            error: true,
            message: err instanceof Error ? err.message : String(err),
          });
        }
      }
    }

    result.push(toolResultMessage(resultContent, toolCall.id));
  }

  return result;
}
