/**
 * CostRecorder — calculates USD cost from AgentRecorder LLM call events.
 *
 * Extends KeyedRecorder<CostEntry> — Map keyed by runtimeStageId.
 */

import { KeyedRecorder } from 'footprintjs/trace';
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
  readonly runtimeStageId: string;
}

export interface CostRecorderOptions {
  readonly id?: string;
  readonly pricingTable?: Record<string, ModelPricing>;
}

export class CostRecorder extends KeyedRecorder<CostEntry> implements AgentRecorder {
  readonly id: string;
  private pricingTable: Record<string, ModelPricing>;

  constructor(options: CostRecorderOptions = {}) {
    super();
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

    this.store(event.runtimeStageId, {
      model,
      inputTokens,
      outputTokens,
      inputCost,
      outputCost,
      totalCost: inputCost + outputCost,
      runtimeStageId: event.runtimeStageId,
    });
  }

  getTotalCost(): number {
    let total = 0;
    for (const e of this.values()) total += e.totalCost;
    return total;
  }

  getEntries(): CostEntry[] {
    return this.values();
  }
}
