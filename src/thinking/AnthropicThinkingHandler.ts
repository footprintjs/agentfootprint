/**
 * AnthropicThinkingHandler — normalizes Anthropic's extended-thinking
 * response shape into the framework's `ThinkingBlock[]` contract.
 *
 * Anthropic emits thinking via blocks in `response.content`:
 *
 *   ```ts
 *   { type: 'thinking',          thinking: 'reasoning text', signature: 'opaque-base64' }
 *   { type: 'redacted_thinking',                              signature: 'opaque-base64' }
 *   { type: 'text',              text: 'visible content' }
 *   { type: 'tool_use',          id, name, input }
 *   ```
 *
 * The handler filters for `'thinking'` + `'redacted_thinking'` blocks,
 * preserves the `signature` field BYTE-EXACT (Anthropic validates
 * signatures server-side on the next turn — any modification = HTTP 400),
 * and ignores other block types (visible text + tool calls flow through
 * the existing `LLMResponse.content` / `LLMResponse.toolCalls` paths).
 *
 * **Critical invariant:** signature pass-through is byte-exact. The
 * handler MUST NOT trim, normalize encoding, JSON-roundtrip, or
 * otherwise touch the signature string. Tests verify this explicitly.
 *
 * **Three input shapes** Anthropic produces (per Phase 4a panel review):
 *   1. Non-streaming response: full `response.content` array
 *   2. Streaming aggregated:   AnthropicProvider accumulates chunks +
 *                              calls handler with the same array shape
 *   3. Bedrock-via-Anthropic:  deferred to Phase 5+ (separate handler
 *                              or extension of this one)
 *
 * Streaming + non-streaming converge on shape #1 because the provider
 * handles the distinction — handler only sees the assembled content
 * array.
 *
 * **`parseChunk` is OPTIONAL** — Phase 3's framework path populates
 * `LLMChunk.thinkingDelta` from inside AnthropicProvider's `stream()`
 * directly, bypassing handler.parseChunk. We still implement it for
 * consumer integrations that want to use the handler on raw Anthropic
 * chunks directly (e.g., custom transports).
 */

import type { ThinkingBlock, ThinkingHandler } from './types.js';

/** Anthropic's wire-format thinking block. */
interface AnthropicThinkingBlock {
  readonly type: 'thinking';
  readonly thinking: string;
  readonly signature?: string;
}

/** Anthropic's wire-format redacted-thinking block (safety-filtered). */
interface AnthropicRedactedThinkingBlock {
  readonly type: 'redacted_thinking';
  readonly signature?: string;
}

/** Other block types Anthropic emits — handler ignores these. */
interface AnthropicOtherBlock {
  readonly type: 'text' | 'tool_use' | string;
  readonly [k: string]: unknown;
}

type AnthropicContentBlock =
  | AnthropicThinkingBlock
  | AnthropicRedactedThinkingBlock
  | AnthropicOtherBlock;

/** Anthropic streaming chunk shape — `delta` carries thinking text in
 *  `content_block_delta` events with `delta.type === 'thinking_delta'`. */
interface AnthropicStreamChunk {
  readonly type?: string;
  readonly delta?: {
    readonly type?: string;
    readonly thinking?: string;
    readonly text?: string;
  };
}

function isAnthropicContentArray(raw: unknown): raw is readonly AnthropicContentBlock[] {
  return Array.isArray(raw);
}

function isThinkingBlock(b: AnthropicContentBlock): b is AnthropicThinkingBlock {
  return b.type === 'thinking';
}

function isRedactedThinkingBlock(b: AnthropicContentBlock): b is AnthropicRedactedThinkingBlock {
  return b.type === 'redacted_thinking';
}

function isAnthropicChunk(chunk: unknown): chunk is AnthropicStreamChunk {
  return typeof chunk === 'object' && chunk !== null;
}

export const anthropicThinkingHandler: ThinkingHandler = {
  id: 'anthropic',
  // 'browser-anthropic' shares the same response shape (raw Anthropic
  // wire format) — both providers route through fromAnthropicResponse
  // which sets `rawThinking` to `message.content`. Bedrock Claude
  // would also fit here but ships as a separate handler if/when its
  // shape diverges.
  providerNames: ['anthropic', 'browser-anthropic'],

  normalize(raw: unknown): readonly ThinkingBlock[] {
    if (!isAnthropicContentArray(raw)) return [];

    const out: ThinkingBlock[] = [];
    for (const block of raw) {
      if (isThinkingBlock(block)) {
        // Byte-exact signature preservation: pass through as-is.
        // No String() coercion that could normalize encoding; if
        // Anthropic ever emits a non-string signature it would be a
        // wire-protocol violation we want to surface, not silently
        // coerce.
        out.push({
          type: 'thinking',
          // Don't touch content — pass through. Anthropic guarantees
          // it's a string when the field is present.
          content: block.thinking,
          ...(block.signature !== undefined && { signature: block.signature }),
        });
      } else if (isRedactedThinkingBlock(block)) {
        // Redacted blocks have no readable content but the signature
        // is still REQUIRED for round-trip. Empty content is the
        // contract (per Phase 1 ThinkingBlock JSDoc).
        out.push({
          type: 'redacted_thinking',
          content: '',
          ...(block.signature !== undefined && { signature: block.signature }),
        });
      }
      // Other block types (text, tool_use, etc.) flow through the
      // existing LLMResponse paths — ignore here.
    }
    return out;
  },

  parseChunk(chunk: unknown): { thinkingDelta?: string } {
    // Optional escape hatch — framework path doesn't call this
    // (AnthropicProvider populates LLMChunk.thinkingDelta directly).
    // Provided for consumer integrations using the handler on raw
    // Anthropic chunks directly.
    if (!isAnthropicChunk(chunk)) return {};
    const delta = chunk.delta;
    if (!delta) return {};
    if (delta.type === 'thinking_delta' && typeof delta.thinking === 'string') {
      return { thinkingDelta: delta.thinking };
    }
    return {};
  },
};
