// error.* (retry/recover; fatal is Tier 1)
//
// NOTE: error.retried / error.recovered are shaped for the standalone
// PROVIDER DECORATORS (withRetry / withFallback / withCircuitBreaker) —
// a decorator has a fixed `maxAttempts` + exponential `backoffMs` and a
// wall-clock `totalDurationMs`. The rules-based reliability loop has no
// fixed attempt cap and no backoff (rules decide dynamically), so it
// uses the `reliability.*` family below instead. Keep the two families
// distinct — do NOT cross-emit (see docs/MENTAL_MODEL.md §14).
export interface ErrorRetriedPayload {
  readonly attempt: number;
  readonly maxAttempts: number;
  readonly lastError: string;
  /** How long the decorator waited before the attempt. */
  readonly backoffMs: number;
  readonly reason: string;
  /**
   * The wait the failure STATED (Retry-After, a gateway's "try again in N
   * seconds"), in ms. Absent when it stated none; `backoffMs` is max(the
   * schedule, this), capped by `maxDelayMs`.
   */
  readonly statedWaitMs?: number;
}

export interface ErrorRecoveredPayload {
  readonly attempt: number;
  readonly totalDurationMs: number;
}

/**
 * v9.32 — `withCircuitBreaker` moved between states.
 *
 * The gap this fills, named: until 9.32 the breaker reported nothing at all
 * through the in-run channel. `onStateChange` was the only way to see a trip,
 * and that is a consumer-level callback where a run's correlation ids are not
 * available — so a breaker that opened mid-run was invisible in the trace
 * beside the tool calls it stopped. An independent reviewer (2026-08-13, on a
 * local harness of scripted failures) watched a breaker open after two
 * failures, serve the next request from fallback, half-open after cooldown and
 * close after two probes: every step correct, every step off the record.
 *
 * Transitions ONLY. A hundred requests rejected while the breaker is already
 * open produce zero events — a re-entry into the same state is not a change,
 * and reporting it would turn a state log into a request log.
 *
 * On the `error.*` domain because that is where the provider decorators
 * already report; `reliability.*` is the separate rules-based loop.
 */
export interface ErrorCircuitChangedPayload {
  /** The state entered. */
  readonly state: 'closed' | 'open' | 'half-open';
  /**
   * WHY, in the breaker's own words — `'3 consecutive failures'`,
   * `'cooldown elapsed'`, `'2 probe successes'`, `'half-open probe failed'`.
   *
   * Never an error's message: the failure that tripped it is reported by
   * whoever threw it, and copying it here would attribute one vendor's text to
   * a state machine that only counted.
   */
  readonly reason: string;
  /** WHICH provider this breaker wraps — `inner.name`, not a composite chain
   *  name. Two breakers under one fallback produce one stream, and this is
   *  what tells them apart. */
  readonly providerName: string;
}

// reliability.* — the RULES-BASED reliability loop's telemetry family
// (Agent.create(...).reliability({...})). Distinct from error.* (which is
// for the provider decorators). Pure telemetry on the emit channel; the
// loop's control state stays in scope (reliabilityFail* on AgentState).
//
// `errorKind` is a plain string here (not the reliability ErrorKind
// union) so the events contract layer does not depend on reliability
// internals — mirrors how ErrorRetriedPayload uses `lastError: string`.

/**
 * Fired when the rules loop (or the reliability gate chart) gives up via
 * a `fail-fast` decision. Superset shape: `phase`/`kind`/`attempt` are
 * always present; the remaining fields are populated by whichever site
 * emits (the loop carries `label`/`providerUsed`/`errorKind`; the gate
 * chart carries `reason`).
 */
export interface ReliabilityFailFastPayload {
  readonly phase: 'pre-check' | 'post-decide';
  /** The matched rule's `kind` (machine-readable bucket). */
  readonly kind: string;
  /** 1-indexed attempt counter at the point of failure. */
  readonly attempt: number;
  /** Human-readable label of the matched rule (loop sites). */
  readonly label?: string;
  /** Free-form reason string (gate-chart sites). */
  readonly reason?: string;
  /** Provider in use when the loop failed fast. */
  readonly providerUsed?: string;
  /** Classification of the failure being failed-fast on. */
  readonly errorKind?: string;
  /** Originating error message, when present. Absent for a schema failure
   *  under an output policy — the parser's message can quote the draft. */
  readonly errorMessage?: string;
}

