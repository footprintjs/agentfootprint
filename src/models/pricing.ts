/**
 * Default pricing tables per model (USD per 1M tokens).
 * Used by CostRecorder for automatic cost calculation.
 */

import type { ModelPricing } from './types';

export const DEFAULT_PRICING: Record<string, ModelPricing> = {
  // Anthropic
  'claude-opus-4-20250514': { input: 15, output: 75 },
  'claude-sonnet-4-20250514': { input: 3, output: 15 },
  'claude-haiku-4-5-20251001': { input: 0.8, output: 4 },

  // OpenAI
  'gpt-4o': { input: 2.5, output: 10 },
  'gpt-4o-mini': { input: 0.15, output: 0.6 },
  'gpt-4-turbo': { input: 10, output: 30 },
  o1: { input: 15, output: 60 },
  'o1-mini': { input: 3, output: 12 },

  // Google
  'gemini-2.0-flash': { input: 0.1, output: 0.4 },
  'gemini-1.5-pro': { input: 1.25, output: 5 },
};

export function lookupPricing(modelId: string): ModelPricing | undefined {
  return DEFAULT_PRICING[modelId];
}
