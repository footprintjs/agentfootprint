/**
 * summaryStrategy — MessageStrategy that compresses old messages into a summary.
 *
 * Keeps the N most recent messages verbatim. Older messages are compressed
 * into a single system message via a user-provided summarizer function.
 * The summarizer can be LLM-powered or rule-based.
 *
 * System messages are always preserved. The summary is inserted after system
 * messages and before the kept conversation window.
 *
 * Usage:
 *   agentLoop().messageStrategy(summaryStrategy({
 *     keepLast: 10,
 *     summarize: async (msgs) => {
 *       const text = msgs.map(m => `${m.role}: ${m.content}`).join('\n');
 *       return `Previous conversation summary:\n${await llm.summarize(text)}`;
 *     },
 *   }))
 */

import type { Message } from '../../types/messages';
import { systemMessage } from '../../types/messages';
import type { MessageStrategy } from '../../core';

export interface SummaryStrategyOptions {
  /** Number of most recent non-system messages to keep verbatim. */
  readonly keepLast: number;
  /** Compresses old messages into a summary string. Can be async (LLM call). */
  readonly summarize: (messages: Message[]) => string | Promise<string>;
}

export function summaryStrategy(options: SummaryStrategyOptions): MessageStrategy {
  const { keepLast, summarize } = options;

  return {
    prepare: async (history: Message[]) => {
      const system = history.filter((m) => m.role === 'system');
      const rest = history.filter((m) => m.role !== 'system');

      if (rest.length <= keepLast) {
        return {
          value: history,
          chosen: 'summary',
          rationale: `${history.length} messages (within limit)`,
        };
      }

      const old = rest.slice(0, rest.length - keepLast);
      const kept = rest.slice(-keepLast);

      const summary = await summarize(old);
      if (!summary) {
        return {
          value: [...system, ...kept],
          chosen: 'summary',
          rationale: `summarized ${old.length} old messages (summary empty)`,
        };
      }

      const result = [...system, systemMessage(summary), ...kept];
      return {
        value: result,
        chosen: 'summary',
        rationale: `summarized ${old.length} old, kept ${kept.length} recent`,
      };
    },
  };
}
