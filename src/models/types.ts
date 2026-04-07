/**
 * Model configuration types.
 * Factory functions return ModelConfig — adapters consume it.
 */

export interface ModelConfig {
  readonly provider: 'anthropic' | 'openai' | 'ollama' | 'bedrock' | 'mock';
  readonly modelId: string;
  readonly apiKey?: string;
  readonly baseUrl?: string;
  /** AWS region for Bedrock. Defaults to AWS_REGION env var. */
  readonly region?: string;
  readonly options?: ModelOptions;
}

export interface ModelOptions {
  readonly maxTokens?: number;
  readonly temperature?: number;
  readonly topP?: number;
  readonly stop?: string[];
}

/** Pricing per 1M tokens (USD). */
export interface ModelPricing {
  readonly input: number;
  readonly output: number;
}
