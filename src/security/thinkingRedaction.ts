/**
 * thinkingRedaction — content scrubbing for ThinkingBlock[] before
 * persistence + audit-log adapters fire.
 *
 * Pattern: Pure function. Same shape as the v2.4 RedactionPolicy.scope-
 * patterns / emit-patterns helpers — regex match + replace.
 *
 * Mental model — TWO-LAYER persistence:
 *   - LLMMessage.thinkingBlocks IS persisted to scope.history (required
 *     for Anthropic signature round-trip).
 *   - Audit-log adapters (CloudWatch, Datadog OTel, etc.) read from
 *     scope.history. Sensitive reasoning (PII in chain-of-thought,
 *     internal IDs the model worked through) lands there too.
 *   - This helper scrubs content patterns BEFORE the assistant message
 *     pushes to scope.history, so the audit-log surface only sees
 *     redacted content while the LLM still sees the unredacted reasoning
 *     for round-trip integrity.
 *
 * The signature field is NEVER touched by redaction — Anthropic's
 * server-side signature is bound to the original content; modifying
 * content here would invalidate the signature. Resolution: signature
 * survives byte-exact, content gets scrubbed. This means the Anthropic
 * API will reject the next turn IF the consumer wired thinkingPatterns
 * AND uses Anthropic with extended-thinking-plus-tools. Document.
 *
 * Recommended use:
 *   - DON'T wire thinkingPatterns when using Anthropic extended thinking
 *     + tool calls (signature breaks).
 *   - DO wire thinkingPatterns when using OpenAI o1/o3 (no signature,
 *     no round-trip requirement) or for offline log scrubbing.
 *   - For Anthropic + sensitive reasoning, prefer audit-log-side
 *     redaction (filter in your CloudWatch / Datadog adapter rather
 *     than the framework's persistence point).
 */

import type { ThinkingBlock } from '../thinking/types.js';

/** Sentinel string used in place of redacted content. */
export const REDACTED_PLACEHOLDER = '[REDACTED]';

/**
 * Return a copy of `blocks` with each block's `content` field scrubbed
 * by every pattern in `patterns`. Returns the input array unchanged
 * when `patterns` is undefined, empty, or no block content matches.
 *
 * Signature + summary + providerMeta fields are preserved BYTE-EXACT
 * — only `content` is touched.
 *
 * Anthropic signature warning: scrubbing content invalidates the
 * Anthropic server-side signature. Round-trip will fail with HTTP 400
 * on the next turn. Document this in the consumer recipe.
 */
export function redactThinkingBlocks(
  blocks: readonly ThinkingBlock[],
  patterns: readonly RegExp[] | undefined,
): readonly ThinkingBlock[] {
  if (!patterns || patterns.length === 0) return blocks;
  if (blocks.length === 0) return blocks;

  let anyChanged = false;
  const out = blocks.map((b) => {
    const scrubbed = patterns.reduce((c, re) => c.replace(re, REDACTED_PLACEHOLDER), b.content);
    if (scrubbed === b.content) return b;
    anyChanged = true;
    return { ...b, content: scrubbed };
  });

  // Return the original array reference when nothing changed —
  // downstream reference-equality checks (cache markers) stay stable.
  return anyChanged ? out : blocks;
}
