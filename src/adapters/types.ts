/**
 * adapters/types — the Ports of the hexagonal architecture.
 *
 * Pattern: Adapter (GoF, Design Patterns ch. 4) + Ports-and-Adapters
 *          (Cockburn, 2005).
 * Role:    Contracts for every external dependency the library reaches for:
 *          LLM providers, memory stores, context sources, embeddings,
 *          guardrails, policy engines, pricing tables.
 * Emits:   N/A (interfaces only).
 *
 * Concrete adapters (AnthropicProvider, PineconeStore, LlamaGuardDetector,
 * ...) implement these contracts. `core/` and `core-flow/` depend only on
 * these interfaces — never on concrete adapters.
 */

import type { ContextRole, ContextSlot, ContextSource } from '../events/types.js';

// ─── LLM Provider ────────────────────────────────────────────────────

export interface LLMMessage {
  readonly role: ContextRole;
  readonly content: string;
  /** For `role: 'tool'` — the tool_use id this result corresponds to. */
  readonly toolCallId?: string;
  /** For `role: 'tool'` — the tool name this result corresponds to. */
  readonly toolName?: string;
  /**
   * For `role: 'assistant'` only — the tool calls the LLM requested in this
   * turn. Required for providers (Anthropic, OpenAI) that need to round-trip
   * tool_use blocks across iterations: when the next `complete()` includes
   * a `role: 'tool'` message, the provider reconstructs the matching
   * `tool_use` block on the previous assistant turn from this field.
   * Empty array on text-only turns; undefined for non-assistant roles.
   */
  readonly toolCalls?: readonly {
    readonly id: string;
    readonly name: string;
    readonly args: Readonly<Record<string, unknown>>;
  }[];
  /**
   * v2.13 — PERSISTENCE flag (NOT a visibility flag). When `true`:
   *   • The message IS sent to the LLM as part of the next request
   *     (visible to the model, counts toward its context window).
   *   • The message is OBSERVABLE via narrative/recorders/audit log
   *     (visible to humans for debugging + forensics).
   *   • The message is NOT persisted to `scope.history` after the gate
   *     loop that produced it completes — long-term memory writes,
   *     `getNarrative()` snapshots, and downstream consumers see only
   *     non-ephemeral messages.
   *
   * Use case: Instructor-style schema retry. The reliability gate
   * appends `{ role: 'user', content: feedbackForLLM, ephemeral: true }`
   * before retry — the LLM sees the validation feedback for the next
   * call, but the conversation history (and any memory persistence
   * downstream) sees only the final accepted exchange.
   *
   * Audit-trail safety: ephemeral DOES NOT mean invisible to security
   * review. `getNarrative()`, recorders, and the typed-event stream all
   * see ephemeral messages; only the persistent conversation log filters
   * them out. An attacker cannot use the ephemeral marker to construct
   * audit-invisible prompts.
   */
  readonly ephemeral?: boolean;
}

export interface LLMToolSchema {
  readonly name: string;
  readonly description: string;
  readonly inputSchema: Readonly<Record<string, unknown>>;
}

export interface LLMRequest {
  readonly systemPrompt?: string;
  readonly messages: readonly LLMMessage[];
  readonly tools?: readonly LLMToolSchema[];
  readonly model: string;
  readonly temperature?: number;
  readonly maxTokens?: number;
  readonly stop?: readonly string[];
  readonly signal?: AbortSignal;
  /**
   * Cache markers (v2.6+) — provider-agnostic prefix-cache hints
   * populated by `CacheStrategy.prepareRequest` after the agent's
   * CacheGate decider routes to `apply-markers`. Each marker
   * identifies a cacheable prefix in `system` / `tools` / `messages`.
   *
   * Providers that support caching (Anthropic, Bedrock-Claude) read
   * this field and translate to their wire format. Providers without
   * cache support (OpenAI auto-cache, Mock, NoOp) ignore it.
   */
  readonly cacheMarkers?: readonly import('../cache/types.js').CacheMarker[];
}

export interface LLMResponse {
  readonly content: string;
  readonly toolCalls: readonly {
    readonly id: string;
    readonly name: string;
    readonly args: Readonly<Record<string, unknown>>;
  }[];
  readonly usage: {
    readonly input: number;
    readonly output: number;
    readonly cacheRead?: number;
    readonly cacheWrite?: number;
  };
  readonly stopReason: string;
  readonly providerRef?: string;
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
}

export interface LLMProvider {
  readonly name: string;
  complete(req: LLMRequest): Promise<LLMResponse>;
  stream?(req: LLMRequest): AsyncIterable<LLMChunk>;
}

// ─── Context Source ──────────────────────────────────────────────────

export interface ResolveCtx {
  readonly userMessage: string;
  readonly turnIndex: number;
  readonly iterIndex: number;
  readonly availableBudgetTokens: number;
  readonly signal?: AbortSignal;
}

export interface ContextContribution {
  readonly contentSummary: string;
  readonly rawContent?: string;
  readonly score?: number;
  readonly rank?: number;
  readonly asRole?: ContextRole;
  readonly sectionTag?: string;
  readonly reason: string;
}

export interface ContextSourceAdapter {
  readonly id: string;
  readonly targetSlot: ContextSlot;
  readonly source: ContextSource;
  resolve(ctx: ResolveCtx): Promise<readonly ContextContribution[]>;
}

// ─── Embedding Provider ─────────────────────────────────────────────

export interface EmbeddingProvider {
  readonly name: string;
  readonly dimension: number;
  embed(inputs: readonly string[], kind: 'query' | 'document'): Promise<number[][]>;
}

