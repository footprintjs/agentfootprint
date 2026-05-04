/**
 * CircuitBreaker — pure state-machine functions for the Nygard breaker
 * pattern.
 *
 * Refactored from a class-with-instance-state to PURE FUNCTIONS that
 * take a state record and return a new one. Reasons:
 *
 *   1. **No hidden runtime state.** Breaker state lives in scope where
 *      it's visible to commitLog, narrative, and rules — the footprintjs
 *      "everything in scope" principle. The closure used to be the
 *      source of truth and scope held only a projection; now scope IS
 *      the source of truth.
 *
 *   2. **Round-trippable across gate invocations.** Because state is a
 *      plain record, gate's outputMapper writes it back to agent scope;
 *      agent scope persists across the ReAct loop's many LLM-call gate
 *      invocations; gate's inputMapper reads it back in for the next
 *      call. Per-process persistence comes from the agent scope, not
 *      from a closure that hides between runs.
 *
 *   3. **Distributable later.** A future v2.12 `BreakerStateStore`
 *      adapter (Redis/DynamoDB) just needs to serialize/deserialize the
 *      state record. No class instances to reconstruct.
 *
 *   4. **Testable in isolation.** Pure functions; no instance setup.
 *
 * Pattern: Nygard *Release It!* — three states (CLOSED → OPEN →
 *          HALF-OPEN) with cooldown and probe-success thresholds.
 */

import type { CircuitBreakerConfig } from './types.js';

export type CircuitState = 'closed' | 'open' | 'half-open';

/** Plain serializable record holding one breaker's full state. */
export interface BreakerState {
  state: CircuitState;
  consecutiveFailures: number;
  consecutiveSuccesses: number; // only counted in HALF-OPEN
  openedAt: number; // epoch ms; 0 when CLOSED
  lastErrorMessage?: string; // string, NOT the Error object (serializable)
}

/**
 * Thrown by `assertAdmit()` when the breaker is OPEN and the cooldown
 * window has not elapsed. The reliability gate stage catches this,
 * classifies via `classifyError` → `'circuit-open'`, and lets the
 * post-decide rules route on it.
 */
export class CircuitOpenError extends Error {
  readonly code = 'ERR_CIRCUIT_OPEN' as const;
  readonly cause: unknown;
  readonly retryAfter: number;
  constructor(providerName: string, lastErrorMessage: string | undefined, retryAfter: number) {
    super(
      `[${providerName}] circuit breaker is OPEN — failing fast (next probe at ${new Date(
        retryAfter,
      ).toISOString()}). Underlying error: ${lastErrorMessage ?? 'unknown'}`,
    );
    this.name = 'CircuitOpenError';
    this.cause = lastErrorMessage;
    this.retryAfter = retryAfter;
  }
}

// ─── Defaults ────────────────────────────────────────────────────────

const DEFAULT_FAILURE_THRESHOLD = 5;
const DEFAULT_COOLDOWN_MS = 30_000;
const DEFAULT_HALF_OPEN_SUCCESS_THRESHOLD = 2;

function defaultShouldCount(error: unknown): boolean {
  // User cancellations don't indicate vendor health
  const e = error as { name?: string; code?: string } | undefined;
  if (e?.name === 'AbortError') return false;
  if (e?.code === 'ABORT_ERR') return false;
  return true;
}

// ─── Constructors ────────────────────────────────────────────────────

/** Initial state for a freshly-CLOSED breaker. */
export function initialBreakerState(): BreakerState {
  return {
    state: 'closed',
    consecutiveFailures: 0,
    consecutiveSuccesses: 0,
    openedAt: 0,
  };
}

// ─── Pure transitions ────────────────────────────────────────────────

/**
 * Decide whether to admit a call. Returns the (possibly-updated) state
 * AND whether to admit. If OPEN and cooldown elapsed, transitions to
 * HALF-OPEN and admits. Pure: caller must use the returned state.
 *
 * Usage in the gate stage:
 * ```ts
 * const { admitted, nextState } = admitCall(scope.breakerStates[name], config);
 * scope.breakerStates[name] = nextState;
 * if (!admitted) throw new CircuitOpenError(name, nextState.lastErrorMessage, ...);
 * ```
 */
export function admitCall(
  state: BreakerState,
  config: CircuitBreakerConfig | undefined,
): { admitted: boolean; nextState: BreakerState } {
  const cooldownMs = config?.cooldownMs ?? DEFAULT_COOLDOWN_MS;

  if (state.state === 'closed' || state.state === 'half-open') {
    return { admitted: true, nextState: state };
  }
  // OPEN — check cooldown
  if (Date.now() - state.openedAt >= cooldownMs) {
    return {
      admitted: true,
      nextState: { ...state, state: 'half-open', consecutiveSuccesses: 0 },
    };
  }
  return { admitted: false, nextState: state };
}

/** Record a successful call. Returns the (possibly-updated) state. */
export function recordSuccess(
  state: BreakerState,
  config: CircuitBreakerConfig | undefined,
): BreakerState {
  const halfOpenSuccessThreshold =
    config?.halfOpenSuccessThreshold ?? DEFAULT_HALF_OPEN_SUCCESS_THRESHOLD;

  if (state.state === 'half-open') {
    const consecutiveSuccesses = state.consecutiveSuccesses + 1;
    if (consecutiveSuccesses >= halfOpenSuccessThreshold) {
      // Probe successes met threshold → fully CLOSE
      return {
        state: 'closed',
        consecutiveFailures: 0,
        consecutiveSuccesses: 0,
        openedAt: 0,
      };
    }
    return { ...state, consecutiveSuccesses };
  }
  if (state.state === 'closed') {
    // Reset failure counter on success
    return state.consecutiveFailures === 0 ? state : { ...state, consecutiveFailures: 0 };
  }
  return state;
}

/** Record a failed call. Returns the (possibly-updated) state. */
export function recordFailure(
  state: BreakerState,
  err: unknown,
  config: CircuitBreakerConfig | undefined,
): BreakerState {
  const shouldCount = config?.shouldCount ?? defaultShouldCount;
  if (!shouldCount(err)) return state;

  const failureThreshold = config?.failureThreshold ?? DEFAULT_FAILURE_THRESHOLD;
  const lastErrorMessage = (err as { message?: string })?.message ?? String(err);

  if (state.state === 'half-open') {
    // Probe failed → re-OPEN
    return {
      state: 'open',
      consecutiveFailures: state.consecutiveFailures,
      consecutiveSuccesses: 0,
      openedAt: Date.now(),
      lastErrorMessage,
    };
  }
  if (state.state === 'closed') {
    const consecutiveFailures = state.consecutiveFailures + 1;
    if (consecutiveFailures >= failureThreshold) {
      return {
        state: 'open',
        consecutiveFailures,
        consecutiveSuccesses: 0,
        openedAt: Date.now(),
        lastErrorMessage,
      };
    }
    return { ...state, consecutiveFailures, lastErrorMessage };
  }
  // OPEN: leave state unchanged (admitCall handles cooldown)
  return state;
}

/** Compute the next probe time given a state + config. */
export function nextProbeTime(
  state: BreakerState,
  config: CircuitBreakerConfig | undefined,
): number {
  return state.openedAt + (config?.cooldownMs ?? DEFAULT_COOLDOWN_MS);
}
