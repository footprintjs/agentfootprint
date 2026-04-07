/**
 * Provider-agnostic LLM interface.
 * No SDK dependency — consumers implement for their provider.
 */

import type { StreamCallback } from './content';
import type { Message, ToolCall } from './messages';

export interface LLMProvider {
  /** Send messages and get a response. */
  chat(messages: Message[], options?: LLMCallOptions): Promise<LLMResponse>;

  /** Stream response token-by-token. Optional — not all providers support it. */
  chatStream?(messages: Message[], options?: LLMCallOptions): AsyncIterable<LLMStreamChunk>;
}

export interface LLMCallOptions {
  /** Tool descriptions for function calling. */
  readonly tools?: LLMToolDescription[];
  /** Max tokens in response. */
  readonly maxTokens?: number;
  /** Temperature (0-1). */
  readonly temperature?: number;
  /** Stop sequences. */
  readonly stop?: string[];
  /** AbortSignal for cancellation. */
  readonly signal?: AbortSignal;
  /** Callback for streaming tokens incrementally. When provided, the LLM provider should emit chunks as they arrive. */
  readonly streamCallback?: StreamCallback;
  /**
   * Request structured JSON output matching a schema.
   * Each adapter handles this differently:
   * - OpenAI: passes as native `response_format`
   * - Anthropic: injects schema into system prompt + validates
   * - Custom: adapter decides the strategy
   */
  readonly responseFormat?: ResponseFormat;
}

/** Structured output format request. */
export interface ResponseFormat {
  readonly type: 'json_schema';
  /** JSON Schema the response must conform to. */
  readonly schema: Record<string, unknown>;
  /** Optional name for the schema (used by OpenAI's API). */
  readonly name?: string;
  /**
   * Where to inject the schema instruction for providers without native support (e.g., Anthropic).
   * - `'system'` — append to system prompt (default)
   * - `'user'` — inject as the last user message (recency window — higher LLM attention)
   *
   * OpenAI ignores this — it uses native `response_format`.
   */
  readonly injection?: 'system' | 'user';
}

/** Normalized finish reason across all providers. */
export type FinishReason = 'stop' | 'tool_calls' | 'length' | 'error';

export interface LLMResponse {
  readonly content: string;
  readonly toolCalls?: ToolCall[];
  readonly usage?: TokenUsage;
  readonly model?: string;
  readonly finishReason?: FinishReason;
  /** Extended thinking text. Present when the model uses extended thinking (e.g., Anthropic with thinking enabled). Requires provider-specific configuration. */
  readonly thinking?: string;
}

export interface LLMStreamChunk {
  readonly type: 'token' | 'thinking' | 'tool_call' | 'usage' | 'done';
  readonly content?: string;
  readonly toolCall?: ToolCall;
  readonly usage?: TokenUsage;
}

export interface TokenUsage {
  readonly inputTokens: number;
  readonly outputTokens: number;
  readonly totalTokens?: number;
}

export interface LLMToolDescription {
  readonly name: string;
  readonly description: string;
  readonly inputSchema: Record<string, unknown>;
}
