/**
 * reliabilityExecution — the retry-loop helper invoked by `callLLM`
 * when `Agent.create(...).reliability(config)` is configured.
 *
 * Wraps a single-shot LLM call with rules-based reliability semantics:
 *
 *   PreCheck rules    → continue / fail-fast
 *     ↓
 *   provider call     → response | error
 *     ↓
 *   PostDecide rules  → ok / retry / retry-other / fallback / fail-fast
 *     ↓
 *   loop or commit
 *
 * The loop runs in JS within a SINGLE footprintjs stage execution. The
 * trace shows one CallLLM stage that internally retried N times. Richer
 * "every retry as a separate stage" tracing is the v2.11.6+ work via
 * `buildReliabilityGateChart` (which trades streaming support for
 * stage-level granularity).
 *
 * Streaming + reliability semantics — first-chunk arbitration:
 *   • Pre-first-chunk failures (connection, headers, breaker-open):
 *     full rule set fires (retry / retry-other / fallback / fail-fast).
 *   • Post-first-chunk failures (mid-stream): rules can ONLY emit
 *     `ok` (commit what we have) or `fail-fast`. Retry / retry-other /
 *     fallback are escalated to fail-fast with kind
 *     `'mid-stream-not-retryable'`. Matches LangChain's
 *     `RunnableWithFallbacks` first-chunk arbitration pattern.
 *
 * On fail-fast: writes `failKind` + `failPayload` to agent scope and
 * calls `$break(reason)`. The agent's main chart catches the break;
 * `Agent.run()` translates it into a typed `ReliabilityFailFastError`
 * at the API boundary (via `TranslateFailFast` stage).
 *
 * Closure-local state (NOT scope):
 *   • `attempt`         — 1-indexed attempt counter
 *   • `providerIdx`     — index into the failover list
 *   • `breakerStates`   — per-provider breaker state (Map)
 *   • `attemptsPerProvider` — per-provider counter
 *
 * Why closure-local: this is one footprintjs stage execution. Putting
 * counters into scope would commit them across iterations of the
 * agent's outer ReAct loop, which is not the intent.
 */

import type { TypedScope } from 'footprintjs';
import type { LLMProvider, LLMRequest, LLMResponse } from '../../../adapters/types.js';
import {
  CircuitOpenError,
  admitCall,
  initialBreakerState,
  nextProbeTime,
  recordFailure,
  recordSuccess,
  type BreakerState,
} from '../../../reliability/CircuitBreaker.js';
import { classifyError } from '../../../reliability/classifyError.js';
import type {
  ReliabilityConfig,
  ReliabilityRule,
  ReliabilityScope,
} from '../../../reliability/types.js';
import type { AgentState } from '../types.js';

/** A single-shot LLM call function. Built once by `callLLM.ts` and
 *  passed into this helper; we invoke it once per loop iteration. */
export type LLMCallFn = (
  request: LLMRequest,
  hooks: {
    /** Called the first time a streaming chunk yields content. After
     *  this fires, mid-stream errors will escalate retry/fallback to
     *  fail-fast. */
    onFirstChunk?: () => void;
  },
) => Promise<LLMResponse>;

/**
 * v2.13 — Output-schema validation hook. Called by the reliability loop
 * AFTER a successful LLM response, BEFORE the response is committed.
 * Throw to signal validation failure — the gate treats the throw as a
 * `'schema-fail'` errorKind and routes via PostDecide rules (which can
 * `retry` with `feedbackForLLM` for Instructor-style schema retry).
 *
 * Sentinel error type — the loop unwraps `ValidationFailure` instances
 * to extract `message` / `path` / `rawOutput` for the
 * `agentfootprint.agent.output_schema_validation_failed` event payload.
 *
 * MUST-FIX #1 from the v2.13 7-panel review: the hook fires ONLY when
 * `response.toolCalls.length === 0` (final-answer turn). Tool-call
 * turns aren't terminal output and validation would be premature.
 * Caller is responsible for the guard; this helper just runs whatever
 * the caller passes.
 */
export type OutputSchemaValidator = (response: LLMResponse) => void;

/**
 * Sentinel error class thrown by an `OutputSchemaValidator` to signal
 * a validation failure. Distinct subclass so the reliability loop can
 * `instanceof` check and route to the schema-fail branch instead of
 * treating it as a generic provider error.
 */
