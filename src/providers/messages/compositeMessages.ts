/**
 * compositeMessages — MessageStrategy that chains multiple strategies.
 *
 * Strategies execute in order: the output of one becomes the input of the next.
 * This enables layered processing: e.g., summarize → sliding window → tool pair safety.
 *
 * Usage:
 *   agentLoop().messageStrategy(compositeMessages([
 *     summaryStrategy({ keepLast: 20, summarize: mySummarizer }),
 *     slidingWindow({ maxMessages: 10 }),
 *     withToolPairSafety,
 *   ]))
 */

import type { Message } from '../../types/messages';
import type { MessageStrategy, MessageContext } from '../../core';

export function compositeMessages(strategies: readonly MessageStrategy[]): MessageStrategy {
  return {
    prepare: async (history: Message[], context: MessageContext) => {
      let messages = history;
      const labels: string[] = [];
      for (const strategy of strategies) {
        const decision = await strategy.prepare(messages, context);
        messages = decision.value;
        if (decision.chosen !== 'static') labels.push(decision.chosen);
      }
      return {
        value: messages,
        chosen: labels.length > 0 ? `composite: ${labels.join(' → ')}` : 'composite',
        rationale: `${messages.length} messages after ${strategies.length} strategies`,
      };
    },
  };
}
