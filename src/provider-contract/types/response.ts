import type { ThinkingDeltaKind } from '../../thinking/types.js';

export interface LLMResponse {
  /** Safe provider intervention evidence; terminal outcomes are never an accepted answer. */
  readonly intervention?: import('../intervention.js').ProviderIntervention;
  /** Ordered replay evidence, retained with the assistant message. */
  readonly replay?: import('../../thinking/replay.js').MessageReplay;
  /** Leaf-side omissions, also available to standalone callers without hooks. */
  readonly replayOmissions?: readonly import('../../thinking/replay.js').ThinkingReplayOmission[];
  readonly content: string;
  readonly toolCalls: readonly {
    readonly id: string;
    readonly name: string;
    readonly args: Readonly<Record<string, unknown>>;
    /**
     * The provider observed malformed or unfinished streamed tool arguments.
     * The call must not execute, even with schema validation disabled. `args`
     * is only a placeholder on this branch, not evidence of valid empty input.
     * Raw argument fragments are deliberately not retained here.
     */
    readonly argumentsFailure?: {
      readonly reason: 'invalid-json' | 'invalid-argument-shape' | 'incomplete-stream';
    };
    /**
     * 9.29.0 — what the PROVIDER needs back with this call, opaque to
     * everything in between.
     *
     * Same escape-hatch shape and the same rules as
     * `ThinkingBlock.providerMeta`: plain data only, nothing
     * identity-bearing beyond what the wire itself demands, and no framework
     * behaviour keys on it. The framework's whole job is to keep it attached
     * to its call — through `scope.llmLatestToolCalls`, into the assistant
     * turn in `history`, across a checkpoint — and hand it back to the same
     * adapter on the next request.
     *
     * Why it exists: Gemini signs the reasoning behind a function call and
     * REFUSES the following turn when the signature does not come back
     * (`thought_signature`, HTTP 400 — measured in the field, after the tool
     * had already run). The signature belongs to the tool call, not to the
     * message and not to a thinking block, so it needed a home on the call.
     * Providers that sign nothing leave this undefined and cost nothing.
     */
    readonly providerMeta?: Readonly<Record<string, unknown>>;
  }[];
  readonly usage: {
    readonly input: number;
    readonly output: number;
    readonly cacheRead?: number;
    readonly cacheWrite?: number;
    /**
     * v2.14 — count of reasoning/thinking tokens used by the model.
     * Distinct from `output` (which is visible-content tokens).
     *
     * Semantics:
     *   - `undefined` — provider doesn't expose / no thinking enabled
     *                   on this call / call without extended thinking
     *   - `0`         — thinking enabled but model produced no
     *                   thinking tokens this call
     *   - `>0`        — actual reasoning token count (billing-relevant
     *                   for both Anthropic extended thinking and
     *                   OpenAI o1/o3 reasoning_tokens)
     *
     * Cost dashboards reading `cost.tick` events should track this
     * separately from `output` — pricing differs (Anthropic charges
     * extended thinking at output rates; OpenAI o1/o3 reasoning tokens
     * are billed as a separate line item).
     */
    readonly thinking?: number;
  };
  readonly stopReason: string;
  readonly providerRef?: string;
  /**
   * v2.14 — Provider-specific raw thinking data, opaque to the
   * framework. Providers that support extended thinking populate this
   * with their native shape (Anthropic: array of `{type, thinking,
   * signature}` blocks; OpenAI: `reasoning_summary` value; custom:
   * whatever the provider emits). The framework hands this to a
   * configured `ThinkingHandler.normalize(rawThinking)` to produce
   * the normalized `ThinkingBlock[]` that lands on
   * `LLMMessage.thinkingBlocks`.
   *
   * Undefined when the provider has no thinking content for this call
   * — most calls (gpt-4o, claude without extended thinking enabled,
   * etc.). The thinking subflow's stage early-returns in this case.
   */
  readonly rawThinking?: unknown;
  /**
   * 9.60.0 — what this request ACTUALLY carried, read back from the
   * serialized body after every transform (see adapters/llm/wireManifest.ts,
   * which builds it; the SHAPE lives here because it is part of the provider
   * port, and the skill-graph fence rightly refuses this file reaching
   * anything past the port).
   *
   * The wire seam's evidence: the recorded defect was an adapter still
   * serializing four tool schemas after the internal frame said they were
   * removed — invisible to any check that reads only the pre-serialization
   * IR. Absent when the adapter states no manifest, and the wire check then
   * treats the request as INCOMPARABLE (never as "nothing crossed"); an
   * empty `toolNames` is the opposite — a stated zero.
   */
  readonly wireManifest?: WireToolManifest;
}

/** The structural record of what one request actually carried on the wire. */
export interface WireToolManifest {
  /** Tool names as they appear in the serialized body, in wire order. */
  readonly toolNames: readonly string[];
  /**
   * Present only when the serialized body carried a structured-output format
   * (Anthropic's `output_config.format`) — its `type`, read back from the
   * body. Absent means none crossed. A `strategy: 'native'` agent refuses a
   * stated manifest without it: the provider declared the capability and the
   * request went out unconstrained.
   */
  readonly outputFormat?: 'json_schema';
}

export interface LLMChunk {
  readonly tokenIndex: number;
  /** Token text. Empty for the terminal chunk (`done: true`). */
  readonly content: string;
  /** True only for the final chunk in a stream. */
  readonly done: boolean;
  /**
   * Authoritative response payload, populated ONLY on the final chunk
   * (`done: true`). Carries `toolCalls`, `usage`, `stopReason` — the
   * fields that drive the ReAct loop. The `content` mirrors the
   * concatenation of all non-terminal chunks; consumers can use
   * either source.
   *
   * Streaming providers SHOULD populate this. Older providers that
   * yield only text and end with `done: true` (no `response`) are
   * still supported — Agent falls back to `complete()` for the
   * authoritative payload in that case.
   */
  readonly response?: LLMResponse;
  /**
   * Live thinking text. Nonempty fragments on nonterminal chunks drive
   * `agentfootprint.stream.thinking_delta` events under the run's redaction policy.
   * Adapters keep signatures, redacted blocks and private data out of this field.
   */
  readonly thinkingDelta?: string;
  /** Classification from the provider request. Omit it when neither classification can be confirmed. */
  readonly thinkingKind?: ThinkingDeltaKind;
}
