/**
 * CostRecorder (v2) — calculates USD cost from AgentRecorder LLM call events.
 *
 * Unlike the v1 CostRecorder (which observes scope writes), this one
 * receives structured LLMCallEvent objects from the core loop.
 *
 * Usage:
 *   const cost = new CostRecorder({ pricingTable: { 'claude-sonnet': { input: 3, output: 15 } } });
 *   agent.recorder(cost);
 *   await agent.run(...);
 *   console.log(`$${cost.getTotalCost().toFixed(4)}`);
 */

import type { AgentRecorder, LLMCallEvent } from '../../core';

export interface ModelPricing {
  /** Cost per 1M input tokens in USD. */
  readonly input: number;
  /** Cost per 1M output tokens in USD. */
  readonly output: number;
}

export interface CostEntry {
  readonly model: string;
  readonly inputTokens: number;
  readonly outputTokens: number;
  readonly inputCost: number;
  readonly outputCost: number;
  readonly totalCost: number;
}

export interface CostRecorderOptions {
  readonly id?: string;
  /** Pricing per model (per 1M tokens). Models not in this table get $0 cost. */
  readonly pricingTable?: Record<string, ModelPricing>;
}

export class CostRecorder implements AgentRecorder {
  readonly id: string;
  private entries: CostEntry[] = [];
  private pricingTable: Record<string, ModelPricing>;

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

    this.entries.push({
      model,
      inputTokens,
      outputTokens,
      inputCost,
      outputCost,
      totalCost: inputCost + outputCost,
    });
  }

  getTotalCost(): number {
    return this.entries.reduce((s, e) => s + e.totalCost, 0);
  }

  getEntries(): CostEntry[] {
    return [...this.entries];
  }

  clear(): void {
    this.entries = [];
  }
}
