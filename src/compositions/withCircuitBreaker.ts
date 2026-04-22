/**
 * withCircuitBreaker — wraps a RunnerLike with circuit breaker protection.
 *
 * Tracks consecutive failures. After `threshold` failures, the circuit
 * opens and all subsequent calls fail immediately (fast-fail) until
 * `resetAfterMs` has elapsed, at which point a single probe call is
 * allowed through (half-open state).
 *
 * States:
 *   CLOSED  → normal operation, counting failures
 *   OPEN    → fast-fail, no calls to runner
 *   HALF_OPEN → one probe call allowed; success → CLOSED, failure → OPEN
 *
 * Usage:
 *   const protected = withCircuitBreaker(fragileAgent, {
 *     threshold: 5,
 *     resetAfterMs: 30_000,
 *   });
 */

import type { RunnerLike } from '../types/multiAgent';

export type CircuitState = 'closed' | 'open' | 'half_open';

export interface CircuitBreakerOptions {
  /** Number of consecutive failures before opening. Default: 5. */
  readonly threshold?: number;
  /** How long to wait (ms) before trying a probe call. Default: 30000. */
  readonly resetAfterMs?: number;
}

export class CircuitBreaker {
  private state: CircuitState = 'closed';
  private failures = 0;
  private lastFailureTime = 0;
  private readonly threshold: number;
  private readonly resetAfterMs: number;

  constructor(options: CircuitBreakerOptions = {}) {
    this.threshold = options.threshold ?? 5;
    this.resetAfterMs = options.resetAfterMs ?? 30_000;
  }

  getState(): CircuitState {
    if (this.state === 'open') {
      if (Date.now() - this.lastFailureTime >= this.resetAfterMs) {
        this.state = 'half_open';
      }
    }
    return this.state;
  }

  recordSuccess(): void {
    this.failures = 0;
    this.state = 'closed';
  }

  recordFailure(): void {
    this.failures++;
    this.lastFailureTime = Date.now();
    if (this.failures >= this.threshold) {
      this.state = 'open';
    }
  }

  reset(): void {
    this.state = 'closed';
    this.failures = 0;
    this.lastFailureTime = 0;
  }
}

export function withCircuitBreaker(
  runner: RunnerLike,
  options: CircuitBreakerOptions = {},
): RunnerLike & { breaker: CircuitBreaker } {
  const breaker = new CircuitBreaker(options);

  const wrapped: RunnerLike & { breaker: CircuitBreaker } = {
    breaker,
    run: async (message, runOptions) => {
      const state = breaker.getState();

      if (state === 'open') {
        throw new Error('Circuit breaker is open');
      }

      try {
        const result = await runner.run(message, runOptions);
        breaker.recordSuccess();
        return result;
      } catch (err) {
        breaker.recordFailure();
        throw err;
      }
    },
    getNarrativeEntries: runner.getNarrativeEntries?.bind(runner),
    getSnapshot: runner.getSnapshot?.bind(runner),
  };

  return wrapped;
}
