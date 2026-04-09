/**
 * TokenRecorder — tracks token usage and cost across LLM calls.
 *
 * Extends KeyedRecorder<LLMCallEntry> — Map keyed by runtimeStageId.
 * No fallbacks. runtimeStageId is always provided by footprintjs.
 */

import { KeyedRecorder } from 'footprintjs/trace';
import type { AgentRecorder, LLMCallEvent } from '../core';
import type { ModelPricing } from '../models/types';

export interface TokenRecorderOptions {
  id?: string;
  pricing?: Record<string, ModelPricing>;
}

export interface TokenStats {
  readonly totalCalls: number;
  readonly totalInputTokens: number;
  readonly totalOutputTokens: number;
  readonly totalLatencyMs: number;
  readonly averageLatencyMs: number;
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
  readonly cost: number;
  readonly runtimeStageId: string;
}

export class TokenRecorder extends KeyedRecorder<LLMCallEntry> implements AgentRecorder {
  readonly id: string;
  private readonly pricing: Record<string, ModelPricing>;

  constructor(options?: TokenRecorderOptions | string) {
    super();
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

    this.store(event.runtimeStageId, {
      model,
      inputTokens,
      outputTokens,
      latencyMs: event.latencyMs,
      turnNumber: event.turnNumber,
      loopIteration: event.loopIteration,
      cost,
      runtimeStageId: event.runtimeStageId,
    });
  }

  getStats(): TokenStats {
    const calls = this.values();
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
    for (const c of this.values()) total += c.inputTokens + c.outputTokens;
    return total;
  }
}
