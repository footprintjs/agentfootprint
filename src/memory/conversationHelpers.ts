/**
 * Pure functions for conversation message management.
 * No state — just transformations on message arrays.
 */

import type { Message, AssistantMessage, ToolResultMessage } from '../types';
import { hasToolCalls, toolResultMessage } from '../types';

/** Append a message to the conversation. Returns new array. */
export function appendMessage(messages: Message[], message: Message): Message[] {
  return [...messages, message];
}

/** Get the last message in the conversation. */
export function lastMessage(messages: Message[]): Message | undefined {
  return messages[messages.length - 1];
}

/** Get the last assistant message. */
export function lastAssistantMessage(messages: Message[]): AssistantMessage | undefined {
  for (let i = messages.length - 1; i >= 0; i--) {
    if (messages[i].role === 'assistant') return messages[i] as AssistantMessage;
  }
  return undefined;
}

/** Check if the last assistant message has tool calls. */
export function lastMessageHasToolCalls(messages: Message[]): boolean {
  const last = lastAssistantMessage(messages);
  return last ? hasToolCalls(last) : false;
}

/** Create tool result messages from a map of tool call ID → result. */
export function createToolResults(
  results: Array<{ toolCallId: string; content: string }>,
): ToolResultMessage[] {
  return results.map((r) => toolResultMessage(r.content, r.toolCallId));
}