/**
 * Fired each time the rules loop decides to RETRY after a failed attempt
 * — `action` distinguishes a same-provider retry from a provider failover.
 */
export interface ReliabilityRetriedPayload {
  /** 1-indexed counter of the attempt that just FAILED and is being retried. */
  readonly attempt: number;
  /** `retry` = same provider again; `retry-other` = switch provider. */
  readonly action: 'retry' | 'retry-other';
  /** Classification of the failure being retried. */
  readonly errorKind: string;
  /** Originating error message, when present. Absent for a schema failure
   *  under an output policy — the parser's message can quote the draft. */
  readonly errorMessage?: string;
  /** Provider that just failed. */
  readonly fromProvider: string;
  /** Provider the NEXT attempt will use (equals `fromProvider` for `retry`). */
  readonly toProvider: string;
}

/**
 * Fired when the rules loop produces a successful response AFTER one or
 * more failed attempts (self-healed). `recoveredVia` names the mechanism
 * of the final successful step.
 */
export interface ReliabilityRecoveredPayload {
  /** 1-indexed attempt number that finally succeeded. */
  readonly attempt: number;
  /** How recovery happened. */
  readonly recoveredVia: 'retry' | 'retry-other' | 'fallback';
  /** How many attempts failed before this success. */
  readonly priorFailures: number;
  /** Classification of the LAST failure before recovery. */
  readonly errorKind: string;
}

// resilience.* (2) — the OUTPUT-fallback ladder, distinct from both
// `error.*` (decorator-shaped) and `reliability.*` (the rules loop). These
// two fire when a typed answer failed its own `outputSchema` and the
// 3-tier `outputFallback` ladder took over: tier 2 (the fallback function)
// and tier 3 (the canned value). Emitted since 8.18.0 through a loosely
// typed `emit(eventType: string, …)` parameter, which is how they shipped
// for months without a payload interface or an `ALL_EVENT_TYPES` entry —
// registered here so `runner.on(...)` accepts them like every other event.

/**
 * Tier 2 engaged: `parseOutput()` / `runTyped()` could not validate the
 * model's answer against `outputSchema`, and the consumer-supplied
 * `fallback` function is about to run. Fires BEFORE the fallback executes,
 * so it is a record of degradation starting — not of it succeeding.
 */
export interface ResilienceOutputFallbackTriggeredPayload {
  /** Which half of validation failed: bad JSON, or good JSON of the wrong shape. */
  readonly stage: 'json-parse' | 'schema-validate';
  /** First 200 chars of the model's raw answer. Truncated by construction —
   *  never the whole output. */
  readonly rawOutputPreview: string;
  /** Message of the `OutputSchemaError` that opened the ladder. */
  readonly primaryErrorMessage: string;
  /** Corrective re-asks this run already paid for before the answer reached
   *  the ladder (the `outputAttempts` ledger minus the first attempt).
   *  ABSENT when the caller parsed a string that did not come from this
   *  agent's last run — absent means unknown, never zero. */
  readonly retriesSpent?: number;
}

/**
 * Tier 3 engaged: the fallback function itself failed (threw, or returned a
 * value that also failed the schema) and the static `canned` value is being
 * returned instead. This is the event that says a run billed real tokens and
 * ended in a constant — with `canned` configured, `runTyped()` is
 * structurally unable to throw, so this event is the ONLY signal.
 */
export interface ResilienceOutputCannedUsedPayload {
  /** First 200 chars of the model's raw answer. Truncated by construction. */
  readonly rawOutputPreview: string;
  /** Why tier 2 did not hold — the fallback's own throw, or the validation
   *  error its return value produced. */
  readonly fallbackErrorMessage: string;
  /** Corrective re-asks this run already paid for. ABSENT when unknown. */
  readonly retriesSpent?: number;
}
