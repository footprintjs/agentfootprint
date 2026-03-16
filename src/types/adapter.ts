/**
 * Adapter result — discriminated union for provider responses.
 * Adapters normalize any provider's response into one of these shapes.
 */

import type { ToolCall, TokenUsage } from './index';

/** LLM returned a final text response. */
export interface AdapterFinalResult {
  readonly type: 'final';
  readonly content: string;
  readonly usage?: TokenUsage;
  readonly model?: string;
}

/** LLM requested tool calls. */
export interface AdapterToolResult {
  readonly type: 'tools';
  readonly content: string;
  readonly toolCalls: ToolCall[];
  readonly usage?: TokenUsage;
  readonly model?: string;
}

/** LLM call failed. */
export interface AdapterErrorResult {
  readonly type: 'error';
  readonly code: string;
  readonly message: string;
  readonly retryable: boolean;
  readonly originalError?: unknown;
}

export type AdapterResult = AdapterFinalResult | AdapterToolResult | AdapterErrorResult;

/** Well-known scope paths for adapter stages. */
export const ADAPTER_PATHS = {
  REQUEST: 'adapterRequest',
  RESPONSE: 'adapterRawResponse',
  RESULT: 'adapterResult',
} as const;
