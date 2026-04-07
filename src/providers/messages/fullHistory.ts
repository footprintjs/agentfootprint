/**
 * fullHistory — MessageStrategy that sends the entire conversation to the LLM.
 *
 * The simplest strategy. No truncation, no summarization.
 * Use when conversations are short or context windows are large.
 *
 * Usage:
 *   agentLoop().messageStrategy(fullHistory())
 */

import type { Message } from '../../types/messages';
import type { MessageStrategy } from '../../core';

export function fullHistory(): MessageStrategy {
  return {
    prepare: (history: Message[]) => ({
      value: history,
      chosen: 'full-history',
      rationale: `${history.length} messages`,
    }),
  };
}
