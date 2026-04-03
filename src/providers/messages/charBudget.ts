/**
 * charBudget — MessageStrategy that keeps messages within a character budget.
 *
 * Uses character count as a rough proxy for tokens (~4 chars/token).
 * Always preserves system messages. Fills budget from most recent messages first.
 *
 * For precise token counting, implement MessageStrategy directly with a
 * provider-specific tokenizer (e.g. tiktoken).
 *
 * Usage:
 *   agentLoop().messageStrategy(charBudget({ maxChars: 16000 })) // ~4k tokens
 */

import type { Message } from '../../types/messages';
import { contentLength } from '../../types/content';
import type { MessageStrategy } from '../../core';

export interface CharBudgetOptions {
  /** Maximum total characters across all kept messages (rough token proxy). */
  readonly maxChars: number;
}

export function charBudget(options: CharBudgetOptions): MessageStrategy {
  const { maxChars } = options;

  return {
    prepare: (history: Message[]) => {
      const system = history.filter((m) => m.role === 'system');
      const rest = history.filter((m) => m.role !== 'system');

      let totalChars = system.reduce((sum, m) => sum + contentLength(m.content), 0);
      const kept: Message[] = [];

      // Walk backwards — keep most recent messages first
      for (let i = rest.length - 1; i >= 0; i--) {
        const msgChars = contentLength(rest[i].content);
        if (totalChars + msgChars > maxChars) break;
        totalChars += msgChars;
        kept.unshift(rest[i]);
      }

      const result = [...system, ...kept];
      return {
        value: result,
        chosen: 'char-budget',
        rationale: `kept ${result.length} of ${history.length} (${totalChars} chars)`,
      };
    },
  };
}
