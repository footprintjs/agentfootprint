/**
 * withCircuitBreaker — provider decorator that fails fast after N
 * consecutive failures.
 *
 * Pattern: Circuit Breaker (Nygard, *Release It!*) — wraps an
 *          `LLMProvider` and tracks consecutive failures. After
 *          `failureThreshold` failures, the breaker OPENS and
 *          rejects all calls without invoking the wrapped provider.
 *          After `cooldownMs`, the breaker enters HALF-OPEN and
 *          allows probe calls; success closes the breaker, failure
 *          re-opens it.
 *
 * Role:    Outer ring (Hexagonal). Composes with `withRetry` and
 *          `withFallback`:
 *
 *          ```
 *          withFallback(
 *            withCircuitBreaker(anthropic(...)),  // ← stop hammering on outage
 *            withCircuitBreaker(openai(...)),
 *          )
 *          ```
 *
 *          When Anthropic 503s for the 5th time, the breaker opens
 *          and `complete()` throws `CircuitOpenError` immediately —
 *          no network round-trip — which `withFallback` then
 *          catches and routes to OpenAI. After 30 seconds the
 *          breaker probes Anthropic with a single call; if it
 *          succeeds, normal operation resumes.
 *
 * Why a circuit breaker on top of `withRetry`?
 *   - `withRetry` keeps hammering one provider with exponential
 *     backoff — it doesn't know the vendor is down.
 *   - During a multi-minute Anthropic outage, every request still
 *     burns 3 retries + backoff = ~3 sec of latency before failing
 *     to the fallback. Multiplied by your QPS, that's a lot of
 *     wasted time + tokens (some retries DO get billed).
 *   - The breaker says: "we just saw 5 failures in a row; stop
 *     calling for 30 seconds." Subsequent requests fail in <1ms,
 *     `withFallback` routes immediately to OpenAI.
 *
 * Three states:
 *
 *     CLOSED ──[ N consecutive failures ]──► OPEN
 *        ▲                                    │
 *        │                                    │ [cooldownMs elapsed]
 *        │                                    ▼
 *        └──[ M probe successes ]──── HALF-OPEN
 *
 *     HALF-OPEN ──[ probe failure ]──► OPEN (cooldown restarts)
 *
 * `stream()` is decorated identically. `name`/`flush`/`stop` pass
 * through unchanged (the consumer's existing observability hooks
 * still see the underlying provider's identity).
 */

import type { LLMChunk, LLMProvider, LLMRequest, LLMResponse } from '../adapters/types.js';

// ─── Public options ──────────────────────────────────────────────────

export interface WithCircuitBreakerOptions {
  /** Consecutive failures before the breaker OPENS. Default 5. */
  readonly failureThreshold?: number;
  /** How long the breaker stays OPEN before probing. Default 30s. */
  readonly cooldownMs?: number;
  /** Successes required in HALF-OPEN to fully CLOSE. Default 2. */
  readonly halfOpenSuccessThreshold?: number;
  /**
   * Predicate — does this error count toward the threshold? Default:
   * everything except AbortError counts. Override to ignore client
   * errors (e.g., 4xx) so a malformed request doesn't trip the
   * breaker for everyone.
   */
  readonly shouldCount?: (error: unknown) => boolean;
  /** Hook invoked on every state transition. Useful for emitting
   *  `agentfootprint.resilience.circuit_state_changed`. */
  readonly onStateChange?: (state: CircuitState, reason: string) => void;
}

export type CircuitState = 'closed' | 'open' | 'half-open';

// ─── Public error type ───────────────────────────────────────────────

/**
 * Thrown by the wrapped provider when the breaker is OPEN. Carries
 * the underlying root-cause error from the most recent failure so
 * consumers can observe what tripped the breaker.
 */
export class CircuitOpenError extends Error {
  readonly code = 'ERR_CIRCUIT_OPEN' as const;
  /** The error that tripped the breaker (or the most recent failure
   *  during HALF-OPEN that re-opened it). */
  readonly cause: unknown;
  /** Wall-clock timestamp at which the breaker may next probe. */
  readonly retryAfter: number;
  constructor(providerName: string, cause: unknown, retryAfter: number) {
    super(
      `[${providerName}] circuit breaker is OPEN — failing fast (next probe at ${new Date(
        retryAfter,
      ).toISOString()}). Underlying error: ${
        (cause as { message?: string })?.message ?? String(cause)
      }`,
    );
    this.name = 'CircuitOpenError';
    this.cause = cause;
    this.retryAfter = retryAfter;
  }
}

// ─── Implementation ──────────────────────────────────────────────────

interface BreakerState {
  state: CircuitState;
  consecutiveFailures: number;
  consecutiveSuccesses: number; // only counted in HALF-OPEN
  openedAt: number;
  lastError: unknown;
}

