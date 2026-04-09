/**
 * TokenRecorder — tracks token usage and cost across LLM calls.
 *
 * Stores data as Map<runtimeStageId, LLMCallEntry> for O(1) lookup.
 * Flat accessors (getStats, calls[]) preserved for backward compatibility.
 *
 * Usage:
 *   const tokens = new TokenRecorder();
 *   agent.recorder(tokens);
 *   await agent.run(...);
 *   console.log(tokens.getStats());        // aggregated totals
 *   console.log(tokens.getByKey('call-llm#5'));  // per-stage lookup
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
  /** Unique execution step identifier for key-value lookup. */
  readonly runtimeStageId?: string;
}

export class TokenRecorder implements AgentRecorder {
  readonly id: string;
  private data = new Map<string, LLMCallEntry>();
  private readonly pricing: Record<string, ModelPricing>;
  private _autoKey = 0;

  constructor(options?: TokenRecorderOptions | string) {
    if (typeof options === 'string') {
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

    const entry: LLMCallEntry = {
      model,
      inputTokens,
      outputTokens,
      latencyMs: event.latencyMs,
      turnNumber: event.turnNumber,
      loopIteration: event.loopIteration,
      cost,
      runtimeStageId: event.runtimeStageId,
    };

    const key = event.runtimeStageId ?? `__auto_${this._autoKey++}`;
    this.data.set(key, entry);
  }

  /** O(1) lookup by runtimeStageId. */
  getByKey(runtimeStageId: string): LLMCallEntry | undefined {
    return this.data.get(runtimeStageId);
  }

  /** All entries as a Map (insertion-ordered). */
  getMap(): ReadonlyMap<string, LLMCallEntry> {
    return this.data;
  }

  /** Aggregated stats (backward compatible). */
  getStats(): TokenStats {
    const calls = [...this.data.values()];
    const totalCalls = calls.length;
    const totalInputTokens = calls.reduce((s, c) => s + c.inputTokens, 0);
    const totalOutputTokens = calls.reduce((s, c) => s + c.outputTokens, 0);
    const totalLatencyMs = calls.reduce((s, c) => s + c.latencyMs, 0);
    const totalCost = calls.reduce((s, c) => s + c.cost, 0);

    return {
      totalCalls,
      totalInputTokens,
      totalOutputTokens,
      totalLatencyMs,
      averageLatencyMs: totalCalls > 0 ? Math.round(totalLatencyMs / totalCalls) : 0,
      totalCost,
      calls,
    };
  }

  getTotalTokens(): number {
    let total = 0;
    for (const c of this.data.values()) total += c.inputTokens + c.outputTokens;
    return total;
  }

  clear(): void {
    this.data.clear();
    this._autoKey = 0;
  }
}
