/**
 * Event payload types — the 45 typed event payloads across 13 domains.
 *
 * Pattern: Discriminated Union (Gang of Four inspired, TS-native).
 * Role:    Contract layer of Event-Driven Hexagonal Architecture.
 * Emits:   (types only).
 */

import type {
  CompositionKind,
  ContextLifetime,
  ContextRecency,
  ContextRole,
  ContextSlot,
  ContextSource,
  LLMProviderName,
  ToolProtocol,
} from './types.js';
import type { ThinkingBlock } from '../thinking/types.js';

// ─── Tier 1+2: Core Domain (library-emitted) ──────────────────────────

// composition.* (8)
export interface CompositionEnterPayload {
  readonly kind: CompositionKind;
  readonly id: string;
  readonly name: string;
  readonly childCount: number;
}

export interface CompositionExitPayload {
  readonly kind: CompositionKind;
  readonly id: string;
  /** Display name supplied at composition build time (e.g., the
   *  `Sequence.create({ name: 'IntakePipeline' })` arg). Mirrors the
   *  `name` field on `CompositionEnterPayload` so consumers narrating
   *  the exit moment can reference the same human-readable identity
   *  used at entry — no name-cache required across the start/stop
   *  pair. Optional for back-compat with pre-v2.14.5 emitters. */
  readonly name?: string;
  readonly status: 'ok' | 'err' | 'break' | 'budget_exhausted';
  readonly durationMs: number;
}

export interface ParallelForkStartPayload {
  readonly parentId: string;
  readonly branches: readonly { id: string; name: string }[];
}

export interface ParallelBranchCompletePayload {
  readonly parentId: string;
  readonly branchId: string;
  readonly status: 'ok' | 'err';
  readonly durationMs: number;
}

export interface ParallelMergeEndPayload {
  readonly parentId: string;
  readonly strategy: 'llm' | 'fn';
  readonly resultSummary: string;
  readonly mergedBranchCount: number;
}

export interface ConditionalRouteDecidedPayload {
  readonly conditionalId: string;
  readonly chosen: string;
  readonly rationale?: string;
  readonly evidence?: unknown;
}

export interface LoopIterationStartPayload {
  readonly loopId: string;
  readonly iteration: number;
}

export interface LoopIterationExitPayload {
  readonly loopId: string;
  readonly iteration: number;
  readonly reason: 'budget' | 'guard_false' | 'break' | 'body_complete';
}

// agent.* (6)
export interface AgentTurnStartPayload {
  readonly turnIndex: number;
  readonly userPrompt: string;
}

export interface AgentTurnEndPayload {
  readonly turnIndex: number;
  readonly finalContent: string;
  readonly totalInputTokens: number;
  readonly totalOutputTokens: number;
  readonly iterationCount: number;
  readonly durationMs: number;
}

export interface AgentIterationStartPayload {
  readonly turnIndex: number;
  readonly iterIndex: number;
}

export interface AgentIterationEndPayload {
  readonly turnIndex: number;
  readonly iterIndex: number;
  readonly toolCallCount: number;
  /** Conversation history (LLM messages) at the END of this
   *  iteration. Captured by `agent.run()` for fault-tolerant
   *  resume — `RunCheckpointError.checkpoint` snapshots this so
   *  `agent.resumeOnError(...)` can replay from the last good
   *  iteration. Optional for back-compat with v2.x recorders that
   *  subscribed without expecting this field. */
  readonly history?: ReadonlyArray<unknown>;
}

export interface AgentRouteDecidedPayload {
  readonly turnIndex: number;
  readonly iterIndex: number;
  readonly chosen: 'tool-calls' | 'final';
  readonly rationale?: string;
}

export interface AgentHandoffPayload {
  readonly fromAgentId: string;
  readonly toAgentId: string;
  readonly reason?: string;
  readonly viaProtocol?: 'native' | 'mcp' | 'http';
}

// stream.* (5)
export interface LLMStartPayload {
  readonly iteration: number;
  readonly provider: LLMProviderName;
  readonly model: string;
  readonly systemPromptChars: number;
  readonly messagesCount: number;
  readonly toolsCount: number;
  readonly estimatedPromptTokens?: number;
  readonly temperature?: number;
  readonly providerRequestRef?: string;
}

export interface LLMEndPayload {
  readonly iteration: number;
  readonly content: string;
  readonly toolCallCount: number;
  readonly usage: {
    readonly input: number;
    readonly output: number;
    readonly cacheRead?: number;
    readonly cacheWrite?: number;
  };
  readonly stopReason: string;
  readonly durationMs: number;
  readonly providerResponseRef?: string;
}

