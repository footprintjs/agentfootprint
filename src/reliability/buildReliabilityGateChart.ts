/**
 * buildReliabilityGateChart — produces a footprintjs FlowChart that wraps
 * an LLM call with rules-based reliability semantics, using the native
 * `decide()` DSL via `addDeciderFunction` decider stages.
 *
 * The returned chart is mounted as a subflow in the agent's chart at
 * Agent.build() time (only when reliability is configured). Inside the
 * subflow:
 *
 *   PreCheck (decider) → CallProvider (function) → PostDecide (decider)
 *                                                       │
 *                                       ┌───────────────┘
 *                                       ▼ loopTo('pre-check')
 *
 * Branch outcomes (escape via $break() to stop the gate's loop;
 * fall-through via no-$break to trigger loopTo back to PreCheck):
 *
 *   PreCheck:
 *     'continue'   → no-op   → falls through to CallProvider
 *     'fail-fast'  → set failKind, $emit, $break(reason)
 *
 *   PostDecide:
 *     'ok'          → $break() (subflow exits normally; agent continues)
 *     'retry'       → bump attempt; falls through to loopTo
 *     'retry-other' → bump providerIdx; falls through to loopTo
 *     'fallback'    → call config.fallback(); $break() on success
 *     'fail-fast'   → set failKind, $emit, $break(reason)
 *
 * The subflow is mounted WITHOUT `propagateBreak: true`. Subflow $break is
 * local — agent.ts adds a `TranslateFailFast` agent-level stage AFTER the
 * subflow that reads scope.reliabilityFailKind and converts it into an
 * agent-level `$break(reason)`. This split lets normal subflow exits
 * (`ok`/`fallback`) leave the agent running while fail-fast stops it.
 *
 * Three-channel discipline preserved:
 *   • SCOPE STATE  — failKind/failPayload/failReason mapped to parent via
 *                    outputMapper; consumed by agent's TranslateFailFast.
 *   • $emit        — passive observability for external consumers.
 *   • $break(reason)— control flow + human reason for narrative.
 */

import { decide, flowChart } from 'footprintjs';
import type { FlowChart, TypedScope } from 'footprintjs';
import type { LLMRequest, LLMResponse } from '../adapters/types.js';
import {
  CircuitOpenError,
  admitCall,
  initialBreakerState,
  nextProbeTime,
  recordFailure,
  recordSuccess,
} from './CircuitBreaker.js';
import { classifyError } from './classifyError.js';
import type { ReliabilityConfig, ReliabilityRule, ReliabilityScope } from './types.js';

// ─── Stage IDs (also used for narrative/topology readability) ────────

const STAGE_IDS = {
  INIT: 'reliability-init',
  PRE_CHECK: 'pre-check',
  CALL_PROVIDER: 'call-provider',
  POST_DECIDE: 'post-decide',
} as const;

// Branch IDs must be globally unique within the chart's stageMap, so
// each branch carries its decider's prefix. The decider's RETURN value
// from preCheckDeciderFn / postDecideDeciderFn is the branch's local id
// (e.g., 'continue', 'ok') — the decide() result map below translates.
const BRANCH_IDS = {
  // PreCheck branches
  PRE_CONTINUE: 'pre-continue',
  PRE_FAIL_FAST: 'pre-fail-fast',
  // PostDecide branches
  POST_OK: 'post-ok',
  POST_RETRY: 'post-retry',
  POST_RETRY_OTHER: 'post-retry-other',
  POST_FALLBACK: 'post-fallback',
  POST_FAIL_FAST: 'post-fail-fast',
} as const;