export class ValidationFailure extends Error {
  readonly stage: 'json-parse' | 'schema-validate';
  readonly path?: string;
  readonly rawOutput?: string;
  constructor(opts: {
    message: string;
    stage: 'json-parse' | 'schema-validate';
    path?: string;
    rawOutput?: string;
  }) {
    super(opts.message);
    this.name = 'ValidationFailure';
    this.stage = opts.stage;
    if (opts.path !== undefined) this.path = opts.path;
    if (opts.rawOutput !== undefined) this.rawOutput = opts.rawOutput;
  }
}

/** Sentinel kind written to scope on a mid-stream failure that the
 *  rules wanted to retry. Surfaces in `ReliabilityFailFastError.kind`. */
export const MID_STREAM_KIND = 'mid-stream-not-retryable';

/**
 * Run the reliability retry loop. Returns the committed `LLMResponse`
 * on success; calls `scope.$break(reason)` and returns `undefined` on
 * fail-fast (caller short-circuits when undefined is returned).
 */
export async function executeWithReliability(
  scope: TypedScope<AgentState>,
  request: LLMRequest,
  config: ReliabilityConfig,
  defaultProvider: LLMProvider,
  defaultProviderName: string,
  defaultModel: string,
  callFn: LLMCallFn,
  /** v2.13 — optional output-schema validator. When supplied, the loop
   *  invokes it after every successful LLM call WHERE
   *  `response.toolCalls.length === 0` (final-answer turn). Throws of
   *  type `ValidationFailure` signal schema-fail and route via
   *  PostDecide rules. Caller is responsible for guarding tool-call
   *  turns; this helper assumes the validator is already gated. */
  postValidate?: OutputSchemaValidator,
): Promise<LLMResponse | undefined> {
  // v2.13 — mutable so feedbackForLLM can append ephemeral messages
  // before retry. The reliabilityScope() helper captures `request` by
  // reference; reassignment makes the next iteration's call see the
  // updated messages array WITHOUT mutating the original (we always
  // construct a new request object in applyFeedback below).
  let mutableRequest = request;
  const preRules = config.preCheck ?? [];
  const postRules = config.postDecide ?? [];
  const providers = config.providers ?? [];
  const breakerConfig = config.circuitBreaker;
  const fallbackFn = config.fallback;

  // Closure-local state — see header comment for rationale.
  let attempt = 0;
  let providerIdx = 0;
  let firstChunkSeen = false;
  const breakerStates: Record<string, BreakerState> = {};
  const attemptsPerProvider: Record<string, number> = {};
  // v2.13 — accumulating output-schema validation history. Pushed on every
  // schema-fail outcome; rules read it via scope.validationErrorHistory.
  const validationErrorHistory: string[] = [];
  // v2.13 — current attempt's validation error detail (overwritten each loop).
  let lastValidationError: ReliabilityScope['validationError'];

  // Helper: build the reliability scope view rules read.
  const reliabilityScope = (): ReliabilityScope => {
    const currentProvider = providerEntry().name;
    return {
      request: mutableRequest,
      providersCount: providers.length,
      hasFallback: fallbackFn !== undefined,
      attempt,
      providerIdx,
      currentProvider,
      canSwitchProvider: providerIdx < providers.length - 1,
      response: lastResponse,
      error: lastError,
      errorKind: lastErrorKind,
      latencyMs: lastLatencyMs,
      ...(lastValidationError !== undefined && { validationError: lastValidationError }),
      validationErrorHistory,
      attemptsPerProvider,
      breakerStates,
    };
  };

  // Pick provider for current attempt — failover list if configured,
  // else the agent's default provider.
  const providerEntry = (): { name: string; provider: LLMProvider; model: string } => {
    if (providers.length > 0) {
      const entry = providers[providerIdx];
      if (entry) return entry;
    }
    return { name: defaultProviderName, provider: defaultProvider, model: defaultModel };
  };

  // Helper: build failPayload + write scope + emit + break.
  const failFast = (phase: 'pre-check' | 'post-decide', kind: string, label: string): undefined => {
    const cur = providerEntry();
    const payload: ReliabilityScope['failPayload'] = {
      phase,
      attempt,
      providerUsed: cur.name,
      errorKind: lastErrorKind,
      ...(lastError?.message !== undefined && { errorMessage: lastError.message }),
    };
    const reason = `reliability-${phase}: ${label}`;
    (scope as unknown as { reliabilityFailKind: string }).reliabilityFailKind = kind;
    (scope as unknown as { reliabilityFailPayload: typeof payload }).reliabilityFailPayload =
      payload;
    (scope as unknown as { reliabilityFailReason: string }).reliabilityFailReason = reason;
    if (lastError !== undefined) {
      // Store the originating error as plain strings — Error instances
      // don't round-trip cleanly through scope's structuredClone. The
      // Agent.run() boundary reconstructs a new Error from these for
      // ReliabilityFailFastError.cause; consumer's `instanceof` checks
      // get a stable Error subclass without us needing to preserve the
      // exact prototype.
      (scope as unknown as { reliabilityFailCauseMessage: string }).reliabilityFailCauseMessage =
        lastError.message;
      (scope as unknown as { reliabilityFailCauseName: string }).reliabilityFailCauseName =
        lastError.name;
    }
    scope.$emit('agentfootprint.reliability.fail_fast', {
      phase,
      kind,
      label,
      attempt,
      providerUsed: cur.name,
      errorKind: lastErrorKind,
      ...(lastError?.message !== undefined && { errorMessage: lastError.message }),
    });
    scope.$break(reason);
    return undefined;
  };

  // Mutable per-attempt state. Outside the loop so reliabilityScope() can read.
  let lastResponse: LLMResponse | undefined;
  let lastError: Error | undefined;
  let lastErrorKind: ReliabilityScope['errorKind'] = 'ok';
  let lastLatencyMs = 0;

  // We DON'T use footprintjs `decide()` here — its predicates bind
  // to the active agent scope via TypedScope, but our `ReliabilityRule`
  // predicates take the synthesized `ReliabilityScope` view (a closure-
  // local projection over the retry-loop's mutable state). Iterate
  // rules manually instead. The `decide()` import is kept available
  // for `buildReliabilityGateChart` which DOES use it via subflows.
  const evalRules = (
    rules: readonly ReliabilityRule[],
    fallback: string,
  ): { branch: string; matched?: ReliabilityRule } => {
    const sv = reliabilityScope();
    for (const rule of rules) {
      try {
        if (rule.when(sv)) return { branch: rule.then, matched: rule };
      } catch {
        // Predicate threw — skip this rule. Per ReliabilityRule
        // contract predicates should be pure; treat throws as no-match.
      }
    }
    return { branch: fallback };
  };

  if (preRules.length > 0) {
    const pre = evalRules(preRules, 'continue');
    if (pre.branch === 'fail-fast') {
      const kind = pre.matched?.kind ?? 'pre-check-failed';
      const label = pre.matched?.label ?? kind;
      return failFast('pre-check', kind, label);
    }
  }

  // ─── Retry loop ─────────────────────────────────────────────────
  // Hard upper bound prevents pathological rule sets from looping forever.
  // Most consumer rules cap retry at 3-5 via `attempt < N` predicates;
  // this is just a safety net.
  const MAX_LOOP = 50;
  for (let loop = 0; loop < MAX_LOOP; loop++) {
    const cur = providerEntry();

    // Breaker check (pure): admit + transition based on cooldown.
    if (breakerConfig !== undefined) {
      const current = breakerStates[cur.name] ?? initialBreakerState();
      const { admitted, nextState } = admitCall(current, breakerConfig);
      breakerStates[cur.name] = nextState;
      if (!admitted) {
        lastError = new CircuitOpenError(
          cur.name,
          nextState.lastErrorMessage,
          nextProbeTime(nextState, breakerConfig),
        );
        lastErrorKind = 'circuit-open';
        lastResponse = undefined;
        // Skip the call; jump straight to PostDecide so rules can
        // route on errorKind === 'circuit-open'.
      }
    }

    // Fire the actual call (unless breaker pre-emptied above).
    if (lastErrorKind !== 'circuit-open') {
      const t0 = Date.now();
      // Reset per-attempt validation state (overwritten below if this
      // attempt produces a schema-fail).
      lastValidationError = undefined;
      try {
        const response = await callFn(mutableRequest, {
          onFirstChunk: () => {
            firstChunkSeen = true;
          },
        });
        // v2.13 — output-schema validation. MUST-FIX #1: only validate
        // on terminal turns (no toolCalls). Tool-call turns aren't
        // final answers; validating them would be premature.
        if (
          postValidate !== undefined &&
          (response.toolCalls === undefined || response.toolCalls.length === 0)
        ) {
          try {
            postValidate(response);
            // Validation passed — fall through to success branch.
            lastResponse = response;
            lastError = undefined;
            lastErrorKind = 'ok';
          } catch (vErr) {
            // Validation failed — treat as schema-fail. Capture detail
            // for the typed event and for rules that read scope.validationError.
            const vfailure =
              vErr instanceof ValidationFailure
                ? vErr
                : new ValidationFailure({
                    message: vErr instanceof Error ? vErr.message : String(vErr),
                    stage: 'schema-validate',
                  });
            lastResponse = undefined;
            lastError = vfailure;
            lastErrorKind = 'schema-fail';
            lastValidationError = {
              message: vfailure.message,
              ...(vfailure.path !== undefined && { path: vfailure.path }),
              ...(vfailure.rawOutput !== undefined && { rawOutput: vfailure.rawOutput }),
            };
            validationErrorHistory.push(vfailure.message);
            // MUST-FIX #2: emit the typed event BEFORE PostDecide runs,
            // so observability sees the failure even if a buggy rule
            // routes to fail-fast or swallows it.
            // MUST-FIX #3: payload includes attempt + cumulativeRetries.
            scope.$emit('agentfootprint.agent.output_schema_validation_failed', {
              message: vfailure.message,
              stage: vfailure.stage,
              ...(vfailure.path !== undefined && { path: vfailure.path }),
              ...(vfailure.rawOutput !== undefined && { rawOutput: vfailure.rawOutput }),
              attempt: attempt + 1, // 1-indexed; bump happens in finally
              cumulativeRetries: validationErrorHistory.length,
            });
            // Validation-fail does NOT count toward circuit-breaker
            // failures — the provider call itself succeeded.
          }
        } else {
          // No validator configured, OR a tool-call turn (non-terminal).
          lastResponse = response;
          lastError = undefined;
          lastErrorKind = 'ok';
        }
        if (lastErrorKind === 'ok' && breakerConfig !== undefined) {
          breakerStates[cur.name] = recordSuccess(
            breakerStates[cur.name] ?? initialBreakerState(),
            breakerConfig,
          );
        }
      } catch (err) {
        lastResponse = undefined;
        lastError = err instanceof Error ? err : new Error(String(err));
        lastErrorKind = classifyError(err);
        if (breakerConfig !== undefined && !(err instanceof CircuitOpenError)) {
          breakerStates[cur.name] = recordFailure(
            breakerStates[cur.name] ?? initialBreakerState(),
            err,
            breakerConfig,
          );
        }
      } finally {
        lastLatencyMs = Date.now() - t0;
        attemptsPerProvider[cur.name] = (attemptsPerProvider[cur.name] ?? 0) + 1;
        attempt += 1;
      }
    }

    // PostDecide
    let postBranch = 'ok';
    let matchedRule: ReliabilityRule | undefined;
    if (postRules.length > 0) {
      const post = evalRules(postRules, lastError === undefined ? 'ok' : 'fail-fast');
      postBranch = post.branch;
      matchedRule = post.matched;
    } else if (lastError !== undefined) {
      // No postDecide rules + error → default fail-fast.
      postBranch = 'fail-fast';
    }

    // First-chunk arbitration: post-first-chunk only `ok` and
    // `fail-fast` are honored. Other decisions escalate to fail-fast
    // with the mid-stream-not-retryable kind. This matches the
    // LangChain RunnableWithFallbacks pattern documented in the
    // streaming-vs-reliability design memo.
    if (firstChunkSeen && postBranch !== 'ok' && postBranch !== 'fail-fast') {
      return failFast(
        'post-decide',
        MID_STREAM_KIND,
        `mid-stream failure not retryable (rule wanted '${postBranch}')`,
      );
    }

    if (postBranch === 'ok') {
      // Success exit. lastResponse is the committed value.
      if (lastResponse !== undefined) return lastResponse;
      // 'ok' with no response is misconfiguration; fall through to
      // fail-fast as a defensive default.
      return failFast('post-decide', 'no-response', 'rule said ok but no response captured');
    }

    if (postBranch === 'fail-fast') {
      const kind = matchedRule?.kind ?? lastErrorKind;
      const label = matchedRule?.label ?? matchedRule?.kind ?? lastErrorKind;
      return failFast('post-decide', kind, label);
    }

    if (postBranch === 'retry') {
      // v2.13 — when the matched rule supplies `feedbackForLLM`, append
      // it as an ephemeral user message before the next iteration so
      // the LLM sees the validation hint. The ephemeral marker keeps
      // it out of scope.history / memory writes — visible in the
      // request, not persisted long-term.
      if (matchedRule?.feedbackForLLM !== undefined) {
        mutableRequest = await applyFeedback(
          mutableRequest,
          matchedRule.feedbackForLLM,
          reliabilityScope(),
        );
      }
      // Loop continues; attempt was already bumped in finally.
      continue;
    }

    if (postBranch === 'retry-other') {
      // Same feedback application for retry-other — the new provider
      // sees the same accumulated context.
      if (matchedRule?.feedbackForLLM !== undefined) {
        mutableRequest = await applyFeedback(
          mutableRequest,
          matchedRule.feedbackForLLM,
          reliabilityScope(),
        );
      }
      providerIdx += 1;
      if (providerIdx >= Math.max(providers.length, 1)) {
        // Walked past the last provider — convert to fail-fast.
        return failFast(
          'post-decide',
          'no-more-providers',
          'retry-other requested but no more providers',
        );
      }
      continue;
    }

    if (postBranch === 'fallback') {
      if (!fallbackFn) {
        return failFast(
          'post-decide',
          'fallback-not-configured',
          'rule wanted fallback but no fallback fn provided',
        );
      }
      try {
        const repaired = await fallbackFn(mutableRequest, lastError);
        // Successful fallback — commit and exit.
        return repaired;
      } catch (fallbackErr) {
        // Fallback threw — re-classify and let next iteration's
        // post-decide rules route on the new error.
        lastError = fallbackErr instanceof Error ? fallbackErr : new Error(String(fallbackErr));
        lastErrorKind = classifyError(fallbackErr);
        lastResponse = undefined;
        continue;
      }
    }

    // Unknown branch — fail-fast as a defensive default.
    return failFast('post-decide', 'unknown-branch', `unknown decision '${postBranch}'`);
  }

  // Hit the safety cap.
  return failFast(
    'post-decide',
    'max-loop-exceeded',
    `reliability loop exceeded ${MAX_LOOP} iterations`,
  );
}

