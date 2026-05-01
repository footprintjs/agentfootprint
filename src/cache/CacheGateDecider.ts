/**
 * CacheGate — runtime decider that gates cache-marker application.
 *
 * Runs every iteration AFTER the CacheDecision subflow produces
 * `scope.cacheMarkers` and BEFORE the BuildLLMRequest stage applies
 * them. Three rules can fall through to "no-markers" (skip caching);
 * default branch is "apply-markers" (proceed with caching).
 *
 * Why a decider stage and not a function: footprintjs's `decide()`
 * captures evidence on `FlowRecorder.onDecision` natively. The
 * `cacheRecorder()` (Phase 9) reads
 * `event.evidence.rules.find(r => r.matched).inputs[]` to surface
 * WHY caching was applied or skipped each iter. Same channel
 * footprintjs uses for every other decision; same renderer in Lens.
 *
 * Three rules (evaluated top-down; first match wins):
 *   1. Kill switch — `Agent.create({ caching: 'off' })` was set
 *   2. Hit-rate floor — recent hit rate < 30%; cache writes outpacing
 *      reads, auto-disable to avoid the cache-write penalty
 *   3. Skill churn — active skills changing too rapidly for caching
 *      to amortize (Anthropic LLM expert's concern from Phase 4 review)
 *
 * Default branch (no rule matches): `'apply-markers'`.
 */

import { decide, type DecisionResult, type TypedScope } from 'footprintjs';

/**
 * Subset of agent scope state the CacheGate decider reads.
 * Phase 6 wires these keys into the agent's main chart.
 */
export interface CacheGateState {
  /**
   * Global kill switch. When `true`, decider skips caching
   * unconditionally. Set via `Agent.create({ caching: 'off' })`.
   */
  readonly cachingDisabled: boolean;
  /**
   * Running cache hit rate from the last N iterations (0..1).
   * `undefined` when no cache events have fired yet (e.g., iter 1 of
   * the first turn — no history). The cacheRecorder (Phase 9)
   * computes this from `CacheMetrics` events.
   */
  readonly recentHitRate: number | undefined;
  /**
   * Rolling window of active-skill IDs across recent iterations,
   * one per iteration (latest LAST). Maintained by the
   * UpdateSkillHistory function stage (Phase 6 mount).
   *
   * `undefined` entry = no skill active that iteration.
   */
  readonly skillHistory: readonly (string | undefined)[];
}

/**
 * Hit-rate floor below which we auto-disable caching. The 30% number
 * is calibrated for Anthropic's pricing: cache write costs +25%
 * premium, cache read costs 90% off. Break-even at ~25% hit rate.
 * 30% gives a buffer; below that we're losing money on writes that
 * never recoup.
 *
 * Reasoning: if hit rate is X, cost-per-token vs no caching is
 *   (1 - X) * 1.0 + X * 0.1                                    // baseline
 *   minus
 *   write_iters * 1.25 + read_iters * 0.1                       // with caching
 * Solving for break-even gives X ≈ 0.25 for typical agent shapes.
 */
export const HIT_RATE_FLOOR = 0.3;

/**
 * Window size for skill-churn detection. Last 5 iterations of
 * active skill IDs are inspected.
 */
export const SKILL_CHURN_WINDOW = 5;

/**
 * Threshold above which skill churn is considered detected: this many
 * UNIQUE skills in the rolling window. With window=5 and threshold=3,
 * the pattern A → B → A → C still triggers (3 unique skills in 4 iters).
 */
export const SKILL_CHURN_THRESHOLD = 3;

/**
 * Pure helper: detect skill churn given a rolling history.
 * Exported for direct testing without decider/scope ceremony.
 */
export function detectSkillChurn(
  history: readonly (string | undefined)[],
  windowSize: number = SKILL_CHURN_WINDOW,
  threshold: number = SKILL_CHURN_THRESHOLD,
): boolean {
  if (history.length < threshold) return false; // not enough history yet
  const recent = history.slice(-windowSize);
  const uniqueSkills = new Set<string>();
  for (const s of recent) {
    if (s !== undefined) uniqueSkills.add(s);
  }
  return uniqueSkills.size >= threshold;
}

/**
 * Branch routing keys for the CacheGate decider. Two outcomes:
 * apply markers (proceed with cache) or skip (no markers this iter).
 */
export type CacheGateBranch = 'apply-markers' | 'no-markers';

/**
 * The decider function. Mounted via `addDeciderFunction` in the
 * agent's main chart in Phase 6.
 *
 * Returns a `DecisionResult` (footprintjs's `decide()` helper output)
 * which the engine unwraps via `.branch` for routing AND publishes
 * `evidence.rules[matched].inputs[]` to FlowRecorder.onDecision.
 * cacheRecorder (Phase 9) subscribes to that channel for the audit trail.
 *
 * For non-routing consumers (testing the decision in isolation), read
 * the `.branch` field of the returned DecisionResult.
 */
export function cacheGateDecide(
  scope: TypedScope<CacheGateState>,
): DecisionResult {
  return decide(
    scope,
    [
      {
        when: (s) => s.cachingDisabled === true,
        then: 'no-markers',
        label: "kill switch active (Agent.create({ caching: 'off' }))",
      },
      {
        when: (s) =>
          s.recentHitRate !== undefined && s.recentHitRate < HIT_RATE_FLOOR,
        then: 'no-markers',
        label: `hit rate < ${HIT_RATE_FLOOR * 100}% — auto-disable`,
      },
      {
        when: (s) => detectSkillChurn(s.skillHistory),
        then: 'no-markers',
        label: `skill churn (≥${SKILL_CHURN_THRESHOLD} unique skills in last ${SKILL_CHURN_WINDOW} iters)`,
      },
    ],
    'apply-markers',
  );
}

/**
 * Update the skill-history rolling window. Called as a function
 * stage BEFORE the CacheGate decider. Reads the current iteration's
 * active skill (head of `activatedInjectionIds`) and appends to the
 * `skillHistory` array.
 *
 * Window length is bounded at `SKILL_CHURN_WINDOW * 2` so the array
 * doesn't grow unboundedly across long agent runs. Old entries
 * fall off the front naturally.
 */
export function updateSkillHistory(
  scope: TypedScope<{
    activatedInjectionIds?: readonly string[];
    skillHistory: readonly (string | undefined)[];
  }>,
): void {
  const current = scope.activatedInjectionIds?.[0];
  const prior = scope.skillHistory ?? [];
  const next = [...prior, current];
  // Bounded buffer — keep window*2 to give detectSkillChurn room
  // without pinning every prior iteration in memory.
  const trimmed =
    next.length > SKILL_CHURN_WINDOW * 2 ? next.slice(-SKILL_CHURN_WINDOW * 2) : next;
  scope.skillHistory = trimmed;
}
