/**
 * CostRecorder — calculates USD cost from AgentRecorder LLM call events.
 *
 * Stores data as Map<runtimeStageId, CostEntry> for O(1) lookup.
 */

import type { AgentRecorder, LLMCallEvent } from '../core';
import type { ModelPricing } from '../models/types';
export type { ModelPricing } from '../models/types';

export interface CostEntry {
  readonly model: string;
  readonly inputTokens: number;
  readonly outputTokens: number;
  readonly inputCost: number;
  readonly outputCost: number;
  readonly totalCost: number;
  readonly runtimeStageId?: string;
}

export interface CostRecorderOptions {
  readonly id?: string;
  /** Pricing per model (per 1M tokens). Models not in this table get $0 cost. */
  readonly pricingTable?: Record<string, ModelPricing>;
}

export class CostRecorder implements AgentRecorder {
  readonly id: string;
  private data = new Map<string, CostEntry>();
  private pricingTable: Record<string, ModelPricing>;
  private _autoKey = 0;

  constructor(options: CostRecorderOptions = {}) {
    this.id = options.id ?? 'cost-recorder';
    this.pricingTable = options.pricingTable ?? {};
  }

  onLLMCall(event: LLMCallEvent): void {
    const model = event.model ?? 'unknown';
    const inputTokens = event.usage?.inputTokens ?? 0;
    const outputTokens = event.usage?.outputTokens ?? 0;

    const pricing = this.pricingTable[model];
    const inputCost = pricing ? (inputTokens / 1_000_000) * pricing.input : 0;
    const outputCost = pricing ? (outputTokens / 1_000_000) * pricing.output : 0;

    const entry: CostEntry = {
      model,
      inputTokens,
      outputTokens,
      inputCost,
      outputCost,
      totalCost: inputCost + outputCost,
      runtimeStageId: event.runtimeStageId,
    };

    const key = event.runtimeStageId ?? `__auto_${this._autoKey++}`;
    this.data.set(key, entry);
  }

  /** O(1) lookup by runtimeStageId. */
  getByKey(runtimeStageId: string): CostEntry | undefined {
    return this.data.get(runtimeStageId);
  }

  getTotalCost(): number {
    let total = 0;
    for (const e of this.data.values()) total += e.totalCost;
    return total;
  }

  getEntries(): CostEntry[] {
    return [...this.data.values()];
  }

  clear(): void {
    this.data.clear();
    this._autoKey = 0;
  }
}
