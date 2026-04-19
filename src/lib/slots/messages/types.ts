/**
 * Messages slot types.
 *
 * The Messages slot prepares the conversation history before each LLM call.
 * Always mounted as a subflow. A single `strategy` trims / reshapes the
 * history in scope (sliding window, summary, composite, etc.). Durable
 * persistence across runs is handled by the separate memory pipeline
 * (see `agentfootprint/memory`), NOT this slot.
 */

import type { MessageStrategy } from '../../../core';

/** Config for the Messages slot subflow. */
export interface MessagesSlotConfig {
  /** The message strategy (slidingWindow, charBudget, fullHistory, etc.). */
  readonly strategy: MessageStrategy;
}
