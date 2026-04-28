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

// ─── Memory Store ────────────────────────────────────────────────────

export interface Memory {
  readonly id: string;
  readonly content: string;
  readonly embedding?: readonly number[];
  readonly metadata?: Readonly<Record<string, unknown>>;
  readonly createdAt: number;
}

export interface MemoryQuery {
  readonly text?: string;
  readonly embedding?: readonly number[];
  readonly topK: number;
  readonly filter?: Readonly<Record<string, unknown>>;
  readonly minScore?: number;
}

export interface ScoredMemory {
  readonly memory: Memory;
  readonly score: number;
}

export interface MemoryStore {
  readonly name: string;
  upsert(memories: readonly Memory[]): Promise<void>;
  query(q: MemoryQuery): Promise<readonly ScoredMemory[]>;
  delete(ids: readonly string[]): Promise<void>;
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

export interface PermissionRequest {
  readonly capability:
    | 'tool_call'
    | 'memory_read'
    | 'memory_write'
    | 'external_net'
    | 'user_data';
  readonly actor: string;
  readonly target?: string;
  readonly context?: Readonly<Record<string, unknown>>;
}

export interface PermissionDecision {
  readonly result: 'allow' | 'deny' | 'gate_open';
  readonly policyRuleId?: string;
  readonly rationale?: string;
  readonly gateId?: string;
}

export interface PermissionChecker {
  readonly name: string;
  check(request: PermissionRequest): Promise<PermissionDecision>;
}

// ─── Pricing Table ──────────────────────────────────────────────────

export type TokenKind = 'input' | 'output' | 'cacheRead' | 'cacheWrite';

export interface PricingTable {
  readonly name: string;
  /** USD per ONE token for the given model+kind. */
  pricePerToken(model: string, kind: TokenKind): number;
}
