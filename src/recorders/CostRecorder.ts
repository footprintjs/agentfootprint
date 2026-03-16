/**
 * CostRecorder — calculates USD cost based on token counts + per-model pricing.
 */

import type { ModelPricing } from '../models';
import { lookupPricing } from '../models';
import { ADAPTER_PATHS } from '../types';

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
  /** Custom pricing overrides (per 1M tokens). */
  readonly pricingTable?: Record<string, ModelPricing>;
}

export class CostRecorder {
  readonly id: string;
  private entries: CostEntry[] = [];
  private customPricing: Record<string, ModelPricing>;

  constructor(options: CostRecorderOptions = {}) {
    this.id = options.id ?? 'cost-recorder';
    this.customPricing = options.pricingTable ?? {};
  }

  onWrite(event: { key: string; value: unknown }): void {
    if (event.key === ADAPTER_PATHS.RESPONSE || event.key === ADAPTER_PATHS.RESULT) {
      const val = event.value as Record<string, unknown> | undefined;
      if (!val) return;

      const model = (val.model as string) ?? 'unknown';
      const usage = val.usage as { inputTokens?: number; outputTokens?: number } | undefined;

      const inputTokens = usage?.inputTokens ?? 0;
      const outputTokens = usage?.outputTokens ?? 0;

      const pricing = this.customPricing[model] ?? lookupPricing(model);
      if (!pricing) {
        this.entries.push({
          model,
          inputTokens,
          outputTokens,
          inputCost: 0,
          outputCost: 0,
          totalCost: 0,
        });
        return;
      }

      // Pricing is per 1M tokens
      const inputCost = (inputTokens / 1_000_000) * pricing.input;
      const outputCost = (outputTokens / 1_000_000) * pricing.output;

      this.entries.push({
        model,
        inputTokens,
        outputTokens,
        inputCost,
        outputCost,
        totalCost: inputCost + outputCost,
      });
    }
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
