/**
 * Reliability — public types for the v2.11.1 rules-based reliability subsystem.
 *
 * Mental model: reliability is a SUBFLOW PATTERN expressed as `decide()`
 * rules at PRE-call and POST-call boundaries around the LLM invocation.
 * Each rule is `{when, then, kind, label?}`. The gate stage evaluates
 * rules in order; the first match drives behaviour. Three channels carry
 * the outcome:
 *
 *  • SCOPE STATE   — runtime data (`failKind`, `failPayload`) read by
 *    `Agent.run()` at the API boundary to construct `ReliabilityFailFastError`.
 *  • $emit         — passive observability for external consumers
 *    (CloudWatch, X-Ray, OTel). NOT read by runtime logic.
 *  • $break(reason)— control flow + human-readable narrative reason.
 *
 * See `buildReliabilityGate.ts` for the gate stage that consumes these
 * types and `Agent.create().reliability()` for the consumer-facing API.
 */
import type { LLMProvider, LLMRequest, LLMResponse } from '../adapters/types.js';

// ─── Decision verbs ──────────────────────────────────────────────────

/**
 * The set of verbs a `ReliabilityRule.then` can specify.
 *
 *   • `continue`    — pre-check only; no issues, proceed to the LLM call.
 *   • `ok`          — post-decide only; call succeeded, exit the gate
 *                     loop and let the agent's next stage run.
 *   • `retry`       — post-decide only; bump attempt counter and re-run
 *                     the same provider via the gate's `loopTo`.
 *   • `retry-other` — post-decide only; advance `providerIdx` to the
 *                     next provider in the failover list, then loop.
 *   • `fallback`    — post-decide only; invoke the configured
 *                     `fallback(req, lastError)` to repair the response;
 *                     exit on success.
 *   • `fail-fast`   — both phases; write `failKind`/`failPayload` to
 *                     scope, $emit observability event, $break(reason).
 *                     `Agent.run()` translates the propagated break into
 *                     a typed `ReliabilityFailFastError` at the API
 *                     boundary.
 */
export type ReliabilityDecision =
  | 'continue'
  | 'ok'
  | 'retry'
  | 'retry-other'
  | 'fallback'
  | 'fail-fast';

// ─── Rule shape ──────────────────────────────────────────────────────

/**
 * A single reliability rule. Evaluated by `decide()` from the gate
 * stage; first-match-wins. Function-form `when` predicates are the
 * common case; the filter-DSL form supported by `decide()` also works
 * if your rule reads scope keys with simple comparisons.
 */
export interface ReliabilityRule {
  /**
   * Predicate over the gate's scope. Return `true` to fire this rule.
   * Pure function — no side effects, no async. The gate evaluates
   * predicates in sequence and stops on the first match.
   */
  readonly when: (scope: ReliabilityScope) => boolean;

  /** What to do when this rule matches. See `ReliabilityDecision`. */
  readonly then: ReliabilityDecision;

  /**
   * Machine-readable label used to construct `ReliabilityFailFastError.kind`
   * when `then === 'fail-fast'`. Also surfaces in narrative + emit payload.
   * Must be a stable identifier — consumers branch on it programmatically.
   * Example: `'cost-cap-exceeded'`, `'circuit-open-no-fallback'`,
   * `'transient-5xx-retry'`.
   */
  readonly kind: string;

  /**
   * Human-readable narrative reason. Falls back to `kind` if omitted.
   * Surfaces in `$break(reason)` and the auto-narrative.
   */
  readonly label?: string;
}

// ─── Provider routing ────────────────────────────────────────────────

/**
 * One entry in the optional provider failover list. The gate's
 * `'retry-other'` decision advances through this array via `providerIdx`.
 * If omitted, the gate operates against the agent's single configured
 * provider with no failover.
 */
export interface ReliabilityProvider {
  /** Display name — also the key used in `breakerStates` and
   *  `attemptsPerProvider` maps. Convention: lowercase vendor name. */
  readonly name: string;
  /** The actual provider instance to call. */
  readonly provider: LLMProvider;
  /** The model identifier passed to `provider.complete({ model, ... })`. */
  readonly model: string;
}

// ─── Circuit breaker config ──────────────────────────────────────────

/**
 * Per-provider circuit breaker tuning. State is per-instance (per pod);
 * see CHANGELOG note in v2.11.1 about distributed state limitations.
 */
export interface CircuitBreakerConfig {
  /** Consecutive failures before the breaker OPENS. Default 5. */
  readonly failureThreshold?: number;
  /** How long the breaker stays OPEN before probing. Default 30_000 ms. */
  readonly cooldownMs?: number;
  /** Probe successes required in HALF-OPEN to fully CLOSE. Default 2. */
  readonly halfOpenSuccessThreshold?: number;
  /**
   * Predicate — does this error count toward the failure threshold?
   * Default: everything except AbortError counts. Override to ignore
   * 4xx so a malformed request doesn't trip the breaker for everyone.
   */
  readonly shouldCount?: (error: unknown) => boolean;
}

