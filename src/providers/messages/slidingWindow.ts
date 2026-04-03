/**
 * slidingWindow — MessageStrategy that keeps the N most recent messages.
 *
 * Always preserves system messages regardless of window size.
 * Non-system messages are taken from the end of the history.
 *
 * Usage:
 *   agentLoop().messageStrategy(slidingWindow({ maxMessages: 20 }))
 */

import type { Message } from '../../types/messages';
import type { MessageStrategy } from '../../core';

export interface SlidingWindowOptions {
  /** Maximum number of non-system messages to keep. */
  readonly maxMessages: number;
}

export function slidingWindow(options: SlidingWindowOptions): MessageStrategy {
  const { maxMessages } = options;

  return {
    prepare: (history: Message[]) => {
      if (history.length <= maxMessages) {
        return { value: history, chosen: 'sliding-window', rationale: `${history.length} messages (within limit)` };
      }

      const system = history.filter((m) => m.role === 'system');
      const rest = history.filter((m) => m.role !== 'system');
      const kept = rest.slice(-maxMessages);

      return { value: [...system, ...kept], chosen: 'sliding-window', rationale: `kept ${kept.length + system.length} of ${history.length}` };
    },
  };
}