/**
 * Wrap a provider with a circuit breaker.
 *
 * @example
 * ```ts
 * import { anthropic, openai } from 'agentfootprint/llm-providers';
 * import { withCircuitBreaker, withFallback } from 'agentfootprint/resilience';
 *
 * const provider = withFallback(
 *   withCircuitBreaker(anthropic({ apiKey }), { failureThreshold: 5, cooldownMs: 30_000 }),
 *   withCircuitBreaker(openai({ apiKey })),
 * );
 * ```
 */
export function withCircuitBreaker(
  inner: LLMProvider,
  options: WithCircuitBreakerOptions = {},
): LLMProvider {
  const failureThreshold = options.failureThreshold ?? 5;
  const cooldownMs = options.cooldownMs ?? 30_000;
  const halfOpenSuccessThreshold = options.halfOpenSuccessThreshold ?? 2;
  const shouldCount = options.shouldCount ?? defaultShouldCount;
  const onStateChange = options.onStateChange;

  const breaker: BreakerState = {
    state: 'closed',
    consecutiveFailures: 0,
    consecutiveSuccesses: 0,
    openedAt: 0,
    lastError: undefined,
  };

  function transition(next: CircuitState, reason: string): void {
    if (breaker.state === next) return;
    breaker.state = next;
    if (next === 'open') {
      breaker.openedAt = Date.now();
      breaker.consecutiveSuccesses = 0;
    } else if (next === 'half-open') {
      breaker.consecutiveSuccesses = 0;
    } else if (next === 'closed') {
      breaker.consecutiveFailures = 0;
      breaker.consecutiveSuccesses = 0;
      breaker.lastError = undefined;
    }
    onStateChange?.(next, reason);
  }

  /** Decide whether to admit a call. Mutates state if cooldown
   *  elapsed (open → half-open). Returns true to admit, false to
   *  reject with CircuitOpenError. */
  function admit(): boolean {
    if (breaker.state === 'closed' || breaker.state === 'half-open') return true;
    // OPEN — check cooldown.
    if (Date.now() - breaker.openedAt >= cooldownMs) {
      transition('half-open', 'cooldown elapsed');
      return true;
    }
    return false;
  }

  function recordSuccess(): void {
    if (breaker.state === 'half-open') {
      breaker.consecutiveSuccesses += 1;
      if (breaker.consecutiveSuccesses >= halfOpenSuccessThreshold) {
        transition('closed', `${halfOpenSuccessThreshold} probe successes`);
      }
    } else if (breaker.state === 'closed') {
      // Successful call resets the failure counter.
      breaker.consecutiveFailures = 0;
    }
  }

  function recordFailure(err: unknown): void {
    if (!shouldCount(err)) return;
    breaker.lastError = err;
    if (breaker.state === 'half-open') {
      // Probe failed — re-open the breaker.
      transition('open', 'half-open probe failed');
      return;
    }
    if (breaker.state === 'closed') {
      breaker.consecutiveFailures += 1;
      if (breaker.consecutiveFailures >= failureThreshold) {
        transition('open', `${breaker.consecutiveFailures} consecutive failures`);
      }
    }
  }

  function rejectFastIfOpen(): void {
    if (!admit()) {
      throw new CircuitOpenError(inner.name, breaker.lastError, breaker.openedAt + cooldownMs);
    }
  }

  const wrapped: LLMProvider = {
    name: inner.name,
    async complete(req: LLMRequest): Promise<LLMResponse> {
      rejectFastIfOpen();
      try {
        const res = await inner.complete(req);
        recordSuccess();
        return res;
      } catch (err) {
        recordFailure(err);
        throw err;
      }
    },
    // `stream` is optional on `LLMProvider`. Only define our wrapper
    // if the underlying provider supports streaming — otherwise leave
    // it undefined so the consumer's existing capability check
    // (`if (provider.stream)`) still works correctly.
    ...(inner.stream && {
      async *stream(req: LLMRequest): AsyncIterable<LLMChunk> {
        rejectFastIfOpen();
        let yieldedAnyChunk = false;
        try {
          for await (const chunk of inner.stream!(req)) {
            yieldedAnyChunk = true;
            yield chunk;
          }
          recordSuccess();
        } catch (err) {
          // Only count as a breaker-tripping failure if the stream
          // failed BEFORE yielding any tokens. Mid-stream errors are
          // less indicative of vendor health (could be a content-filter
          // trip on this specific request).
          if (!yieldedAnyChunk) recordFailure(err);
          throw err;
        }
      },
    }),
  };

  return wrapped;
}

// ─── Default predicates ──────────────────────────────────────────────

function defaultShouldCount(error: unknown): boolean {
  // Don't count user cancellations.
  const e = error as { name?: string; code?: string } | undefined;
  if (e?.name === 'AbortError') return false;
  if (e?.code === 'ABORT_ERR') return false;
  return true;
}
