/**
 * Thinking — public types for the v2.14 extended-thinking subsystem.
 *
 * Mental model — TWO-LAYER architecture:
 *
 *   • CONSUMER-FACING:   `ThinkingHandler` — a simple function-pair
 *                        (id, normalize, parseChunk?).
 *                        Provider authors and custom-LLM consumers
 *                        implement THIS shape.
 *
 *   • FRAMEWORK-INTERNAL: each `ThinkingHandler` is auto-wrapped in a
 *                         real footprintjs subflow at chart build time.
 *                         The subflow gets its own `runtimeStageId`,
 *                         narrative entry, and InOutRecorder boundary
 *                         — full trace observability for free without
 *                         the consumer writing flowchart code.
 *
 * Same pattern as how consumers write a `Tool` and the framework wraps
 * dispatch in a tool-call subflow, or how consumers write a
 * `ToolProvider` and the framework wraps `list()` in the Tools slot
 * subflow.
 *
 * @see thinkingHandlerFor — the agent uses the handler the PROVIDER
 *      declares (`LLMProvider.thinkingHandler`), never one looked up by name.
 * @see MockThinkingHandler for the canonical example demonstrating
 *      both Anthropic-shape (signed blocks) and OpenAI-shape (multi-
 *      block summary) inputs.
 */

// ─── Block shape ────────────────────────────────────────────────────

/**
 * One thinking block from an LLM response, normalized into a provider-
 * agnostic shape. A response may contain multiple blocks (e.g. OpenAI's
 * structured reasoning_summary emits one block per summary step).
 *
 * Discriminator `type`:
 *   - `'thinking'`            — content is the model's reasoning
 *   - `'redacted_thinking'`   — Anthropic emits this when reasoning
 *                               trips a safety filter; content is
 *                               EMPTY but `signature` is still required
 *                               for round-trip on the next turn
 */
export interface ThinkingBlock {
  /**
   * Block type discriminator. Required so consumers can distinguish
   * normal thinking blocks from server-redacted ones (Anthropic-only
   * today; other providers may produce only `'thinking'`).
   */
  readonly type: 'thinking' | 'redacted_thinking';

  /**
   * Reasoning content as plain text. EMPTY string when `type ===
   * 'redacted_thinking'` (the model's reasoning was redacted by the
   * provider's safety layer; only the signature remains).
   */
  readonly content: string;

  /**
   * Provider cryptographic signature for round-trip integrity.
   *
   * **Anthropic:** REQUIRED for any block emitted in a response that
   * also contained tool_use. The signed block MUST be echoed
   * byte-exact in the assistant message of subsequent tool_result
   * turns — Anthropic validates the signature server-side and rejects
   * (HTTP 400) requests where signed blocks are missing or modified.
   *
   * **OpenAI:** not used (their reasoning_summary doesn't sign blocks).
   *
   * **Future providers:** opaque to the framework; preserved as-is.
   *
   * The framework persists this field in `scope.history` so the
   * provider's serialization layer (Phase 4b) can echo it back on the
   * next request.
   */
  readonly signature?: string;

  /**
   * `true` when this block is a structured-summary step rather than
   * raw thinking content. Set by `OpenAIThinkingHandler` for each step
   * of `reasoning_summary`; never set by Anthropic. Consumers
   * displaying thinking can render summary blocks differently
   * (e.g. as numbered steps) from raw blocks (continuous prose).
   */
  readonly summary?: boolean;

  /**
   * Provider-specific metadata escape hatch for fields the normalized
   * shape doesn't model.
   *
   * **ANTI-PATTERN:** providers MUST NOT include sensitive raw data
   * here (PII, internal IDs, request tokens, customer data). Use the
   * dedicated `signature` field for cryptographic material; nothing
   * else identity-bearing. The framework excludes `providerMeta` from
   * `getNarrative()` by default to avoid accidental audit-log leakage.
   */
  readonly providerMeta?: Readonly<Record<string, unknown>>;
}

// ─── Handler contract (consumer-facing) ─────────────────────────────

/**
 * The consumer-facing contract for thinking normalization. Provider
 * authors and custom-LLM consumers implement this shape; the framework
 * auto-wraps each handler in a real footprintjs subflow at chart build
 * time so the trace shows it as a discrete `runtimeStageId` (e.g.
 * `sf-call-llm/thinking-{id}#5`).
 *
 * The provider DECLARES its handler (`LLMProvider.thinkingHandler`) and the
 * agent uses it — never chosen by `provider.name`, so a wrapper that forwards
 * the field (`withRetry`, an app's own) keeps it. Override per agent with
 * `.thinkingHandler(customHandler)`; `.thinkingHandler(null)` opts out.
 */
export interface ThinkingHandler {
  /**
   * Stable identifier used for `runtimeStageId`, telemetry, narrative
   * entries, and the `agentfootprint.agent.thinking_parse_failed` event
   * payload's `subflowId` field. Convention: lowercase + dash, e.g.
   * `'anthropic'`, `'openai'`, `'mock'`.
   */
  readonly id: string;

  /**
   * Pure: raw provider data → normalized blocks.
   *
   * The framework wraps this call in a try/catch — throwing from
   * `normalize()` does NOT abort the agent run. Instead the framework
   * emits `agentfootprint.agent.thinking_parse_failed`, drops the
   * thinking blocks (LLMMessage.thinkingBlocks remains undefined),
   * and continues. Same graceful-failure pattern as v2.11.6
   * `tools.discovery_failed`.
   *
   * Sync only in v2.14. Future widening to Promise return is a
   * separate decision once a real consumer needs network-backed
   * normalization.
   *
   * @param raw Provider-specific raw data — typically pulled from
   *            `LLMResponse.providerRef`. Handler is responsible for
   *            shape-checking; framework passes whatever the provider
   *            stashed.
   * @returns Normalized blocks in the order they appeared in the
   *          response. Empty array when no thinking is present
   *          (preferred over `undefined` for type stability).
   */
  normalize(raw: unknown): readonly ThinkingBlock[];

  /**
   * Optional streaming hot-path. When provided AND the provider streams,
   * the framework calls `parseChunk(chunk)` per provider chunk and
   * emits `agentfootprint.stream.thinking_delta` events for any
   * `thinkingDelta` returned. Handlers without streaming support omit
   * this field; the framework still calls `normalize()` on the
   * response's terminal `LLMResponse.providerRef`.
   *
   * @param chunk Provider-specific chunk shape (Anthropic emits
   *              `content_block_delta` events; OpenAI doesn't yet
   *              stream reasoning content).
   * @returns Object with optional `thinkingDelta` text — when set,
   *          framework fires `stream.thinking_delta` event with the
   *          content. Return `{}` (or omit) for chunks that contain
   *          no thinking content.
   */
  parseChunk?(chunk: unknown): { thinkingDelta?: string };
}