export interface LLMTokenPayload {
  readonly iteration: number;
  readonly tokenIndex: number;
  readonly content: string;
}

export interface ToolStartPayload {
  readonly toolName: string;
  readonly toolCallId: string;
  readonly args: Readonly<Record<string, unknown>>;
  readonly parallelCount?: number;
  readonly protocol?: ToolProtocol;
}

export interface ToolEndPayload {
  readonly toolCallId: string;
  readonly result: unknown;
  readonly error?: boolean;
  readonly durationMs: number;
}

// context.* (4) — THE CORE DOMAIN
export interface ContextInjectedPayload {
  readonly contentSummary: string;
  readonly contentHash: string;
  readonly rawContent?: string;
  readonly slot: ContextSlot;
  readonly asRole?: ContextRole;
  readonly asRecency?: ContextRecency;
  readonly position?: number;
  readonly sectionTag?: string;
  readonly source: ContextSource;
  readonly sourceId?: string;
  readonly upstreamRef?: string;
  readonly reason: string;
  readonly retrievalScore?: number;
  readonly rankPosition?: number;
  readonly threshold?: number;
  readonly budgetSpent?: { readonly tokens: number; readonly fractionOfCap: number };
  readonly expiresAfter?: ContextLifetime;
}

export interface ContextEvictedPayload {
  readonly slot: ContextSlot;
  readonly contentHash: string;
  readonly reason: 'budget' | 'stale' | 'low_score' | 'policy' | 'user_revoked';
  readonly survivalMs: number;
}

export interface ContextSlotComposedPayload {
  readonly slot: ContextSlot;
  readonly iteration: number;
  readonly budget: {
    readonly cap: number;
    readonly used: number;
    readonly headroomChars: number;
  };
  readonly sourceBreakdown: Readonly<
    Partial<Record<ContextSource, { readonly chars: number; readonly count: number }>>
  >;
  readonly orderingStrategy?: string;
  readonly droppedCount: number;
  readonly droppedSummaries: readonly string[];
}

export interface ContextBudgetPressurePayload {
  readonly slot: ContextSlot;
  readonly capTokens: number;
  readonly projectedTokens: number;
  readonly overflowBy: number;
  readonly planAction: 'evict' | 'summarize' | 'abort';
}

// error.fatal + pause (always-on from library core)
export interface ErrorFatalPayload {
  readonly error: string;
  readonly stage: string;
  readonly scope: string;
}

export interface PauseRequestPayload {
  readonly reason: string;
  readonly questionPayload: Readonly<Record<string, unknown>>;
}

export interface PauseResumePayload {
  readonly resumeInput: Readonly<Record<string, unknown>>;
  readonly pausedDurationMs: number;
}

// ─── Tier 3: Observability Layers (recorder-emitted, opt-in) ──────────

// memory.* (4)
export interface MemoryStrategyAppliedPayload {
  readonly strategyId: string;
  readonly strategyKind:
    | 'sliding-window'
    | 'summarizing'
    | 'semantic'
    | 'fact-extraction'
    | 'hybrid';
  readonly reason: string;
  readonly scoreEvidence?: Readonly<Record<string, unknown>>;
  readonly inputMemoryCount: number;
  readonly outputMemoryCount: number;
  readonly droppedIds: readonly string[];
  readonly addedIds: readonly string[];
}

export interface MemoryAttachedPayload {
  readonly memoryId: string;
  readonly contentSummary: string;
  readonly score?: number;
  readonly rank?: number;
  readonly source: 'store' | 'auto-extract' | 'manual';
  readonly retriever?: 'pinecone' | 'weaviate' | 'qdrant' | 'chroma' | 'custom';
}

export interface MemoryDetachedPayload {
  readonly memoryId: string;
  readonly reason: 'stale' | 'budget' | 'score_low' | 'policy';
}

export interface MemoryWrittenPayload {
  readonly memoryId: string;
  readonly contentSummary: string;
  readonly source: 'auto' | 'manual';
  readonly actor?: string;
}

// tools.* (3)
export interface ToolsOfferedPayload {
  readonly availableIds: readonly string[];
  readonly withheldIds: readonly string[];
  readonly withheldReasons: Readonly<
    Record<string, 'permission' | 'skill_inactive' | 'gated' | 'cost_guard'>
  >;
  readonly reason: string;
}

