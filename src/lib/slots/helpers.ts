/**
 * Shared helpers for slot subflows.
 */

import type { Message } from '../../types/messages';

/**
 * Find the last user message in the history by iterating backward.
 * O(1) allocation — no array copy.
 */
export function findLastUserMessage(messages: Message[]): Message | undefined {
  for (let i = messages.length - 1; i >= 0; i--) {
    if (messages[i].role === 'user') return messages[i];
  }
  return undefined;
}

/**
 * Extract the text content from a message's content field.
 * Returns empty string for multimodal (array) content — providers that need
 * multimodal should read the full history/messages array directly.
 */
export function extractTextContent(message: Message): string {
  return typeof message.content === 'string' ? message.content : '';
}
