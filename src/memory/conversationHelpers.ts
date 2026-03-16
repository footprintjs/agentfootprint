/**
 * Pure functions for conversation message management.
 * No state — just transformations on message arrays.
 */

import type { Message, AssistantMessage, ToolResultMessage } from '../types';
import { contentLength, hasToolCalls, toolResultMessage } from '../types';

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

/** Sliding window: keep last N messages (always keep system message). */
export function slidingWindow(messages: Message[], windowSize: number): Message[] {
  if (messages.length <= windowSize) return messages;

  const system = messages.filter((m) => m.role === 'system');
  const rest = messages.filter((m) => m.role !== 'system');
  const kept = rest.slice(-windowSize);

  return [...system, ...kept];
}

/** Truncate messages to fit within a character budget (rough token proxy). */
export function truncateToCharBudget(messages: Message[], maxChars: number): Message[] {
  const system = messages.filter((m) => m.role === 'system');
  const rest = messages.filter((m) => m.role !== 'system');

  let totalChars = system.reduce((sum, m) => sum + contentLength(m.content), 0);
  const kept: Message[] = [];

  // Walk backwards, keep most recent messages first
  for (let i = rest.length - 1; i >= 0; i--) {
    const msgChars = contentLength(rest[i].content);
    if (totalChars + msgChars > maxChars) break;
    totalChars += msgChars;
    kept.unshift(rest[i]);
  }

  return [...system, ...kept];
}

/** Create tool result messages from a map of tool call ID → result. */
export function createToolResults(
  results: Array<{ toolCallId: string; content: string }>,
): ToolResultMessage[] {
  return results.map((r) => toolResultMessage(r.content, r.toolCallId));
}
