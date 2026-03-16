/**
 * Recorder interface — passive observers that watch but don't shape behavior.
 * Like Recorder/FlowRecorder in footprintjs.
 */

import type { LLMResponse, TokenUsage } from '../types/llm';
import type { ToolExecutionResult } from './providers';

// ── Recorder Interface ──────────────────────────────────────

/**
 * Observes agent execution events without changing behavior.
 * Metrics, cost tracking, quality evaluation — all implement this.
 *
 * All hooks are optional. Implement only what you need.
 * Like footprintjs FlowRecorder: `{ id, optional hooks }`.
 */
export interface AgentRecorder {
  readonly id: string;
  onTurnStart?(event: TurnStartEvent): void;
  onLLMCall?(event: LLMCallEvent): void;
  onToolCall?(event: ToolCallEvent): void;
  onTurnComplete?(event: TurnCompleteEvent): void;
  onError?(event: AgentErrorEvent): void;
  clear?(): void;
}

// ── Event Types ─────────────────────────────────────────────

export interface TurnStartEvent {
  readonly turnNumber: number;
  readonly message: string;
}

export interface LLMCallEvent {
  readonly model?: string;
  readonly usage?: TokenUsage;
  readonly latencyMs: number;
  readonly turnNumber: number;
  readonly loopIteration: number;
  readonly finishReason?: LLMResponse['finishReason'];
}

export interface ToolCallEvent {
  readonly toolName: string;
  readonly args: Record<string, unknown>;
  readonly result: ToolExecutionResult;
  readonly latencyMs: number;
}

export interface TurnCompleteEvent {
  readonly turnNumber: number;
  readonly messageCount: number;
  readonly totalLoopIterations: number;
  readonly content: string;
}

export interface AgentErrorEvent {
  readonly phase: 'prompt' | 'llm' | 'tool' | 'message';
  readonly error: unknown;
  readonly turnNumber: number;
}
