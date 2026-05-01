/**
 * CacheDecision subflow — provider-agnostic translation from
 * `activeInjections + DSL directives` → `CacheMarker[]`.
 *
 * This is the core "policy → markers" Lego layer. It runs every
 * iteration (after slot subflows produce their output, before the
 * CacheGate decider). Pure transform: no IO, no LLM calls, no
 * provider knowledge.
 *
 * Algorithm:
 *   1. Build a `CachePolicyContext` from agent state
 *   2. For each injection in `activeInjections`, evaluate its
 *      `metadata.cache` directive against the context → cacheable boolean
 *   3. For each slot (system / tools / messages):
 *      a. Walk the slot's contributions in order
 *      b. Find the LAST index that's contiguous-from-start cacheable
 *      c. Emit one CacheMarker at that boundary if any cacheable
 *
 * Each marker is provider-agnostic. Provider strategy translates
 * to wire format in Phase 6+.
 *
 * Special case — base system prompt: the agent's
 * `agent.getSystemPromptCachePolicy()` value is folded in at index 0
 * of the system slot. Always-on injections (Steering / Fact /
 * always-active rules) follow.
 */

import { flowChart, type FlowChart, type TypedScope } from 'footprintjs';
import type { CacheMarker, CachePolicy, CachePolicyContext } from './types.js';
import type { Injection } from '../lib/injection-engine/types.js';

/**
 * Subflow scope state. Set via inputMapper from the agent's parent
 * scope; produces `cacheMarkers` consumed by the BuildLLMRequest stage.
 */
export interface CacheDecisionState {
  // ── Inputs (set by parent scope's inputMapper) ────────────────
  readonly activeInjections: readonly Injection[];
  readonly iteration: number;
  readonly maxIterations: number;
  readonly userMessage: string;
  readonly lastToolName?: string;
  /**
   * Cumulative input tokens spent across all LLM calls in THIS
   * `agent.run()` invocation only. Resets at the start of each turn
   * (each `agent.run()` call). Predicates can use this for budget-
   * aware cache invalidation (e.g., "flush cache after 50K tokens").
   */
  readonly cumulativeInputTokens: number;
  /**
   * Base system prompt's cache policy (from
   * `agent.getSystemPromptCachePolicy()`). Folded in at index 0 of
   * the system slot's cache evaluation, ahead of any always-on
   * injections.
   */
  readonly systemPromptCachePolicy: CachePolicy;
  /** Global kill switch. When `true`, subflow emits zero markers. */
  readonly cachingDisabled: boolean;
  // ── Output ────────────────────────────────────────────────────
  cacheMarkers: readonly CacheMarker[];
}

/**
 * Evaluate a `CachePolicy` against the current context.
 * Returns `true` if the policy says THIS iteration's content is cacheable.
 */
export function evaluateCachePolicy(policy: CachePolicy, ctx: CachePolicyContext): boolean {
  if (policy === 'always') return true;
  if (policy === 'never') return false;
  if (policy === 'while-active') {
    // Membership in `activeInjections` IS being-active. By the time
    // the subflow walks an injection, the InjectionEngine has already
    // confirmed it's active for THIS iteration. So 'while-active'
    // policy → cacheable while in the list.
    return true;
  }
  if (typeof policy === 'object' && policy !== null && 'until' in policy) {
    // Cache UNTIL predicate returns true. So cacheable iff !predicate.
    try {
      return !policy.until(ctx);
    } catch {
      // Failing predicates are treated as "do not cache" — fail-closed.
      // Avoids the failure mode where a buggy predicate accidentally
      // caches volatile content.
      return false;
    }
  }
  // Unknown policy form — fail-closed (don't cache).
  return false;
}

/**
 * Identify which slots an injection contributes to. An injection can
 * target multiple slots simultaneously (Skills target both system +
 * tools); we visit each contributing slot independently.
 */
export function injectionTargetSlots(
  injection: Injection,
): ReadonlyArray<'system' | 'tools' | 'messages'> {
  const slots: Array<'system' | 'tools' | 'messages'> = [];
  if (injection.inject.systemPrompt && injection.inject.systemPrompt.length > 0) {
    slots.push('system');
  }
  if (injection.inject.tools && injection.inject.tools.length > 0) {
    slots.push('tools');
  }
  if (injection.inject.messages && injection.inject.messages.length > 0) {
    slots.push('messages');
  }
  return slots;
}

