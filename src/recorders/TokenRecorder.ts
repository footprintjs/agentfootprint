/**
 * TokenRecorder — tracks token usage and cost across LLM calls.
 *
 * Implements AgentRecorder. Observes onLLMCall events and accumulates
 * input/output token counts, call count, latency stats, and per-call cost.
 *
 * Usage:
 *   const tokens = new TokenRecorder();
 *   agent.recorder(tokens);
 *   await agent.run(...);
 *   console.log(tokens.getStats());
 *
 * With pricing:
 *   const tokens = new TokenRecorder({ pricing: { 'claude-sonnet-4-20250514': { input: 3, output: 15 } } });
 */

import type { AgentRecorder, LLMCallEvent } from '../core';
import type { ModelPricing } from '../models/types';

export interface TokenRecorderOptions {
  /** Recorder ID. Default: 'token-recorder'. */
  id?: string;
  /** Pricing table (per 1M tokens, USD). Models not listed get $0. */
  pricing?: Record<string, ModelPricing>;
}

export interface TokenStats {
  readonly totalCalls: number;
  readonly totalInputTokens: number;
  readonly totalOutputTokens: number;
  readonly totalLatencyMs: number;
  readonly averageLatencyMs: number;
  /** Total estimated cost in USD. 0 if no pricing table provided. */
  readonly totalCost: number;
  readonly calls: LLMCallEntry[];
}

export interface LLMCallEntry {
  readonly model: string;
  readonly inputTokens: number;
  readonly outputTokens: number;
  readonly latencyMs: number;
  readonly turnNumber: number;
  readonly loopIteration: number;
  /** Estimated cost in USD for this call. 0 if model not in pricing table. */
  readonly cost: number;
}

export class TokenRecorder implements AgentRecorder {
  readonly id: string;
  private calls: LLMCallEntry[] = [];
  private readonly pricing: Record<string, ModelPricing>;

  constructor(options?: TokenRecorderOptions | string) {
    if (typeof options === 'string') {
      // Backward compat: new TokenRecorder('my-id')
      this.id = options;
      this.pricing = {};
    } else {
      this.id = options?.id ?? 'token-recorder';
      this.pricing = options?.pricing ?? {};
    }
  }

  onLLMCall(event: LLMCallEvent): void {
    const model = event.model ?? 'unknown';
    const inputTokens = event.usage?.inputTokens ?? 0;
    const outputTokens = event.usage?.outputTokens ?? 0;
    const p = this.pricing[model];
    const cost = p
      ? (inputTokens / 1_000_000) * p.input + (outputTokens / 1_000_000) * p.output
      : 0;

    this.calls.push({
      model,
      inputTokens,
      outputTokens,
      latencyMs: event.latencyMs,
      turnNumber: event.turnNumber,
      loopIteration: event.loopIteration,
      cost,
    });
  }

  getStats(): TokenStats {
    const totalCalls = this.calls.length;
    const totalInputTokens = this.calls.reduce((s, c) => s + c.inputTokens, 0);
    const totalOutputTokens = this.calls.reduce((s, c) => s + c.outputTokens, 0);
    const totalLatencyMs = this.calls.reduce((s, c) => s + c.latencyMs, 0);
    const totalCost = this.calls.reduce((s, c) => s + c.cost, 0);

    return {
      totalCalls,
      totalInputTokens,
      totalOutputTokens,
      totalLatencyMs,
      averageLatencyMs: totalCalls > 0 ? Math.round(totalLatencyMs / totalCalls) : 0,
      totalCost,
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
