/**
 * Provider interfaces — active strategies that shape what the LLM sees.
 * Like ScopeFactory in footprintjs — consumers swap implementations.
 */

import type { Message, ToolCall } from '../types/messages';
import type { LLMToolDescription } from '../types/llm';

// ── Context Types ───────────────────────────────────────────
// Read-only snapshots passed to providers so they can make decisions.

export interface PromptContext {
  /** Current user message. */
  readonly message: string;
  /** Which turn number this is (0-indexed). */
  readonly turnNumber: number;
  /** Full conversation history (for adaptive prompts). */
  readonly history: Message[];
  /** AbortSignal for cancellation (async prompt providers should respect this). */
  readonly signal?: AbortSignal;
}

export interface MessageContext {
  /** Current user message being processed. */
  readonly message: string;
  /** Which turn number this is. */
  readonly turnNumber: number;
  /** Current loop iteration within a turn (for tool loops). */
  readonly loopIteration: number;
  /** AbortSignal for cancellation. */
  readonly signal?: AbortSignal;
}

export interface ToolContext {
  /** Current user message. */
  readonly message: string;
  /** Which turn number this is. */
  readonly turnNumber: number;
  /** Current loop iteration within a turn. */
  readonly loopIteration: number;
  /** Messages so far (for context-dependent tool resolution). */
  readonly messages: Message[];
  /** AbortSignal for cancellation (dynamic tool resolution may need this). */
  readonly signal?: AbortSignal;
}

// ── Provider Interfaces ─────────────────────────────────────

/**
 * Resolves the system prompt for a given turn.
 * Static strings, templates, skill-based, or adaptive — all implement this.
 */
export interface PromptProvider {
  resolve(context: PromptContext): string | Promise<string>;
}

/**
 * Prepares the message array sent to the LLM each turn.
 * Full history, sliding window, smart summarize — all implement this.
 *
 * May return synchronously (simple strategies) or asynchronously
 * (strategies that call an LLM to summarize old messages).
 */
export interface MessageStrategy {
  prepare(history: Message[], context: MessageContext): Message[] | Promise<Message[]>;
}

/**
 * Resolves available tools and optionally executes tool calls.
 *
 * Two usage patterns:
 * - **Self-contained** (resolve + execute): provide both methods. The provider
 *   owns the full tool lifecycle. Use for simple static tools.
 * - **Resolver-only** (resolve only): omit `execute`. The core loop uses
 *   `ToolDefinition.handler` from the resolved set directly, or delegates
 *   to a separate executor (retry wrapper, circuit breaker).
 *   Use when resolution and execution are different concerns.
 *
 * Built-in providers (`staticTools`, `dynamicTools`, `noTools`) handle the
 * common cases. Implement `ToolProvider` directly for remote execution
 * (MCP servers, A2A agents, OpenAPI endpoints).
 */
export interface ToolProvider {
  /** Which tools to offer the LLM this turn. */
  resolve(context: ToolContext): LLMToolDescription[] | Promise<LLMToolDescription[]>;
  /** Execute a tool call. Optional — if omitted, core loop uses ToolDefinition.handler directly. */
  execute?(call: ToolCall, signal?: AbortSignal): Promise<ToolExecutionResult>;
}

// ── Tool Execution ──────────────────────────────────────────

export interface ToolExecutionResult {
  readonly content: string;
  readonly error?: boolean;
}
