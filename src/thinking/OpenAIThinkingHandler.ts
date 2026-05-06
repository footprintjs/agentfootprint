/**
 * OpenAIThinkingHandler — normalizes OpenAI's o1/o3 reasoning_summary
 * structured output into the framework's `ThinkingBlock[]` contract.
 *
 * OpenAI's reasoning_summary shape varies by model + API version:
 *
 *   1. Older o1 format — simple string:
 *        "I worked through the problem by first..."
 *
 *   2. Newer o3+ structured — array of summary items:
 *        [
 *          { type: 'summary_text', text: 'Identify the user request' },
 *          { type: 'summary_text', text: 'Choose appropriate tool' },
 *        ]
 *
 *   3. Missing entirely — most calls (gpt-4o, or o1/o3 without
 *      reasoning_summary param requested) → undefined raw input
 *
 * Handler dispatches on shape; output is `ThinkingBlock[]` with
 * `summary: true` per Phase 1 contract — distinguishes structured-
 * summary blocks from raw thinking content (Anthropic's shape).
 *
 * **No signature** — OpenAI doesn't sign reasoning. The output's
 * `signature` field stays undefined. No round-trip integrity invariant
 * (unlike Anthropic).
 *
 * **No `parseChunk`** — OpenAI doesn't stream reasoning content as of
 * early 2026. Reasoning arrives only on the terminal response. Per
 * Phase 1 design, `parseChunk` is optional; we omit entirely.
 *
 * **No `usage.thinking` computation** — reasoning_tokens lives on
 * `response.usage.completion_tokens_details.reasoning_tokens` and is
 * the OpenAIProvider's job to surface (deferred). Handler doesn't
 * compute token counts.
 */

import type { ThinkingBlock, ThinkingHandler } from './types.js';

/** OpenAI's structured summary item — one element of the array shape. */
interface OpenAISummaryItem {
  readonly type?: string;
  readonly text?: string;
  // OpenAI may add other fields (e.g., reasoning step type); we
  // ignore them to keep the handler forward-compatible.
}

function isOpenAIStructuredArray(raw: unknown): raw is readonly OpenAISummaryItem[] {
  return Array.isArray(raw);
}

export const openAIThinkingHandler: ThinkingHandler = {
  id: 'openai',
  providerNames: ['openai'],

  normalize(raw: unknown): readonly ThinkingBlock[] {
    if (raw === undefined || raw === null) return [];

    // Shape 1: simple string (older o1 format).
    if (typeof raw === 'string') {
      return raw.length > 0 ? [{ type: 'thinking', content: raw, summary: true }] : [];
    }

    // Shape 2: structured array of summary items (newer o3+ format).
    if (isOpenAIStructuredArray(raw)) {
      const out: ThinkingBlock[] = [];
      for (const item of raw) {
        // Tolerate items missing `text` (defensive — wire format may
        // evolve). Skip entries without usable content.
        if (typeof item.text === 'string' && item.text.length > 0) {
          out.push({
            type: 'thinking',
            content: item.text,
            summary: true,
          });
        }
      }
      return out;
    }

    // Unknown shape — return empty rather than throw. The framework
    // catches throws and emits parse_failed; here we choose graceful
    // empty for unknown OpenAI evolutions (forward-compat).
    return [];
  },

  // No parseChunk — OpenAI doesn't stream reasoning content.
};