// Map from `ReliabilityDecision` (consumer-facing rule.then values) to
// the prefixed branch ids. The decider functions translate before
// returning so consumers never see the prefixed names.
const PRE_DECISION_TO_BRANCH: Record<string, string> = {
  continue: BRANCH_IDS.PRE_CONTINUE,
  'fail-fast': BRANCH_IDS.PRE_FAIL_FAST,
};
const POST_DECISION_TO_BRANCH: Record<string, string> = {
  ok: BRANCH_IDS.POST_OK,
  retry: BRANCH_IDS.POST_RETRY,
  'retry-other': BRANCH_IDS.POST_RETRY_OTHER,
  fallback: BRANCH_IDS.POST_FALLBACK,
  'fail-fast': BRANCH_IDS.POST_FAIL_FAST,
};

// ─── Helpers ─────────────────────────────────────────────────────────

/** Build the structured failure payload from current scope state. */
function buildFailPayload(
  scope: TypedScope<ReliabilityScope>,
  phase: 'pre-check' | 'post-decide',
): ReliabilityScope['failPayload'] {
  return {
    phase,
    attempt: scope.attempt,
    providerUsed: scope.currentProvider,
    errorKind: scope.errorKind,
    ...(scope.error?.message !== undefined && { errorMessage: scope.error.message }),
  };
}

/** Find the matched rule's index in a DecisionResult evidence list. */
function findMatchedIndex(evidence: {
  rules: readonly { matched: boolean }[];
}): number | undefined {
  for (let i = 0; i < evidence.rules.length; i++) {
    if (evidence.rules[i].matched) return i;
  }
  return undefined;
}

/** Resolve {kind, label} from a rule list and the matched index. */
function matchedKindLabel(
  rules: readonly ReliabilityRule[],
  matchedIdx: number | undefined,
): { kind: string; label: string } {
  if (matchedIdx === undefined || matchedIdx < 0 || matchedIdx >= rules.length) {
    return { kind: 'unknown', label: 'unknown' };
  }
  const rule = rules[matchedIdx];
  return { kind: rule.kind, label: rule.label ?? rule.kind };
}

// ─── Build the chart ─────────────────────────────────────────────────

/**
 * Build the reliability gate FlowChart from a config. Mount via
 * `addSubFlowChartNext` in the agent's chart — see `Agent.build()`.
 *
 * Closure state captured by stage functions:
 *   • `breakers` — Map<providerName, CircuitBreaker>; per-instance state
 *     persists across gate invocations within ONE agent process.
 *   • `preRules` / `postRules` — frozen rule arrays.
 *   • `fallbackFn` — consumer's fallback function, if configured.
 */
