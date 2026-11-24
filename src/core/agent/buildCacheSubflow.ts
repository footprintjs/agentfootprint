/**
 * buildCacheSubflow — the per-turn prompt-cache decision, as ONE subflow.
 *
 * Collapses the cache machinery into a single `sf-cache` boundary so the
 * agent chart reads cleanly (one "Cache" box you can drill into) while the
 * execution tree stays honest:
 *
 *     decideCacheMarkers  →  CacheGate (decider)  →  ApplyMarkers / SkipCaching
 *
 * Layering (see src/cache/types.ts):
 *   - This subflow is the provider-AGNOSTIC DECISION layer — it only computes
 *     and gates provider-neutral `CacheMarker[]`. It knows nothing about any
 *     provider.
 *   - The provider-SPECIFIC MECHANISM (Anthropic `cache_control`, OpenAI
 *     automatic, …) is the attached provider's `CacheStrategy`, selected by
 *     the provider's declared `promptCaching` (`cacheStrategyFor`), applied
 *     later when the request is built.
 *
 * Why `UpdateSkillHistory` is NOT in here: the `skillHistory` rolling window
 * must persist across loop iterations. Keeping `UpdateSkillHistory` in the
 * main loop (just before this subflow) lets `skillHistory` live in the parent
 * scope without round-tripping through this subflow's in/out mappers — the
 * subflow stays pure (reads the turn's state, writes only `cacheMarkers`).
 *
 * Deps-free: every input (`activeInjections`, `iteration`, `skillHistory`,
 * `recentHitRate`, `systemPromptCachePolicy`, …) is supplied by the PARENT's
 * `inputMapper` at the mount site; the output is just `cacheMarkers`.
 */

import { flowChart, type FlowChart } from 'footprintjs';
import {
  cacheDecisionStage,
  type CacheDecisionStageOptions,
  type CacheDecisionState,
  cacheHistoryFor,
} from '../../cache/CacheDecisionSubflow.js';
import { cacheGateDecide, type CacheGateState } from '../../cache/CacheGateDecider.js';
import type { Injection } from '../../injection-engine/types.js';
import { STAGE_IDS } from '../../lib/conventions.js';
import type { LLMMessage } from '../../provider-contract/types.js';
import type { AgentChartDeps } from './chartContract.js';
import type { AgentState } from './types.js';

/** Map the same post-window cache inputs for the flat and grouped charts. */
export function cacheMountInput(
  parent: Readonly<Partial<AgentState>>,
  deps: Pick<AgentChartDeps, 'maxIterations' | 'systemPromptCachePolicy'>,
): Omit<CacheDecisionState, 'cacheMarkers'> & CacheGateState {
  return {
    activeInjections: (parent.activeInjections as readonly Injection[] | undefined) ?? [],
    iteration: (parent.iteration as number | undefined) ?? 1,
    maxIterations: (parent.maxIterations as number | undefined) ?? deps.maxIterations,
    userMessage: (parent.userMessage as string | undefined) ?? '',
    ...(parent.lastToolResult !== undefined && {
      lastToolName: (parent.lastToolResult as { toolName: string } | undefined)?.toolName,
    }),
    cumulativeInputTokens: (parent.totalInputTokens as number | undefined) ?? 0,
    systemPromptCachePolicy: deps.systemPromptCachePolicy,
    cachingDisabled: (parent.cachingDisabled as boolean | undefined) ?? false,
    // The window AS IT WILL BE SENT (7.21). A cache marker for messages
    // names a position in the request's message array, so it has to be
    // computed against that array — post-window, post-delivery — and not
    // against a count of injections, which used to point at the wrong message.
    cacheHistory: cacheHistoryFor((parent.history as readonly LLMMessage[] | undefined) ?? []),
    // CacheGate reads these values. The main loop updates skillHistory and
    // does not map it back out of the cache subflow.
    recentHitRate: parent.recentHitRate as number | undefined,
    skillHistory: (parent.skillHistory as readonly (string | undefined)[] | undefined) ?? [],
  };
}

/**
 * Build the `sf-cache` subflow chart. Called by `buildAgentChart` and
 * `buildDynamicAgentChart` and mounted via `addSubFlowChartNext(
 * SUBFLOW_IDS.CACHE, buildCacheSubflow(), 'Cache', { inputMapper,
 * outputMapper, arrayMerge: Replace })`.
 */
export function buildCacheSubflow(options: CacheDecisionStageOptions = {}): FlowChart {
  return flowChart<AgentState>(
    'CacheDecision',
    // Root stage = the cache-decision function (a chart cannot start with a
    // nested subflow). Exported from CacheDecisionSubflow.ts and reused here —
    // the cache decision is the root of sf-cache, no logic duplication.
    cacheDecisionStage(options) as never,
    'decide-cache-markers',
    {
      description:
        'CacheDecision: walk activeInjections, evaluate cache directives, emit CacheMarker[]',
    },
  )
    .addDeciderFunction(
      'CacheGate',
      cacheGateDecide as never,
      STAGE_IDS.CACHE_GATE,
      'Gate cache-marker application: kill switch / hit-rate / skill-churn',
    )
    .addFunctionBranch(
      STAGE_IDS.APPLY_MARKERS,
      'ApplyMarkers',
      // Pass-through — markers stay in scope; the request build reads them.
      () => undefined,
      'Proceed with cache markers from CacheDecision',
    )
    .addFunctionBranch(
      STAGE_IDS.SKIP_CACHING,
      'SkipCaching',
      // Clear markers so the request is built unmodified this iteration.
      (scope) => {
        (scope as { cacheMarkers: readonly unknown[] }).cacheMarkers = [];
      },
      'Skip caching this iteration',
    )
    .end()
    .build();
}
