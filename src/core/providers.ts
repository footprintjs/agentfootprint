/**
 * Provider interfaces — active strategies that shape what the LLM sees.
 *
 * Every provider resolves a value AND explains its decision via SlotDecision<T>.
 * The decision (chosen + rationale) appears in the narrative — making every
 * strategy choice explainable.
 *
 * @example
 * ```typescript
 * // Static provider — always returns the same value
 * { value: 'You are helpful.', chosen: 'static' }
 *
 * // Dynamic provider — changes based on conversation state
 * { value: [...adminTools], chosen: 'elevated', rationale: 'identity verified' }
 * ```
 */

import type { Message, ToolCall } from '../types/messages';
import type { LLMToolDescription } from '../types/llm';

// ── SlotDecision ───────────────────────────────────────────
// Unified return type for all slot resolvers.
// Same vocabulary as footprintjs FlowDecisionEvent (chosen + rationale).

/**
 * Every slot resolver returns a value AND a decision explanation.
 *
 * - `value`: the resolved output (tools, prompt, messages)
 * - `chosen`: label for what was selected — shown in narrative
 * - `rationale`: why this choice was made — shown in narrative
 *
 * The narrative renders: `"Chose {chosen} ({rationale})"`
 *
 * @example
 * ```typescript
 * // Simple static decision
 * { value: 'You are helpful.', chosen: 'static' }
 *
 * // Dynamic decision based on conversation state
 * {
 *   value: [...basicTools, ...adminTools],
 *   chosen: 'elevated',
 *   rationale: 'identity verified in previous turn',
 * }
 *
 * // Message strategy decision
 * {
 *   value: keptMessages,
 *   chosen: 'sliding-window',
 *   rationale: 'kept 12 of 45 messages',
 * }
 * ```
 */
export interface SlotDecision<T> {
  /** The resolved value. */
  readonly value: T;
  /** What was chosen — shown as decision label in narrative. */
  readonly chosen: string;
  /** Why this was chosen — shown as rationale in narrative. Optional for static providers. */
  readonly rationale?: string;
}

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
 *
 * Returns `SlotDecision<string>` — the prompt text + why this prompt was chosen.
 * Static providers return `chosen: 'static'`. Dynamic providers explain the reason.
 *
 * @example
 * ```typescript
 * const dynamicPrompt: PromptProvider = {
 *   resolve: (ctx) => {
 *     const hasFlaggedOrder = ctx.history.some(m => m.content?.includes('flagged'));
 *     if (hasFlaggedOrder) {
 *       return { value: escalationPrompt, chosen: 'escalation', rationale: 'flagged order detected' };
 *     }
 *     return { value: basicPrompt, chosen: 'standard' };
 *   },
 * };
 * ```
 */
export interface PromptProvider {
  resolve(context: PromptContext): SlotDecision<string> | Promise<SlotDecision<string>>;
}

/**
 * Prepares the message array sent to the LLM each turn.
 *
 * Returns `SlotDecision<Message[]>` — the prepared messages + strategy label.
 *
 * @example
 * ```typescript
 * const strategy: MessageStrategy = {
 *   prepare: (history, ctx) => {
 *     if (history.length > 50) {
 *       const kept = history.slice(-20);
 *       return { value: kept, chosen: 'truncated', rationale: `kept 20 of ${history.length}` };
 *     }
 *     return { value: history, chosen: 'full', rationale: `${history.length} messages` };
 *   },
 * };
 * ```
 */
export interface MessageStrategy {
  prepare(
    history: Message[],
    context: MessageContext,
  ): SlotDecision<Message[]> | Promise<SlotDecision<Message[]>>;
}

/**
 * Resolves available tools and optionally executes tool calls.
 *
 * Returns `SlotDecision<LLMToolDescription[]>` — the tool set + decision.
 *
 * @example
 * ```typescript
 * const dynamicTools: ToolProvider = {
 *   resolve: (ctx) => {
 *     const verified = ctx.messages.some(m =>
 *       m.role === 'tool' && m.content.includes('"verified":true'));
 *     if (verified) {
 *       return { value: [...basic, ...admin], chosen: 'elevated', rationale: 'identity verified' };
 *     }
 *     return { value: basic, chosen: 'basic', rationale: 'standard access' };
 *   },
 * };
 * ```
 */
export interface ToolProvider {
  /** Which tools to offer the LLM this turn. */
  resolve(
    context: ToolContext,
  ): SlotDecision<LLMToolDescription[]> | Promise<SlotDecision<LLMToolDescription[]>>;
  /** Execute a tool call. Optional — if omitted, core loop uses ToolDefinition.handler directly. */
  execute?(call: ToolCall, signal?: AbortSignal): Promise<ToolExecutionResult>;
}

// ── Tool Execution ──────────────────────────────────────────

export interface ToolExecutionResult {
  readonly content: string;
  readonly error?: boolean;
}
