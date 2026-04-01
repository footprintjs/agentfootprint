/**
 * InMemoryStore — ConversationStore implementation backed by a plain Map.
 *
 * For testing and development only. Data does not survive process restarts.
 * Use a real backend (Redis, Postgres, DynamoDB) in production.
 */

import type { Message } from '../../types/messages';
import type { ConversationStore } from './types';

export class InMemoryStore implements ConversationStore {
  private readonly conversations = new Map<string, Message[]>();

  load(conversationId: string): Message[] {
    const stored = this.conversations.get(conversationId);
    return stored ? [...stored] : [];
  }

  save(conversationId: string, messages: Message[]): void {
    // Shallow copy — prevent external mutation of stored array
    this.conversations.set(conversationId, [...messages]);
  }

  /** Return all conversation IDs currently in store. */
  ids(): string[] {
    return Array.from(this.conversations.keys());
  }

  /** Return number of messages stored for a conversation. */
  size(conversationId: string): number {
    return this.conversations.get(conversationId)?.length ?? 0;
  }

  /** Clear a specific conversation. */
  delete(conversationId: string): void {
    this.conversations.delete(conversationId);
  }

  /** Clear all stored conversations. */
  clear(): void {
    this.conversations.clear();
  }
}
