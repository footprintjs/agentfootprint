/**
 * compositions/ — Orchestration wrappers composed from existing primitives.
 *
 * These are NOT new concepts — they wrap RunnerLike with cross-cutting
 * concerns (retry, fallback, circuit breaker) without changing core.
 */

export { withRetry } from './withRetry';
export type { RetryOptions } from './withRetry';
export { withFallback } from './withFallback';
export type { FallbackOptions } from './withFallback';
export { withCircuitBreaker, CircuitBreaker } from './withCircuitBreaker';
export type { CircuitBreakerOptions, CircuitState } from './withCircuitBreaker';
