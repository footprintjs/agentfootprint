/**
 * withToolPairSafety — wraps any MessageStrategy to ensure tool-call/tool-result
 * pairs are never orphaned after truncation.
 *
 * Problem: if a sliding window or budget strategy drops an assistant message that
 * had toolCalls, the corresponding tool result messages become orphaned. Most LLM
 * APIs reject or misinterpret orphaned tool results.
 *
 * Solution: after the inner strategy runs, scan for orphaned tool results and
 * remove them. Also remove assistant toolCall messages whose results were dropped.
 *
 * Usage:
 *   agentLoop().messageStrategy(
 *     withToolPairSafety(slidingWindow({ maxMessages: 20 }))
 *   )
 */

import type { Message } from '../../types/messages';
import type { MessageStrategy, MessageContext } from '../../core';

export function withToolPairSafety(inner: MessageStrategy): MessageStrategy {
  return {
    prepare: (history: Message[], context: MessageContext) => {
      const decision = inner.prepare(history, context);
      // Handle both sync and async strategies
      if (decision instanceof Promise) {
        return decision.then((d) => {
          const sanitized = sanitize(d.value);
          const dropped = d.value.length - sanitized.length;
          return {
            value: sanitized,
            chosen: d.chosen,
            rationale:
              dropped > 0
                ? `${d.rationale ?? ''}; dropped ${dropped} orphaned tool messages`
                : d.rationale,
          };
        });
      }
      const sanitized = sanitize(decision.value);
      const dropped = decision.value.length - sanitized.length;
      return {
        value: sanitized,
        chosen: decision.chosen,
        rationale:
          dropped > 0
            ? `${decision.rationale ?? ''}; dropped ${dropped} orphaned tool messages`
            : decision.rationale,
      };
    },
  };
}

function sanitize(messages: Message[]): Message[] {
  // Collect all tool call IDs from assistant messages in this set
  const availableCallIds = new Set<string>();
  // Collect all tool result IDs
  const availableResultIds = new Set<string>();

  for (const msg of messages) {
    if (msg.role === 'assistant' && msg.toolCalls) {
      for (const tc of msg.toolCalls) {
        availableCallIds.add(tc.id);
      }
    }
    if (msg.role === 'tool') {
      availableResultIds.add(msg.toolCallId);
    }
  }

  return messages.filter((msg) => {
    // Drop tool results whose assistant request was truncated
    if (msg.role === 'tool') {
      return availableCallIds.has(msg.toolCallId);
    }
    // Drop assistant toolCall messages whose results were truncated
    if (msg.role === 'assistant' && msg.toolCalls && msg.toolCalls.length > 0) {
      const hasAnyResult = msg.toolCalls.some((tc) => availableResultIds.has(tc.id));
      if (!hasAnyResult) return false;
    }
    return true;
  });
}