// ─── Fallback function ───────────────────────────────────────────────

/**
 * Consumer-supplied fallback that runs when a `'fallback'` rule fires.
 * Receives the original request and the most recent error; returns a
 * synthesized response that the gate writes back to scope. Throwing
 * from the fallback re-enters the gate's post-decide rule set with
 * the new error captured — typically the next rule routes to
 * `'fail-fast'` (or a canned response if you've layered that pattern).
 */
export type ReliabilityFallbackFn = (
  request: LLMRequest,
  lastError: Error | undefined,
) => Promise<LLMResponse>;

// ─── Top-level config (consumer-facing) ──────────────────────────────

/**
 * The full reliability configuration passed to
 * `Agent.create({...}).reliability(config)`. All fields optional — the
 * gate stage is mounted only if at least one of `preCheck`/`postDecide`
 * has rules OR `circuitBreaker` is configured. Otherwise the agent
 * chart collapses to a plain `CallLLM` stage with no reliability
 * overhead.
 */
export interface ReliabilityConfig {
  /** Rules evaluated BEFORE the LLM call. Common uses: cost-cap pre-check,
   *  cumulative-budget gate, prompt-size guard. The gate routes on
   *  `'continue'` (proceed to call) or `'fail-fast'` (skip call, $break). */
  readonly preCheck?: readonly ReliabilityRule[];

  /** Rules evaluated AFTER the LLM call returns or throws. The gate
   *  routes on `'ok'` (success exit), `'retry'` (loop), `'retry-other'`
   *  (advance provider, loop), `'fallback'` (invoke fallback fn, exit),
   *  or `'fail-fast'` ($break with reason). */
  readonly postDecide?: readonly ReliabilityRule[];

  /** Optional ordered failover list. The first entry is the primary;
   *  `'retry-other'` decisions walk through this array. If omitted,
   *  reliability runs with no failover. */
  readonly providers?: readonly ReliabilityProvider[];

  /** Per-provider circuit-breaker config. Applied to every provider in
   *  `providers[]` (or to the agent's single provider if no failover
   *  list). Omit to disable circuit-breaking entirely. */
  readonly circuitBreaker?: CircuitBreakerConfig;

  /** Optional fallback function invoked on `'fallback'` decisions.
   *  Typical use: reformat a malformed schema response, repair JSON,
   *  or synthesize a safe default. Throwing re-enters the rule set. */
  readonly fallback?: ReliabilityFallbackFn;
}

// ─── Gate-internal scope shape ───────────────────────────────────────

/**
 * The scope that reliability rules read. Populated by the gate stage
 * each iteration. Consumer rules `(s: ReliabilityScope) => boolean`
 * close over this shape; do NOT cast to `any` — the typed scope is the
 * stable contract between gate state and rule predicates.
 *
 * Mutable scalars (attempt, providerIdx, error, errorKind, latencyMs,
 * response) are OVERWRITTEN each iteration. Loop history is preserved
 * by footprintjs's commitLog (one CommitBundle per stage execution),
 * so time-travel scrubbing shows each attempt's snapshot independently.
 */
export interface ReliabilityScope {
  // ─ Inputs (set by caller, read by rules) ────────────────────────
  /** The LLM request being processed by this gate execution. */
  readonly request: LLMRequest;
  /** Number of providers in the failover list — derived from the
   *  closure-held config; mirrored into scope so rules can compare
   *  against `providerIdx`. (Provider OBJECTS live in the gate chart's
   *  closure, not in scope, because functions can't structuredClone
   *  across subflow boundaries.) */
  readonly providersCount: number;
  /** True if a `fallback` function is configured. Lets rules check
   *  `s.hasFallback` to decide between `fallback` and `fail-fast`. */
  readonly hasFallback: boolean;

  // ─ State updated each iteration ─────────────────────────────────
  /** 1-indexed attempt counter. Incremented after each LLM call,
   *  whether it succeeded or threw. Rules typically check
   *  `s.attempt < maxAttempts` before routing to `'retry'`. */
  attempt: number;
  /** Index into the gate's providers list (held in closure) for the
   *  currently-selected provider. */
  providerIdx: number;
  /** Convenience: `providers[providerIdx].name`. Updated alongside
   *  `providerIdx` on `'retry-other'`. */
  currentProvider: string;
  /** True if `providerIdx < providersCount - 1`. Lets rules check
   *  `s.canSwitchProvider` before routing to `'retry-other'`. */
  canSwitchProvider: boolean;

