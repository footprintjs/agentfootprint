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
 * Storage adapter lives in adapters/memory/ — same adapter-swap pattern
 * as LLM providers. ConversationStore and InMemoryStore are re-exported
 * here for backward compatibility.
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

// Re-export from canonical home for backward compatibility
export type { ConversationStore } from '../../adapters/memory/types';
export { InMemoryStore } from '../../adapters/memory/inMemory';

export interface PersistentHistoryOptions {
  /** Unique identifier for this conversation. */
  readonly conversationId: string;
  /** Storage adapter for loading/saving messages. */
  readonly store: import('../../adapters/memory/types').ConversationStore;
}

// ── Factory ──────────────────────────────────────────────────

export function persistentHistory(options: PersistentHistoryOptions): MessageStrategy {
  const { conversationId, store } = options;

  return {
    prepare: async (history: Message[]) => {
      const stored = (await store.load(conversationId)) ?? [];

      // Merge: stored history first, then new messages not in stored
      const merged = stored.length > 0 ? [...stored, ...history.slice(stored.length)] : history;

      await store.save(conversationId, merged);
      return {
        value: merged,
        chosen: 'persistent',
        rationale: stored.length > 0 ? `loaded ${stored.length} stored + ${history.length - stored.length} new` : `${history.length} messages (first turn)`,
      };
    },
  };
}