/**
 * Pure transform: state → markers. Exported so tests can exercise
 * the algorithm directly without the FlowChartExecutor ceremony of
 * mounting the subflow as a child of a parent chart.
 *
 * The subflow body (`decide` below) is a thin wrapper that pulls
 * state from scope and delegates here.
 */
export function computeCacheMarkers(
  state: Omit<CacheDecisionState, 'cacheMarkers'>,
): readonly CacheMarker[] {
  // Kill switch short-circuits immediately
  if (state.cachingDisabled) return [];

  const ctx: CachePolicyContext = {
    iteration: state.iteration,
    iterationsRemaining: Math.max(0, state.maxIterations - state.iteration),
    userMessage: state.userMessage,
    ...(state.lastToolName !== undefined && { lastToolName: state.lastToolName }),
    cumulativeInputTokens: state.cumulativeInputTokens,
  };

  // Per-slot list of {cacheable, reason}
  type SlotEntry = { readonly cacheable: boolean; readonly reason: string };
  const perSlot: Record<'system' | 'tools' | 'messages', SlotEntry[]> = {
    system: [],
    tools: [],
    messages: [],
  };

  // Index 0 of system slot is the base system prompt
  perSlot.system.push({
    cacheable: evaluateCachePolicy(state.systemPromptCachePolicy, ctx),
    reason: 'base system prompt',
  });

  // Walk each active injection
  for (const inj of state.activeInjections) {
    const policy = (inj.metadata?.cache as CachePolicy | undefined) ?? 'never';
    const cacheable = evaluateCachePolicy(policy, ctx);
    const reason = `${inj.flavor}:${inj.id}`;
    for (const slot of injectionTargetSlots(inj)) {
      perSlot[slot].push({ cacheable, reason });
    }
  }

  // Find per-slot last-contiguous-cacheable boundary; emit a marker per
  // slot that has at least one cacheable entry from index 0.
  const markers: CacheMarker[] = [];
  for (const slot of ['system', 'tools', 'messages'] as const) {
    const entries = perSlot[slot];
    let boundary = -1;
    let lastReason = '';
    for (let i = 0; i < entries.length; i++) {
      if (!entries[i].cacheable) break;
      boundary = i;
      lastReason = entries[i].reason;
    }
    if (boundary >= 0) {
      markers.push({
        field: slot,
        boundaryIndex: boundary,
        ttl: 'short',
        reason: `${slot} stable prefix (${boundary + 1} entries, ending at ${lastReason})`,
      });
    }
  }

  return markers;
}

/**
 * The decision function. Thin scope-binding wrapper around
 * `computeCacheMarkers`.
 */
function decide(scope: TypedScope<CacheDecisionState>): void {
  scope.cacheMarkers = computeCacheMarkers({
    activeInjections: scope.activeInjections,
    iteration: scope.iteration,
    maxIterations: scope.maxIterations,
    userMessage: scope.userMessage,
    ...(scope.lastToolName !== undefined && { lastToolName: scope.lastToolName }),
    cumulativeInputTokens: scope.cumulativeInputTokens,
    systemPromptCachePolicy: scope.systemPromptCachePolicy,
    cachingDisabled: scope.cachingDisabled,
  });
}

/**
 * The cache-decision subflow. Mounted into the agent's main chart
 * after the slot subflows (System / Messages / Tools) and before
 * the CacheGate decider stage.
 *
 * Mounted via `addSubFlowChartNext(SUBFLOW_IDS.CACHE_DECISION, ...)`
 * with `arrayMerge: ArrayMergeMode.Replace` on the outputMapper —
 * `cacheMarkers` MUST replace, not concatenate, across iterations
 * (same lesson as the v2.5.1 InjectionEngine fix).
 */
export const cacheDecisionSubflow: FlowChart = flowChart<CacheDecisionState>(
  'DecideCacheMarkers',
  decide,
  'decide-cache-markers',
  undefined,
  'CacheDecision: walk activeInjections, evaluate cache directives, emit CacheMarker[]',
).build();
