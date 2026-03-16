/**
 * Message types for LLM conversation.
 * Provider-agnostic — adapters translate to/from provider formats.
 *
 * Content can be a plain string (backward compat) or ContentBlock[]
 * for multi-modal messages (images, structured tool results, etc.).
 */

import type { MessageContent } from './content';

export interface SystemMessage {
  readonly role: 'system';
  readonly content: string;
}

export interface UserMessage {
  readonly role: 'user';
  readonly content: MessageContent;
}

export interface AssistantMessage {
  readonly role: 'assistant';
  readonly content: MessageContent;
  readonly toolCalls?: ToolCall[];
}

export interface ToolResultMessage {
  readonly role: 'tool';
  readonly content: MessageContent;
  readonly toolCallId: string;
}

export type Message = SystemMessage | UserMessage | AssistantMessage | ToolResultMessage;

export interface ToolCall {
  readonly id: string;
  readonly name: string;
  readonly arguments: Record<string, unknown>;
}

// ── Helpers ──────────────────────────────────────────────────

export function systemMessage(content: string): SystemMessage {
  return { role: 'system', content };
}

export function userMessage(content: MessageContent): UserMessage {
  return { role: 'user', content };
}

export function assistantMessage(
  content: MessageContent,
  toolCalls?: ToolCall[],
): AssistantMessage {
  return { role: 'assistant', content, toolCalls };
}

export function toolResultMessage(content: MessageContent, toolCallId: string): ToolResultMessage {
  return { role: 'tool', content, toolCallId };
}

export function hasToolCalls(msg: Message): msg is AssistantMessage & { toolCalls: ToolCall[] } {
  return msg.role === 'assistant' && Array.isArray(msg.toolCalls) && msg.toolCalls.length > 0;
}
