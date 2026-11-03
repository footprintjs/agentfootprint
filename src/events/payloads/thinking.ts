import type { ThinkingBlock } from './dependencyTypes.js';

// embedding.* (1)
export interface EmbeddingGeneratedPayload {
  readonly model: string;
  readonly provider: 'openai' | 'cohere' | 'voyage' | 'local' | 'custom';
  readonly inputKind: 'query' | 'document';
  readonly dimension: number;
  readonly count: number;
  readonly durationMs: number;
  readonly tokensSpent?: number;
}

// stream.thinking.* (2) + agent.thinking.* (1) — v2.14 extended thinking

/**
 * Emitted (v2.14) per provider chunk that carries thinking-content
 * tokens. Lives in `stream.*` domain — parallel to `stream.token` for
 * visible-content tokens.
 *
 * **Provider behavior:**
 * - Anthropic: fires for every `content_block_delta` with
 *   `delta.type === 'thinking_delta'`. May fire 100s of times per turn.
 * - OpenAI o1/o3: NEVER fires (OpenAI doesn't stream reasoning content
 *   as of early 2026). Only `thinking_end` fires at response completion.
 * - Custom providers: fire when `ThinkingHandler.parseChunk()` returns
 *   a non-empty `thinkingDelta`.
 *
 * **Default consumer behavior:** thinking_delta events are emitted but
 * not surfaced to end users unless a consumer explicitly subscribes to
 * this event (e.g. for reasoning-as-it-streams UIs).
 *
 * **Sensitive data:** `content` is raw model thinking text. Use
 * `RedactionPolicy.thinkingPatterns` (Phase 3) to scrub before audit-log
 * adapters fire. Same risk profile as `stream.token`.
 */
export interface StreamThinkingDeltaPayload {
  readonly iteration: number;
  readonly tokenIndex: number;
  /** Per-chunk delta text, NOT accumulated. ~10–50 chars typical. */
  readonly content: string;
}

/**
 * Emitted (v2.14) once per LLM call where thinking blocks were
 * produced. Pairs with the leading `stream.thinking_delta` events when
 * streaming, OR fires standalone for non-streaming providers (OpenAI).
 *
 * Use this event for live per-iteration UIs (chat-bubble reasoning
 * pills, retry-rate dashboards, telemetry). The `blocks` field carries
 * the same content that lands on `LLMMessage.thinkingBlocks` — read it
 * here for live display instead of post-walking `scope.history` after
 * the run completes (the framework's "collect during traversal" rule).
 *
 * **`tokens` field population:**
 * - Anthropic: `undefined` currently — Anthropic's `response.usage`
 *   doesn't break out thinking tokens (bundled in `output_tokens`).
 *   May change in future Anthropic API revisions.
 * - OpenAI o1/o3: populated from
 *   `response.usage.completion_tokens_details.reasoning_tokens`.
 * - Custom providers: populated when handler computes it during
 *   `normalize()`.
 *
 * **Sensitive data:** the `blocks` field carries reasoning content.
 * Same risk profile as `stream.token` — wildcard (`*`) recorders
 * piping to external sinks (Datadog, CloudWatch, OTel) will see this.
 * Treat thinking content with the same redaction posture you give
 * visible response tokens. `providerMeta` is already stripped by the
 * framework before persistence (Phase 6 invariant), so the blocks
 * here match the audit-log surface bytes-exactly.
 */
export interface StreamThinkingEndPayload {
  readonly iteration: number;
  readonly blockCount: number;
  readonly totalChars: number;
  readonly tokens?: number;
  /**
   * v2.14+ — the normalized thinking blocks for this LLM call.
   *
   * Same data the framework persists to `LLMMessage.thinkingBlocks`
   * (post-`providerMeta` strip). Lets live consumers render the
   * model's chain-of-thought per iteration without scope-walking
   * after the run.
   *
   * Empty / undefined when no thinking content was produced this
   * call (handler returned `[]`). Non-empty when at least one
   * thinking or redacted_thinking block landed.
   */
  readonly blocks?: readonly ThinkingBlock[];
}

/**
 * Emitted (v2.14) when a `ThinkingHandler.normalize()` call throws.
 * The framework catches the throw, drops the thinking blocks (they
 * don't land on `LLMMessage.thinkingBlocks`), and continues the agent
 * run. Same graceful-failure pattern as v2.11.6
 * `tools.discovery_failed`.
 *
 * Lives in `agent.*` domain (NOT `stream.*`) because parse failure is
 * a turn-level error concern — recovery happens at the agent loop
 * level, not at the SDK call level.
 *
 * **Anti-pattern (provider authors):** sanitize error messages before
 * throwing. NEVER include raw unparsed thinking content in the error
 * — the message ends up in audit logs and can leak reasoning content
 * the consumer expected to be redacted. Same guidance as
 * `tools.discovery_failed.error`.
 */
export interface AgentThinkingParseFailedPayload {
  readonly providerName: string;
  readonly subflowId: string;
  readonly error: string;
  readonly errorName: string;
  readonly iteration: number;
}

/** One completed-turn thinking block omitted before a provider request. */
export interface AgentThinkingOmittedPayload {
  readonly providerName: string;
  readonly model: string;
  readonly messageIndex: number;
  readonly blockIndex: number;
  readonly reason: import('./dependencyTypes.js').ThinkingReplayReason;
  /** Preparation is observable even when the subsequent transport fails. */
  readonly phase: 'prepared';
}
