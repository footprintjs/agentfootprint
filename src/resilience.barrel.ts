/**
 * agentfootprint/resilience — Make agents reliable.
 *
 * Retry, fallback, circuit breaker, cross-family provider failover.
 *
 * @example
 * ```typescript
 * import { withRetry, resilientProvider } from 'agentfootprint/resilience';
 *
 * const reliable = withRetry(agent, { maxRetries: 3 });
 * const provider = resilientProvider([anthropicAdapter, openaiAdapter]);
 * ```
 */

export { withRetry, withFallback, withCircuitBreaker, CircuitBreaker } from './compositions';
export type {
  RetryOptions,
  FallbackOptions,
  CircuitBreakerOptions,
  CircuitState,
} from './compositions';
export { resilientProvider, fallbackProvider } from './adapters';
export type { ResilientProviderOptions, FallbackProviderOptions } from './adapters';
export { classifyStatusCode, wrapSDKError } from './types';