export function buildReliabilityGateChart(config: ReliabilityConfig): FlowChart {
  // FROZEN CONFIG captured by the factory closure. None of these mutate
  // at runtime — they're the chart's CODE, not state. Same pattern as
  // every other footprintjs chart factory (cacheDecisionSubflow,
  // injectionEngineSubflow, etc.) capturing rules/directives at build.
  //
  //   • providers     — functions can't structuredClone into scope
  //   • preRules/postRules — frozen at chart-build time
  //   • fallbackFn    — function, can't structuredClone into scope
  //
  // RUNTIME STATE (attempt counts, errorKind, breaker counters,
  // response, latency, etc.) lives in SCOPE. Breaker state in
  // particular is a plain serializable record that round-trips across
  // gate invocations via inputMapper/outputMapper — no closure.
  const providers = config.providers ?? [];
  const breakerConfig = config.circuitBreaker;
  // No-op pass-through for the PreContinue branch — pre-check rules
  // returned 'continue', so just fall through to CallProvider with no
  // state change. Lifted to a named const to satisfy the no-empty-function
  // lint rule (intentional empty body, not a forgotten implementation).
  const preContinueNoop = (): void => undefined;

  const preRules = config.preCheck ?? [];
  const postRules = config.postDecide ?? [];
  const fallbackFn = config.fallback;

  // ─── PreCheck decider function ───────────────────────────────
  // Returns one of the PRE_* branch ids. If consumer rules use
  // ReliabilityDecision values ('continue'/'fail-fast'), map them.
  const preCheckDeciderFn = (scope: TypedScope<ReliabilityScope>) => {
    if (preRules.length === 0) return BRANCH_IDS.PRE_CONTINUE;
    const result = decide(
      scope,
      preRules as unknown as Parameters<typeof decide<ReliabilityScope>>[1],
      'continue',
    );
    return PRE_DECISION_TO_BRANCH[result.branch] ?? BRANCH_IDS.PRE_CONTINUE;
  };

  // ─── PreCheck 'fail-fast' branch fn ──────────────────────────
  const preFailFastBranchFn = (scope: TypedScope<ReliabilityScope>) => {
    // Pre-check rules carry kind via the decide() result. Re-evaluate
    // to extract the matched rule's kind/label for the failure payload.
    if (preRules.length === 0) return;
    const result = decide(
      scope,
      preRules as unknown as Parameters<typeof decide<ReliabilityScope>>[1],
      'continue',
    );
    const matchedIdx = findMatchedIndex(result.evidence);
    const { kind, label } = matchedKindLabel(preRules, matchedIdx);
    scope.failKind = kind;
    scope.failPayload = buildFailPayload(scope, 'pre-check');
    scope.$emit('agentfootprint.reliability.fail_fast', {
      phase: 'pre-check',
      kind,
      label,
      attempt: scope.attempt,
      providerUsed: scope.currentProvider,
    });
    scope.$break(`reliability-pre-check: ${label}`);
  };

  // ─── CallProvider stage fn ───────────────────────────────────
  const callProviderStageFn = async (scope: TypedScope<ReliabilityScope>) => {
    const providerEntry = providers[scope.providerIdx];
    if (!providerEntry) {
      // Misconfiguration — no provider at this index. Fail-fast cleanly.
      scope.failKind = 'misconfigured-provider';
      scope.failPayload = buildFailPayload(scope, 'pre-check');
      scope.$emit('agentfootprint.reliability.fail_fast', {
        phase: 'pre-check',
        kind: 'misconfigured-provider',
        providerIdx: scope.providerIdx,
      });
      scope.$break(
        `reliability-pre-check: misconfigured-provider (idx ${scope.providerIdx} out of bounds)`,
      );
      return;
    }

    const t0 = Date.now();
    try {
      // Breaker check (pure): admit + transition based on cooldown.
      if (breakerConfig !== undefined) {
        const current = scope.breakerStates[providerEntry.name] ?? initialBreakerState();
        const { admitted, nextState } = admitCall(current, breakerConfig);
        scope.breakerStates[providerEntry.name] = nextState;
        if (!admitted) {
          throw new CircuitOpenError(
            providerEntry.name,
            nextState.lastErrorMessage,
            nextProbeTime(nextState, breakerConfig),
          );
        }
      }
      const response: LLMResponse = await providerEntry.provider.complete(
        scope.request as LLMRequest,
      );
      scope.response = response;
      scope.error = undefined;
      scope.errorKind = 'ok';
      // Record success (pure): may CLOSE a HALF-OPEN breaker
      if (breakerConfig !== undefined) {
        scope.breakerStates[providerEntry.name] = recordSuccess(
          scope.breakerStates[providerEntry.name] ?? initialBreakerState(),
          breakerConfig,
        );
      }
    } catch (err) {
      scope.response = undefined;
      scope.error = err instanceof Error ? err : new Error(String(err));
      scope.errorKind = classifyError(err);
      // CircuitOpenError is the breaker rejecting; don't double-count.
      if (breakerConfig !== undefined && !(err instanceof CircuitOpenError)) {
        scope.breakerStates[providerEntry.name] = recordFailure(
          scope.breakerStates[providerEntry.name] ?? initialBreakerState(),
          err,
          breakerConfig,
        );
      }
    } finally {
      scope.latencyMs = Date.now() - t0;
      scope.attemptsPerProvider[providerEntry.name] =
        (scope.attemptsPerProvider[providerEntry.name] ?? 0) + 1;
      scope.attempt += 1;
      scope.canSwitchProvider = scope.providerIdx < providers.length - 1;
    }
  };

  // ─── PostDecide decider function ─────────────────────────────
  // Returns one of the POST_* branch ids. Maps ReliabilityDecision
  // values from rule.then to the prefixed branch ids.
  const postDecideDeciderFn = (scope: TypedScope<ReliabilityScope>) => {
    if (postRules.length === 0) {
      return scope.error === undefined ? BRANCH_IDS.POST_OK : BRANCH_IDS.POST_FAIL_FAST;
    }
    const result = decide(
      scope,
      postRules as unknown as Parameters<typeof decide<ReliabilityScope>>[1],
      'ok',
    );
    return POST_DECISION_TO_BRANCH[result.branch] ?? BRANCH_IDS.POST_OK;
  };

  // ─── PostDecide branch fns ───────────────────────────────────
  const okBranchFn = (scope: TypedScope<ReliabilityScope>) => {
    // Success exit — $break stops subflow; outputMapper still runs.
    scope.$break();
  };

  const retryBranchFn = (_scope: TypedScope<ReliabilityScope>) => {
    // No-op — `attempt` was already incremented by CallProvider's
    // finally block. Falling through (no $break) triggers loopTo
    // back to PreCheck.
    void _scope;
  };

  const retryOtherBranchFn = (scope: TypedScope<ReliabilityScope>) => {
    // Advance to the next provider in the failover list (held in closure).
    scope.providerIdx += 1;
    if (scope.providerIdx < providers.length) {
      scope.currentProvider = providers[scope.providerIdx].name;
    }
    scope.canSwitchProvider = scope.providerIdx < providers.length - 1;
    // No $break — loopTo re-enters PreCheck with the new provider.
  };

  const fallbackBranchFn = async (scope: TypedScope<ReliabilityScope>) => {
    if (!fallbackFn) {
      // Routed here but no fallback configured — convert to fail-fast.
      scope.failKind = 'fallback-not-configured';
      scope.failPayload = buildFailPayload(scope, 'post-decide');
      scope.$emit('agentfootprint.reliability.fail_fast', {
        phase: 'post-decide',
        kind: 'fallback-not-configured',
        attempt: scope.attempt,
        providerUsed: scope.currentProvider,
      });
      scope.$break('reliability-post-decide: fallback-not-configured');
      return;
    }
    try {
      const repaired = await fallbackFn(scope.request as LLMRequest, scope.error);
      scope.response = repaired;
      scope.error = undefined;
      scope.errorKind = 'ok';
      scope.$break(); // success via fallback; exit subflow
    } catch (fallbackErr) {
      // Fallback threw — re-classify and let next iteration's
      // post-decide rules route on the new error (typically fail-fast).
      scope.error = fallbackErr instanceof Error ? fallbackErr : new Error(String(fallbackErr));
      scope.errorKind = classifyError(fallbackErr);
      // Don't $break — loopTo re-enters PreCheck with new error state.
    }
  };

  const failFastBranchFn = (scope: TypedScope<ReliabilityScope>) => {
    if (postRules.length === 0) {
      // Default-path fail-fast (no rules configured but error occurred)
      scope.failKind = scope.errorKind;
      scope.failPayload = buildFailPayload(scope, 'post-decide');
      scope.$emit('agentfootprint.reliability.fail_fast', {
        phase: 'post-decide',
        kind: scope.errorKind,
        attempt: scope.attempt,
        providerUsed: scope.currentProvider,
        ...(scope.error?.message !== undefined && { errorMessage: scope.error.message }),
      });
      scope.$break(`reliability-post-decide: ${scope.errorKind}`);
      return;
    }
    // Re-evaluate to extract the matched rule's kind/label.
    const result = decide(
      scope,
      postRules as unknown as Parameters<typeof decide<ReliabilityScope>>[1],
      'ok',
    );
    const matchedIdx = findMatchedIndex(result.evidence);
    const { kind, label } = matchedKindLabel(postRules, matchedIdx);
    scope.failKind = kind;
    scope.failPayload = buildFailPayload(scope, 'post-decide');
    scope.$emit('agentfootprint.reliability.fail_fast', {
      phase: 'post-decide',
      kind,
      label,
      attempt: scope.attempt,
      providerUsed: scope.currentProvider,
      errorKind: scope.errorKind,
      ...(scope.error?.message !== undefined && { errorMessage: scope.error.message }),
    });
    scope.$break(`reliability-post-decide: ${label}`);
  };

  // ─── Compose the chart ───────────────────────────────────────
  // The chart starts with an Init stage that seeds the MUTABLE scope
  // state (attempt, providerIdx, errorKind, attemptsPerProvider, etc.).
  // We can't seed mutable state via inputMapper because inputMapper
  // supplies READ-ONLY inputs (the subflow's "args"). Instead, only
  // truly-readonly inputs (request, providersCount, hasFallback,
  // cumulativeCostUsd) come via inputMapper; the rest is initialized
  // here.
  return flowChart<ReliabilityScope>(
    'Init',
    (scope) => {
      // Seed mutable state. Read-only inputs (request, providersCount,
      // hasFallback, cumulativeCostUsd, AND incomingBreakerStates) come
      // via inputMapper and are accessible via $getArgs(); only mutable
      // fields seeded into scope here.
      const args = scope.$getArgs<
        ReliabilityScope & { incomingBreakerStates?: ReliabilityScope['breakerStates'] }
      >();
      scope.attempt = 0;
      scope.providerIdx = 0;
      scope.currentProvider = providers[0]?.name ?? '';
      scope.canSwitchProvider = providers.length > 1;
      scope.errorKind = 'ok';
      scope.latencyMs = 0;
      scope.attemptsPerProvider = {};
      // Breaker state restoration: if the agent passed prior breaker
      // states (across gate invocations within one ReAct loop, or
      // hydrated from a persistence store), use them; else start fresh.
      // This is the round-trip mechanism that replaces closure state.
      const incoming = args.incomingBreakerStates ?? {};
      scope.breakerStates = {};
      if (breakerConfig !== undefined) {
        for (const p of providers) {
          scope.breakerStates[p.name] = incoming[p.name] ?? initialBreakerState();
        }
      }
    },
    STAGE_IDS.INIT,
    undefined,
    'Reliability gate state init',
  )
    .addDeciderFunction(
      'PreCheck',
      preCheckDeciderFn,
      STAGE_IDS.PRE_CHECK,
      'Reliability: pre-call rule check',
    )
    .addFunctionBranch(BRANCH_IDS.PRE_CONTINUE, 'PreContinue', preContinueNoop)
    .addFunctionBranch(BRANCH_IDS.PRE_FAIL_FAST, 'PreFailFast', preFailFastBranchFn)
    .setDefault(BRANCH_IDS.PRE_CONTINUE)
    .end()
    .addFunction(
      'CallProvider',
      callProviderStageFn,
      STAGE_IDS.CALL_PROVIDER,
      'Invoke LLM provider; capture response/error to scope',
    )
    .addDeciderFunction(
      'PostDecide',
      postDecideDeciderFn,
      STAGE_IDS.POST_DECIDE,
      'Reliability: post-call rule check',
    )
    .addFunctionBranch(BRANCH_IDS.POST_OK, 'PostOk', okBranchFn)
    .addFunctionBranch(BRANCH_IDS.POST_RETRY, 'PostRetry', retryBranchFn)
    .addFunctionBranch(BRANCH_IDS.POST_RETRY_OTHER, 'PostRetryOther', retryOtherBranchFn)
    .addFunctionBranch(BRANCH_IDS.POST_FALLBACK, 'PostFallback', fallbackBranchFn)
    .addFunctionBranch(BRANCH_IDS.POST_FAIL_FAST, 'PostFailFast', failFastBranchFn)
    .setDefault(BRANCH_IDS.POST_OK)
    .end()
    .loopTo(STAGE_IDS.PRE_CHECK)
    .build();
}
