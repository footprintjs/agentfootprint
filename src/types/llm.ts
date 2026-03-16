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
}

export interface LLMResponse {
  readonly content: string;
  readonly toolCalls?: ToolCall[];
  readonly usage?: TokenUsage;
  readonly model?: string;
  readonly finishReason?: 'stop' | 'tool_calls' | 'length' | 'error';
}

export interface LLMStreamChunk {
  readonly type: 'token' | 'tool_call' | 'usage' | 'done';
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
