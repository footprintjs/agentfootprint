/**
 * Shared helpers for agent stages.
 */

import type { LLMResponse, AdapterResult, ToolCall } from '../types';
import { toolResultMessage } from '../types';
import type { ToolRegistry } from '../tools';
import type { Message } from '../types';
import { appendMessage } from '../memory';

/**
 * Normalize an LLMResponse into an AdapterResult discriminated union.
 * Shared by callLLM stage and createAdapterSubflow.
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
 * Returns the updated messages array.
 */
export async function executeToolCalls(
  toolCalls: ToolCall[],
  registry: ToolRegistry,
  messages: Message[],
): Promise<Message[]> {
  let msgs = messages;

  for (const toolCall of toolCalls) {
    const tool = registry.get(toolCall.name);

    let resultContent: string;
    if (!tool) {
      resultContent = JSON.stringify({
        error: true,
        message: `Tool '${toolCall.name}' not found`,
      });
    } else {
      try {
        const result = await tool.handler(toolCall.arguments);
        resultContent = result.content;
      } catch (err) {
        resultContent = JSON.stringify({
          error: true,
          message: err instanceof Error ? err.message : String(err),
        });
      }
    }

    msgs = appendMessage(msgs, toolResultMessage(resultContent, toolCall.id));
  }

  return msgs;
}
