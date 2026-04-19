/**
 * tokenize — approximate token counter for budget-aware memory stages.
 *
 * Memory stages need to answer "how many tokens does this content cost?"
 * to decide what fits in a budget. A real tokenizer (tiktoken, Anthropic's
 * tokenizer, etc.) is accurate but:
 *
 *   - Adds a dependency (tiktoken is ~2MB, has WASM loading quirks).
 *   - Differs per model family (Claude counts differently from GPT).
 *   - Pulls frontend bundles from small to huge.
 *
 * Phase 1 uses a deterministic approximation: 1 token ≈ 4 characters of
 * English text. The constant comes from OpenAI's own documentation and
 * is within ~15% for typical chat content. For "how much memory can I
 * inject into an 8K context", 15% is fine.
 *
 * Consumers who need exact counts pass their own `TokenCounter` through
 * the pipeline config. When that lands (Phase 2), this default stays as
 * the dependency-free baseline.
 */

import type { Message } from '../../types/messages';

/** A function that returns the token count of a string. */
export type TokenCounter = (text: string) => number;

/**
 * Default approximation — 1 token per ~4 characters. Low-accuracy,
 * zero-dependency, deterministic (same input → same count). Good enough
 * for budget-based decisions; replace via pipeline config for accuracy.
 *
 * Accuracy notes:
 *   - ASCII English: within ~15% of tiktoken.
 *   - CJK / emoji / heavy unicode: can undercount by ~2× because
 *     `String.length` counts UTF-16 code units, and CJK chars often
 *     take multiple tokens each. Use a real tokenizer for these workloads.
 *   - Code / JSON: reasonably accurate (punctuation-heavy is ~4 chars/tok).
 */
export const approximateTokenCounter: TokenCounter = (text: string): number => {
  return Math.ceil(text.length / 4);
};

/**
 * Count tokens in a single message. Handles string content and the
 * content-block array variant (where each block has its own text field).
 * Non-text blocks (tool calls, images) contribute a small constant to
 * reflect their structural cost.
 */
export function countMessageTokens(
  message: Message,
  counter: TokenCounter = approximateTokenCounter,
): number {
  if (typeof message.content === 'string') {
    return counter(message.content);
  }
  if (Array.isArray(message.content)) {
    let total = 0;
    for (const block of message.content) {
      if (typeof block === 'object' && block !== null) {
        const b = block as { type?: string; text?: string };
        if (b.type === 'text' && typeof b.text === 'string') {
          total += counter(b.text);
        } else {
          // Tool calls, images, etc. Conservative fixed cost so budget
          // stays bounded even when block shapes are unknown.
          total += 10;
        }
      }
    }
    return total;
  }
  return 0;
}