/**
 * v2.13 — apply a `feedbackForLLM` value to the next request by
 * appending an ephemeral user message. Resolves the value to a string
 * (sync or async); returns a NEW LLMRequest with the appended message.
 *
 * The new message is marked `ephemeral: true` so:
 *   • LLM sees it (counts toward this turn's context window)
 *   • observability (recorders / narrative / typed events) sees it
 *   • scope.history / memory writes do NOT persist it long-term
 *
 * Errors thrown by a function-form `feedbackForLLM` are caught and
 * swallowed (with a fallback to a generic message) — a buggy
 * feedback callback MUST NOT abort the agent run that the gate is
 * already retrying. This is the v2.13 7-panel review's
 * "callback-throw safety" requirement (OpenAI reviewer).
 */
async function applyFeedback(
  request: LLMRequest,
  feedback: string | ((scope: ReliabilityScope) => string | Promise<string>),
  scope: ReliabilityScope,
): Promise<LLMRequest> {
  let content: string;
  if (typeof feedback === 'string') {
    content = feedback;
  } else {
    try {
      const result = feedback(scope);
      content = result instanceof Promise ? await result : result;
    } catch {
      content = `Previous output failed validation. Return valid JSON conforming to the schema.`;
    }
  }
  return {
    ...request,
    messages: [...request.messages, { role: 'user', content, ephemeral: true }],
  };
}