// ─── Risk Detector (guardrails) ─────────────────────────────────────

export interface RiskContext {
  readonly slot?: ContextSlot;
  readonly source?: ContextSource;
  readonly turnIndex?: number;
  readonly iterIndex?: number;
}

export interface RiskResult {
  readonly flagged: boolean;
  readonly severity: 'low' | 'medium' | 'high' | 'critical';
  readonly category:
    | 'pii'
    | 'prompt_injection'
    | 'runaway_loop'
    | 'cost_overrun'
    | 'hallucination_flag';
  readonly evidence: Readonly<Record<string, unknown>>;
  readonly suggestedAction: 'warn' | 'redact' | 'abort';
}

export interface RiskDetector {
  readonly name: string;
  check(content: string, context: RiskContext): Promise<RiskResult>;
}

// ─── Permission Engine ──────────────────────────────────────────────

/**
 * One entry in the in-flight tool-call sequence delivered to
 * `PermissionChecker.check()` since v2.12. Lets sequence-aware
 * policies (exfil chain detection, idempotency limits, cost guards)
 * inspect what the agent has already dispatched this run.
 *
 * Derived from `scope.history` at check time — single source of truth,
 * survives `agent.resumeOnError(checkpoint)` correctly.
 */
export interface ToolCallEntry {
  /** Tool name dispatched. */
  readonly name: string;
  /** Tool args passed to `tool.execute(args, ctx)`. */
  readonly args: Readonly<Record<string, unknown>> | undefined;
  /** ReAct iteration the call was dispatched on. */
  readonly iteration: number;
  /**
   * Optional source identifier — `'local'` for tools registered via
   * `.tool(...)` / `staticTools(...)`, or the `ToolProvider.id` for
   * tools resolved through a `discoveryProvider`. Lets cross-hub
   * exfil rules match on origin, not just name.
   */
  readonly providerId?: string;
}

export interface PermissionRequest {
  readonly capability: 'tool_call' | 'memory_read' | 'memory_write' | 'external_net' | 'user_data';
  readonly actor: string;
  readonly target?: string;
  readonly context?: Readonly<Record<string, unknown>>;
  /**
   * v2.12 — Sequence of tool calls already dispatched this run, in
   * call order. EMPTY for non-`tool_call` capabilities. Sequence-aware
   * policies (forbidden chains, idempotency limits) read this to make
   * decisions that single-call governance cannot.
   */
  readonly sequence?: readonly ToolCallEntry[];
  /**
   * v2.12 — Full conversation history at check time. Lets policies
   * inspect prior assistant content / tool results without maintaining
   * parallel state via event subscription.
   */
  readonly history?: readonly LLMMessage[];
  /**
   * v2.12 — Current ReAct iteration (1-based). Lets policies fire
   * different rules per iteration without external counters.
   */
  readonly iteration?: number;
  /**
   * v2.12 — Caller identity from `agent.run({ identity })`. Permission
   * predicates can role-check on `identity.principal` / `identity.tenant`.
   */
  readonly identity?: {
    readonly tenant?: string;
    readonly principal?: string;
    readonly conversationId: string;
  };
  /**
   * v2.12 — Optional abort signal propagated from `agent.run({ env: { signal } })`.
   * Async checkers (Redis lookups, hub-backed allowlists) MUST honor this
   * — when the agent run is cancelled, in-flight checks should abort.
   */
  readonly signal?: AbortSignal;
}

/**
 * v2.12 — content shape mirroring `LLMMessage.content`. Future-compatible
 * with multi-modal `tool_result` blocks once `LLMMessage` widens.
 */
export type ToolResultContent = string;

export interface PermissionDecision {
  /**
   * v2.12 — `'halt'` is NEW. Terminates the run cleanly with a typed
   * `PolicyHaltError`. The framework writes a synthetic `tool_result`
   * (using `tellLLM`) to `scope.history` BEFORE throwing, so:
   *   • Anthropic / OpenAI tool_use ↔ tool_result pairing is satisfied
   *   • The conversation history is consistent for `resumeOnError`
   *   • Lens / `getNarrative()` shows what the LLM was told
   *
   * `'deny'` keeps existing semantics: synthetic tool_result + LLM
   * continues and can pick differently.
   */
  readonly result: 'allow' | 'deny' | 'halt' | 'gate_open';
  readonly policyRuleId?: string;
  readonly rationale?: string;
  readonly gateId?: string;
  /**
   * v2.12 — telemetry tag (machine-readable, stable across versions).
   * Surfaces on `agentfootprint.permission.halt.reason` for routing
   * alerts (e.g. `'security:exfiltration'` → PagerDuty,
   * `'cost:context-bloat'` → Slack channel).
   */
  readonly reason?: string;
  /**
   * v2.12 — content delivered to the LLM as the synthetic `tool_result`
   * on `'deny'` and `'halt'`. When omitted, defaults to a deliberately
   * generic `"Tool '${name}' is not available in this context."` —
   * NEVER falls back to `reason` (which is telemetry, not user-facing).
   */
  readonly tellLLM?: ToolResultContent;
}

export interface PermissionChecker {
  readonly name: string;
  check(request: PermissionRequest): Promise<PermissionDecision> | PermissionDecision;
}

// ─── Pricing Table ──────────────────────────────────────────────────

export type TokenKind = 'input' | 'output' | 'cacheRead' | 'cacheWrite';

export interface PricingTable {
  readonly name: string;
  /** USD per ONE token for the given model+kind. */
  pricePerToken(model: string, kind: TokenKind): number;
}
