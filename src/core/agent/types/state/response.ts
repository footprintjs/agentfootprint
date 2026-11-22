import type { LLMMessage } from '../../../../provider-contract/types.js';
import type { ThinkingBlock } from '../../../../thinking/types.js';

export interface ResponseState {
  // ── Thinking state (v2.14) ─────────────────────────────────
  /** Provider-specific raw thinking data, set by callLLM after the
   *  LLM response lands. The NormalizeThinking sub-subflow reads this
   *  and feeds it to the configured `ThinkingHandler.normalize()`.
   *  Undefined when the provider has no thinking content for this call. */
  rawThinking?: unknown;
  /** Normalized thinking blocks from the most recent LLM response.
   *  Written by the NormalizeThinking sub-subflow; read by toolCalls/batch/dispatchContext.ts
   *  + prepareFinal.ts when constructing the assistant message for
   *  `scope.history` (ensures Anthropic signature round-trip). Empty
   *  array when no thinking present. */
  thinkingBlocks: readonly ThinkingBlock[];
  /** Latest provider-owned replay evidence. Absent until a provider reports
   * it; cleared if a later reply supplies none. Travels with the assistant
   * turn, including a terminal reply with no thinking blocks. */
  // One-element array: grouped output mappers replace top-level arrays but
  // merge object members. Replay evidence must cross as one atomic value.
  llmLatestReplay?: readonly [NonNullable<LLMMessage['replay']>];
  /**
   * The latest accepted provider response's stop reason, cleared when a local
   * fallback supplies the answer. The answer layer can report an output limit.
   * For native output, Route also rejects a refusal or truncation by name
   * (`outputEnforcement.ts · nativeStopFailure`), even when the answer parses.
   */
  llmLatestStopReason?: string;
  /** For a native format candidate: whether this answer used native structured
   * output. Replaced each call, including provider and local callback fallbacks. */
  llmLatestNativeOutput?: boolean;
}