/**
 * v2.13 — stuck-loop detection helper. Returns `true` when the last
 * `n` validation errors are IDENTICAL — a hallucinating model that
 * keeps making the same mistake won't make progress on more retries.
 *
 * Default rule template — spread into your `postDecide` to short-circuit
 * stuck loops:
 *
 * ```ts
 * postDecide: [
 *   defaultStuckLoopRule,            // ← spread first; fail-fast on stuck
 *   { when: (s) => s.validationError !== undefined && s.attempt < 3, then: 'retry', ... },
 * ]
 * ```
 *
 * @param scope The reliability scope view passed to rule predicates.
 * @param n How many trailing identical errors trigger detection. Default 2.
 */
export function lastNValidationErrorsMatch(scope: ReliabilityScope, n = 2): boolean {
  const h = scope.validationErrorHistory;
  if (h.length < n) return false;
  const last = h[h.length - 1];
  for (let i = h.length - n; i < h.length; i++) {
    if (h[i] !== last) return false;
  }
  return true;
}

/**
 * v2.13 — drop-in PostDecide rule that fail-fasts when the last 2
 * validation errors match. Spread into `postDecide` BEFORE retry
 * rules so it short-circuits before another wasted attempt.
 *
 * The matched-rule kind `'schema-stuck-loop'` surfaces on
 * `ReliabilityFailFastError.kind` for caller branching.
 */
export const defaultStuckLoopRule: ReliabilityRule = {
  when: (s) => lastNValidationErrorsMatch(s, 2),
  then: 'fail-fast',
  kind: 'schema-stuck-loop',
  label: 'model produced the same validation error twice in a row',
};
