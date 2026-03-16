/**
 * TokenRecorder — tracks token usage across LLM calls.
 *
 * Implements AgentRecorder. Observes onLLMCall events and accumulates
 * input/output token counts, call count, and latency stats.
 *
 * Usage:
 *   const tokens = new TokenRecorder();
 *   agent.recorder(tokens);
 *   await agent.run(...);
 *   console.log(tokens.getStats());
 */

import type { AgentRecorder, LLMCallEvent } from '../../core';

export interface TokenStats {
  readonly totalCalls: number;
  readonly totalInputTokens: number;
  readonly totalOutputTokens: number;
  readonly totalLatencyMs: number;
  readonly averageLatencyMs: number;
  readonly calls: LLMCallEntry[];
}

export interface LLMCallEntry {
  readonly model: string;
  readonly inputTokens: number;
  readonly outputTokens: number;
  readonly latencyMs: number;
  readonly turnNumber: number;
  readonly loopIteration: number;
}

export class TokenRecorder implements AgentRecorder {
  readonly id: string;
  private calls: LLMCallEntry[] = [];

  constructor(id = 'token-recorder') {
    this.id = id;
  }

  onLLMCall(event: LLMCallEvent): void {
    this.calls.push({
      model: event.model ?? 'unknown',
      inputTokens: event.usage?.inputTokens ?? 0,
      outputTokens: event.usage?.outputTokens ?? 0,
      latencyMs: event.latencyMs,
      turnNumber: event.turnNumber,
      loopIteration: event.loopIteration,
    });
  }

  getStats(): TokenStats {
    const totalCalls = this.calls.length;
    const totalInputTokens = this.calls.reduce((s, c) => s + c.inputTokens, 0);
    const totalOutputTokens = this.calls.reduce((s, c) => s + c.outputTokens, 0);
    const totalLatencyMs = this.calls.reduce((s, c) => s + c.latencyMs, 0);

    return {
      totalCalls,
      totalInputTokens,
      totalOutputTokens,
      totalLatencyMs,
      averageLatencyMs: totalCalls > 0 ? Math.round(totalLatencyMs / totalCalls) : 0,
      calls: [...this.calls],
    };
  }

  getTotalTokens(): number {
    return this.calls.reduce((s, c) => s + c.inputTokens + c.outputTokens, 0);
  }

  clear(): void {
    this.calls = [];
  }
}