export interface ToolsActivatedPayload {
  readonly toolId: string;
  readonly reason: 'skill_activated' | 'autoActivate' | 'permission_granted';
  readonly source?: string;
}

export interface ToolsDeactivatedPayload {
  readonly toolId: string;
  readonly reason: 'skill_deactivated' | 'permission_revoked';
}

/**
 * Emitted at the start of a `ToolProvider.list(ctx)` call inside the
 * Discover stage. Pairs with `tools.discovery_completed` (success) or
 * `tools.discovery_failed` (error). Use the pair to measure async-
 * provider latency per iteration without joining stages by hand.
 */
export interface ToolsDiscoveryStartedPayload {
  readonly providerId: string | undefined;
  readonly iteration: number;
}

/**
 * Emitted when `ToolProvider.list(ctx)` resolves successfully. The
 * `durationMs` is the wall-clock between `tools.discovery_started` and
 * resolution; `toolCount` is the size of the returned tool list. For
 * sync providers `durationMs` is ~0; for async hub-backed providers
 * this is your observability hook for catalog-fetch latency.
 */
export interface ToolsDiscoveryCompletedPayload {
  readonly providerId: string | undefined;
  readonly iteration: number;
  readonly durationMs: number;
  readonly toolCount: number;
}

/**
 * Emitted when a custom `ToolProvider.list(ctx)` throws or rejects.
 * The iteration is aborted; a configured `reliability` rule decides
 * whether to retry, fall back, or fail-fast. `providerId` lets
 * consumers route alerts to the right hub adapter (rube / mcp /
 * custom-discovery). `durationMs` measures how long the failed call
 * spent before throwing, so timeouts vs immediate rejections are
 * distinguishable.
 */
export interface ToolsDiscoveryFailedPayload {
  readonly providerId: string | undefined;
  readonly error: string;
  readonly errorName: string;
  readonly iteration: number;
  readonly durationMs: number;
}

// skill.* (2)
export interface SkillActivatedPayload {
  readonly skillId: string;
  readonly reason: 'autoActivate' | 'read_skill_result' | 'manual';
  readonly injectedTools?: readonly string[];
  readonly injectedSystemPromptChars?: number;
}

export interface SkillDeactivatedPayload {
  readonly skillId: string;
  readonly reason: string;
}

// permission.* (4)
export interface PermissionCheckPayload {
  readonly capability: 'tool_call' | 'memory_read' | 'memory_write' | 'external_net' | 'user_data';
  readonly actor: string;
  readonly target?: string;
  readonly result: 'allow' | 'deny' | 'halt' | 'gate_open';
  readonly policyEngine?: 'opa' | 'cerbos' | 'custom';
  readonly policyRuleId?: string;
  readonly rationale?: string;
  /** v2.12 — telemetry tag carried through from PermissionDecision.reason. */
  readonly reason?: string;
}

export interface PermissionGateOpenedPayload {
  readonly gateId: string;
  readonly openedBy: string;
  readonly expiresAt?: number;
}

export interface PermissionGateClosedPayload {
  readonly gateId: string;
  readonly reason: string;
}

/**
 * Emitted (v2.12) when a `PermissionChecker.check()` returns
 * `{ result: 'halt', ... }`. Pairs with the typed `PolicyHaltError`
 * thrown by `Agent.run()` — the event is the OBSERVABILITY signal,
 * the error is the RUNTIME signal. Both carry the same `reason` for
 * routing (e.g. `'security:exfiltration'` → PagerDuty).
 *
 * Fires AFTER the synthetic tool_result has been written to scope.history
 * but BEFORE the run terminates, so observability adapters see the
 * halt while the conversation history is consistent for downstream
 * audit/replay.
 */
export interface PermissionHaltPayload {
  readonly checkerId?: string;
  readonly target: string;
  readonly reason: string;
  readonly tellLLM?: string;
  readonly iteration: number;
  readonly sequenceLength: number;
}

// risk.* + fallback.* (2)
export interface RiskFlaggedPayload {
  readonly severity: 'low' | 'medium' | 'high' | 'critical';
  readonly category:
    | 'pii'
    | 'prompt_injection'
    | 'runaway_loop'
    | 'cost_overrun'
    | 'hallucination_flag';
  readonly detector: 'nemo_guardrails' | 'llama_guard' | 'custom' | 'heuristic';
  readonly evidence: Readonly<Record<string, unknown>>;
  readonly action: 'warn' | 'redact' | 'abort';
}

