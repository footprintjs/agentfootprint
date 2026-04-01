/**
 * Memory adapter types — ConversationStore interface for persistent conversation history.
 *
 * ConversationStore is the persistence adapter: it defines WHERE messages are stored.
 * Implement this interface to plug in Redis, Postgres, DynamoDB, localStorage,
 * or any other backend. The library ships with InMemoryStore for testing.
 *
 * This is the memory equivalent of LLMProvider — same adapter-swap story:
 *   - Swap mock ↔ real adapter without changing agent logic
 *   - Swap InMemoryStore ↔ RedisStore without touching flowchart stages
 */

import type { Message } from '../../types/messages';
import type { MessageStrategy } from '../../core/providers';

// ── ConversationStore ────────────────────────────────────────

/**
 * Persistence adapter for conversation message history.
 *
 * Implement this to plug in any storage backend:
 *   - `InMemoryStore` (built-in, for testing)
 *   - Redis: `store.save(id, msgs)` → SETEX key ttl JSON.stringify(msgs)
 *   - Postgres: INSERT OR REPLACE INTO conversations ...
 *   - DynamoDB: PutItem with conversationId as partition key
 *   - localStorage: localStorage.setItem(id, JSON.stringify(msgs))
 *
 * Both methods can be sync or async. The PrepareMemory stage awaits load().
 * The CommitMemory stage fires save() without awaiting (non-blocking).
 */
export interface ConversationStore {
  /**
   * Load stored messages for a conversation.
   * Returns empty array (or null) if no history exists for this conversationId.
   * PrepareMemory treats null the same as an empty array — safe to return either.
   */
  load(conversationId: string): Message[] | null | Promise<Message[] | null>;

  /**
   * Save messages for a conversation (replaces existing).
   * Called fire-and-forget by CommitMemory — errors should be caught internally.
   */
  save(conversationId: string, messages: Message[]): void | Promise<void>;
}

// ── MemoryConfig ─────────────────────────────────────────────

/**
 * Configuration passed to Agent.memory().
 *
 * ```typescript
 * const store = new InMemoryStore();
 *
 * const agent = Agent.create({ provider: llm })
 *   .system('You are helpful.')
 *   .memory({
 *     store,
 *     conversationId: 'conv-123',
 *     strategy: slidingWindow({ maxMessages: 20 }),
 *   })
 *   .build();
 * ```
 */
export interface MemoryConfig {
  /** Persistence adapter — where messages are stored. */
  readonly store: ConversationStore;

  /**
   * Unique identifier for this conversation.
   * Use a stable ID (user ID, session ID, thread ID) so history persists
   * across multiple Agent.run() calls or server restarts.
   */
  readonly conversationId: string;

  /**
   * Optional message strategy — how history is trimmed before each LLM call.
   * If omitted, full untruncated history is used.
   *
   * Recommended: pair with slidingWindow() or charBudget() to avoid
   * exceeding the LLM's context window on long conversations.
   */
  readonly strategy?: MessageStrategy;
}
