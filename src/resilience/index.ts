/**
 * agentfootprint/resilience — provider decorators for production reliability.
 *
 * Three composable wrappers around `LLMProvider`. Each preserves the
 * `LLMProvider` interface (drop-in replacement) and stacks freely:
 *
 *   const provider = withRetry(
 *     fallbackProvider(
 *       anthropic({ apiKey }),
 *       openai({ apiKey }),
 *     ),
 *     { maxAttempts: 5 },
 *   );
 *
 * Reads as: try anthropic; on failure fall back to openai; the whole
 * chain is wrapped in retry with 5 attempts.
 */

export { withRetry, type WithRetryOptions } from './withRetry.js';
export { withFallback, type WithFallbackOptions } from './withFallback.js';
export { fallbackProvider, type FallbackProviderOptions } from './fallbackProvider.js';
