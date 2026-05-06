/**
 * MockThinkingHandler — canonical example for the v2.14 ThinkingHandler
 * contract. Used by:
 *
 *   1. Tests — drives the shared contract test (every shipped handler
 *      MUST satisfy the same invariants this mock demonstrates).
 *   2. Future provider authors — reference implementation showing how
 *      to handle BOTH Anthropic-shape inputs (signed blocks, possibly
 *      redacted) and OpenAI-shape inputs (multi-block summary). The
 *      pattern of "discriminate by shape, normalize each branch" is
 *      reusable across providers.
 *   3. The MockProvider for end-to-end tests of the framework wiring
 *      without depending on a real LLM SDK.
 *
 * Defaults are deliberately sensitive-data-free — no fake PII, no
 * fake-signature material that could be confused for real cryptography,
 * no internal-looking IDs. Sets the example for consumer-authored
 * handlers.
 */

import type { ThinkingBlock, ThinkingHandler } from './types.js';

/** Shape the mock recognizes for Anthropic-style raw inputs. */
interface MockAnthropicRaw {
  readonly kind: 'anthropic';
  readonly blocks: ReadonlyArray<{
    readonly type: 'thinking' | 'redacted_thinking';
    readonly thinking?: string;
    readonly signature?: string;
  }>;
}

/** Shape the mock recognizes for OpenAI-style raw inputs. */
interface MockOpenAIRaw {
  readonly kind: 'openai';
  readonly summarySteps: readonly string[];
}

/** Discriminated union of shapes the mock accepts. */
type MockThinkingRaw = MockAnthropicRaw | MockOpenAIRaw;

function isMockRaw(raw: unknown): raw is MockThinkingRaw {
  if (typeof raw !== 'object' || raw === null) return false;
  const r = raw as { kind?: unknown; blocks?: unknown; summarySteps?: unknown };
  // Accept only well-formed shapes — protects against {kind: 'anthropic'}
  // missing blocks (would crash .map). The framework's failure-isolation
  // would catch the throw, but defending here keeps the contract
  // "normalize never throws on garbage" tighter.
  if (r.kind === 'anthropic') return Array.isArray(r.blocks);
  if (r.kind === 'openai') return Array.isArray(r.summarySteps);
  return false;
}

/**
 * Build an Anthropic-style raw input for tests. Signature is a marker
 * string — real Anthropic signatures are opaque base64.
 */
export function mockAnthropicRaw(
  blocks: readonly { content: string; signature?: string; redacted?: boolean }[],
): MockAnthropicRaw {
  return {
    kind: 'anthropic',
    blocks: blocks.map((b) => ({
      type: b.redacted ? ('redacted_thinking' as const) : ('thinking' as const),
      ...(b.redacted ? {} : { thinking: b.content }),
      ...(b.signature !== undefined && { signature: b.signature }),
    })),
  };
}

/**
 * Build an OpenAI-style raw input for tests — one summary step per
 * string. Each step becomes a separate ThinkingBlock with `summary: true`.
 */
export function mockOpenAIRaw(summarySteps: readonly string[]): MockOpenAIRaw {
  return { kind: 'openai', summarySteps };
}

export const mockThinkingHandler: ThinkingHandler = {
  id: 'mock',
  // Matches the MockProvider's name; framework auto-wires when
  // Agent uses MockProvider in tests.
  providerNames: ['mock'],

  normalize(raw: unknown): readonly ThinkingBlock[] {
    if (!isMockRaw(raw)) return [];

    if (raw.kind === 'anthropic') {
      return raw.blocks.map((b): ThinkingBlock => {
        if (b.type === 'redacted_thinking') {
          return {
            type: 'redacted_thinking',
            content: '',
            ...(b.signature !== undefined && { signature: b.signature }),
          };
        }
        return {
          type: 'thinking',
          content: b.thinking ?? '',
          ...(b.signature !== undefined && { signature: b.signature }),
        };
      });
    }

    // OpenAI-style: one block per summary step, all marked summary: true.
    return raw.summarySteps.map(
      (content): ThinkingBlock => ({
        type: 'thinking',
        content,
        summary: true,
      }),
    );
  },

  parseChunk(chunk: unknown): { thinkingDelta?: string } {
    // Mock streams thinking via { thinkingDelta: '...' } shape.
    if (typeof chunk !== 'object' || chunk === null) return {};
    const c = chunk as { thinkingDelta?: unknown };
    return typeof c.thinkingDelta === 'string' ? { thinkingDelta: c.thinkingDelta } : {};
  },
};