  // ─ Per-call result (overwritten each iteration) ─────────────────
  /** The LLM response from the most recent successful call.
   *  `undefined` after a throw or before the first call completes. */
  response?: LLMResponse;
  /** The error from the most recent failed call. `undefined` after
   *  a successful call. */
  error?: Error;
  /** Coarse classification of `error` for rule matching. See
   *  `classifyError.ts` for the taxonomy. `'ok'` after success. */
  errorKind: 'ok' | '5xx-transient' | 'rate-limit' | 'circuit-open' | 'schema-fail' | 'unknown';
  /** Wall-clock latency of the most recent call attempt, in ms. */
  latencyMs: number;

  // ─ Cumulative state across attempts (within ONE gate execution) ─
  /** Per-provider attempt counts within this gate execution.
   *  Rules use this for "max-attempts-per-provider" semantics. */
  attemptsPerProvider: Record<string, number>;
  /** Per-provider breaker state. Full state record (counters,
   *  openedAt, lastErrorMessage) — NOT just the state enum — so the
   *  state machine round-trips across gate invocations via
   *  inputMapper/outputMapper. Rules typically check
   *  `s.breakerStates[provider]?.state === 'open'`. */
  breakerStates: Record<string, import('./CircuitBreaker.js').BreakerState>;

  // ─ Optional cumulative state (set if agent provides it) ─────────
  /** Cumulative cost across the whole agent run, set by the agent
   *  via `inputMapper`. `undefined` if cost tracking is off.
   *  Kept here for `preCheck` rules like
   *  `s.cumulativeCostUsd >= s.costCapUsd → fail-fast`. */
  cumulativeCostUsd?: number;
  /** Cumulative input/output tokens, mirrored from agent state. */
  cumulativeInputTokens?: number;
  cumulativeOutputTokens?: number;

  // ─ Set on fail-fast (read by Agent.run() at the API boundary) ───
  /** The matched rule's `kind` when a `'fail-fast'` rule fired.
   *  `Agent.run()` reads this to construct `ReliabilityFailFastError.kind`. */
  failKind?: string;
  /** Structured payload describing the fail-fast event. Shape:
   *  `{ phase, attempt, providerUsed, errorKind, errorMessage }`. */
  failPayload?: {
    readonly phase: 'pre-check' | 'post-decide';
    readonly attempt: number;
    readonly providerUsed: string;
    readonly errorKind: ReliabilityScope['errorKind'];
    readonly errorMessage?: string;
  };
}

// ─── Public typed error ──────────────────────────────────────────────

/**
 * Thrown by `Agent.run()` when a reliability rule routes to `'fail-fast'`
 * and the gate $breaks with a reason. Carries:
 *
 *   • `kind`     — machine-readable identifier from the matched rule's
 *                  `kind` field. Stable across versions; consumers
 *                  branch on this.
 *   • `reason`   — human-readable narrative string from `$break(reason)`.
 *                  Format: `'reliability-{phase}: {label}'` (e.g.,
 *                  `'reliability-post-decide: cost-cap-exceeded'`).
 *   • `cause`    — the originating error from the LLM call, when one
 *                  drove the fail-fast decision (e.g., the underlying
 *                  HTTP error that tripped a circuit breaker).
 *   • `snapshot` — the full `executor.getSnapshot()` at fail-fast time
 *                  for forensics. Consumers persist this for postmortem
 *                  analysis (commitLog, narrative, scope state, etc.).
 *
 * Three-channel discipline: `kind`/`payload` came from scope state,
 * `reason` came from $break, `snapshot` is the engine's own audit trail.
 * Emit events flowed independently to any attached observability adapter
 * (this error is the RUNTIME signal; emit is the OBSERVABILITY signal).
 */
export class ReliabilityFailFastError extends Error {
  readonly code = 'ERR_RELIABILITY_FAIL_FAST' as const;
  readonly kind: string;
  readonly reason: string;
  readonly cause?: Error;
  readonly snapshot?: unknown;
  readonly payload?: ReliabilityScope['failPayload'];

  constructor(opts: {
    kind: string;
    reason: string;
    cause?: Error;
    snapshot?: unknown;
    payload?: ReliabilityScope['failPayload'];
  }) {
    super(`[reliability] ${opts.kind}: ${opts.reason}`);
    this.name = 'ReliabilityFailFastError';
    this.kind = opts.kind;
    this.reason = opts.reason;
    if (opts.cause !== undefined) this.cause = opts.cause;
    if (opts.snapshot !== undefined) this.snapshot = opts.snapshot;
    if (opts.payload !== undefined) this.payload = opts.payload;
  }
}
