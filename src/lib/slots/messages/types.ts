/**
 * Messages slot types.
 *
 * The Messages slot prepares the conversation history before each LLM call.
 * Always mounted as a subflow — config determines internal stages:
 *   - Simple (no store): 1 stage [ApplyStrategy]
 *   - Persistent (with store): 3 stages [LoadHistory → ApplyStrategy → TrackPrepared]
 */

import type { MessageStrategy } from '../../../core';
import type { ConversationStore } from '../../../adapters/memory/types';

/**
 * Config for the Messages slot subflow.
 *
 * Two modes:
 *   - In-memory: provide `strategy` only. History comes from scope (set by SeedScope).
 *   - Persistent: provide `strategy` + `store` + `conversationId`. History loaded from store.
 */
export interface MessagesSlotConfig {
  /** The message strategy (slidingWindow, charBudget, fullHistory, etc.). */
  readonly strategy: MessageStrategy;
  /** Optional conversation store for persistent history. */
  readonly store?: ConversationStore;
  /** Required when store is provided. Identifies the conversation. */
  readonly conversationId?: string;
}
