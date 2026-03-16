/**
 * persistentHistory — MessageStrategy that stores and loads conversation
 * history across sessions via a storage adapter.
 *
 * On each `prepare` call:
 *   1. Loads stored messages from the adapter
 *   2. Merges with current history (stored first, then current)
 *   3. Saves the merged result back to the adapter
 *   4. Returns the merged messages
 *
 * The storage adapter is a simple interface — implement it with localStorage,
 * a database, Redis, file system, or any persistence layer.
 *
 * Usage:
 *   const store = new InMemoryStore();
 *   agentLoop().messageStrategy(persistentHistory({
 *     conversationId: 'conv-123',
 *     store,
 *   }))
 */

import type { Message } from '../../types/messages';
import type { MessageStrategy } from '../../core';

// ── Storage Adapter ──────────────────────────────────────────

export interface ConversationStore {
  /** Load stored messages for a conversation. Returns empty array if none. */
  load(conversationId: string): Message[] | Promise<Message[]>;
  /** Save messages for a conversation (replaces existing). */
  save(conversationId: string, messages: Message[]): void | Promise<void>;
}

export interface PersistentHistoryOptions {
  /** Unique identifier for this conversation. */
  readonly conversationId: string;
  /** Storage adapter for loading/saving messages. */
  readonly store: ConversationStore;
}

// ── Factory ──────────────────────────────────────────────────

export function persistentHistory(options: PersistentHistoryOptions): MessageStrategy {
  const { conversationId, store } = options;

  return {
    prepare: async (history: Message[]) => {
      const stored = await store.load(conversationId);

      // Merge: stored history first, then new messages not in stored
      const merged = stored.length > 0 ? [...stored, ...history.slice(stored.length)] : history;

      await store.save(conversationId, merged);
      return merged;
    },
  };
}

// ── In-Memory Store (for testing) ────────────────────────────

export class InMemoryStore implements ConversationStore {
  private readonly conversations = new Map<string, Message[]>();

  load(conversationId: string): Message[] {
    return this.conversations.get(conversationId) ?? [];
  }

  save(conversationId: string, messages: Message[]): void {
    this.conversations.set(conversationId, [...messages]);
  }

  /** Clear all stored conversations. */
  clear(): void {
    this.conversations.clear();
  }
}