export interface FallbackTriggeredPayload {
  readonly kind: 'provider' | 'tool' | 'skill';
  readonly primary: string;
  readonly fallback: string;
  readonly reason: string;
}

// cost.* (2)
export interface CostTickPayload {
  readonly scope: 'iteration' | 'turn' | 'run';
  readonly tokensInput: number;
  readonly tokensOutput: number;
  readonly estimatedUsd: number;
  readonly cumulative: {
    readonly tokensInput: number;
    readonly tokensOutput: number;
    readonly estimatedUsd: number;
  };
}

export interface CostLimitHitPayload {
  readonly kind: 'max_tokens' | 'max_cost' | 'max_iterations' | 'max_wallclock';
  readonly limit: number;
  readonly actual: number;
  readonly action: 'abort' | 'warn' | 'degrade';
}

// eval.* (3)
export interface EvalScorePayload {
  readonly metricId: string;
  readonly value: number;
  readonly threshold?: number;
  readonly target: 'iteration' | 'turn' | 'run' | 'toolCall';
  readonly targetRef: string;
  readonly evaluator?: 'llm' | 'fn' | 'heuristic';
  readonly evidence?: Readonly<Record<string, unknown>>;
}

export interface EvalThresholdCrossedPayload {
  readonly metricId: string;
  readonly direction: 'above' | 'below';
  readonly value: number;
  readonly threshold: number;
  readonly actionTaken?: string;
}

/**
 * Emitted (v2.13) when the agent's final answer fails the agent's
 * configured `outputSchema` (the parser passed to
 * `Agent.create({...}).outputSchema(parser)`).
 *
 * Scope: ONLY agent-level final-answer validation. Tool-input validation
 * (`LLMToolSchema.inputSchema`) is a different concern handled by
 * provider-side type checks; this event does NOT fire for tool-arg
 * validation failures.
 *
 * Lives in the `agent.*` domain (parallel to `agent.turn_end`) because
 * final-answer validation is a turn-level concern, not a generic
 * evaluation metric.
 *
 * Pairs with `agentfootprint.error.retried` (when a reliability rule
 * routes the failure to retry with feedback) or
 * `agentfootprint.reliability.fail_fast` (when retries are exhausted).
 *
 * The event is the OBSERVABILITY signal — it fires on EVERY validation
 * failure, regardless of whether retries are configured. Use the
 * `attempt` + `cumulativeRetries` fields to drive operator dashboards
 * for retry-rate trending (a leading indicator for model drift).
 *
 * Fires BEFORE PostDecide rules evaluate, so observability sees the
 * failure even if a buggy rule routes to fail-fast or swallows it.
 */
export interface AgentOutputSchemaValidationFailedPayload {
  /** Validation error message (from Zod / parser). */
  readonly message: string;
  /** Validation stage — JSON parse vs schema validate. Lets dashboards
   *  distinguish "model emitted prose" (`json-parse`) from "model emitted
   *  JSON but wrong shape" (`schema-validate`); they trend differently
   *  under model drift. */
  readonly stage: 'json-parse' | 'schema-validate';
  /** Failing field path when the parser exposes one (e.g. `'amount.currency'`).
   *  Only set when `stage === 'schema-validate'`. */
  readonly path?: string;
  /** The raw string output that failed — useful for narrative entries showing
   *  "what the model actually said" alongside the validation error. */
  readonly rawOutput?: string;
  /** 1-indexed attempt counter. `1` for the first failure, `2` for the
   *  retry that also failed, etc. */
  readonly attempt: number;
  /** Total output-schema failures in this gate execution. Same as
   *  `validationErrorHistory.length`. Distinct from `attempt` because a
   *  gate can also retry on non-validation errors (5xx, etc.) — this
   *  counts ONLY the schema-driven failures. */
  readonly cumulativeRetries: number;
}

// error.* (retry/recover; fatal is Tier 1)
export interface ErrorRetriedPayload {
  readonly attempt: number;
  readonly maxAttempts: number;
  readonly lastError: string;
  readonly backoffMs: number;
  readonly reason: string;
}

export interface ErrorRecoveredPayload {
  readonly attempt: number;
  readonly totalDurationMs: number;
}

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
 * **Default consumer behavior:** thinking_delta events are suppressed
 * at the consumer level by `enable.thinking({ stream: false })` (Phase 3
 * default). Consumers explicitly opt in with `stream: true` for
 * reasoning-as-it-streams UIs.
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
