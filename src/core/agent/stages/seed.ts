/**
 * seed — initial stage of the agent's chart. Initializes every mutable
 * field of `AgentState` from the consumer's input.
 *
 * Runs once per `agent.run({ input })`. The chart is built once at
 * Agent construction, so seed has access to BOTH:
 *
 *   • CHART-BUILD-TIME constants (maxIterations, cachingDisabled,
 *     toolSchemas) — passed as direct values to the factory.
 *   • PER-RUN MUTABLE state (pendingResumeHistory from
 *     resumeOnError(), currentRunContext.runId set per run) —
 *     passed as accessor closures over the Agent instance, since
 *     these change between consecutive `agent.run()` invocations.
 *
 * The accessor pattern keeps `seed` decoupled from the Agent class
 * while preserving the per-run mutability the resume + identity
 * features need.
 */

import type { TypedScope } from 'footprintjs';
import type { LLMMessage, LLMToolSchema } from '../../../adapters/types.js';
import { typedEmit } from '../../../recorders/core/typedEmit.js';
import type { AgentInput, AgentState } from '../types.js';

export interface SeedStageDeps {
  /** Resolved `clampIterations(opts.maxIterations ?? 10)`. Frozen at
   *  chart-build time. */
  readonly maxIterations: number;
  /** Resolved cache kill switch from `Agent.create({ caching: 'off' })`. */
  readonly cachingDisabled: boolean;
  /** Static tool schemas resolved at chart-build time. The tools slot
   *  subflow can OVERRIDE this per-iteration via `dynamicToolSchemas`,
   *  but seed populates the initial value so iter 1 has it. */
  readonly toolSchemas: readonly LLMToolSchema[];
  /**
   * Read-AND-CLEAR accessor for the resume side-channel. Called exactly
   * once per `agent.run()` from inside seed. If `resumeOnError(checkpoint)`
   * was invoked before `run()`, this returns the checkpointed history
   * and clears the field so the NEXT `run()` starts fresh. Returns
   * `undefined` for the normal (non-resume) path.
   */
  readonly consumePendingResumeHistory: () => readonly LLMMessage[] | undefined;
  /**
   * Accessor for the current run's id, used to default the memory
   * identity when consumer didn't pass `agent.run({ identity })`. Set
   * by RunnerBase on every `agent.run()` call before the chart starts.
   * Returns `undefined` only in degenerate (test) cases.
   */
  readonly getCurrentRunId: () => string | undefined;
}

/**
 * Build the seed stage function for an Agent instance. Captures both
 * the chart-build-time constants and the per-run mutable accessors
 * via the deps object.
 */
export function buildSeedStage(deps: SeedStageDeps): (scope: TypedScope<AgentState>) => void {
  return (scope) => {
    const args = scope.$getArgs<AgentInput>();
    scope.userMessage = args.message;

    // If `resumeOnError(...)` set the side channel, restore the
    // checkpointed conversation history. The next iteration sees
    // the prior messages and continues from the failure point.
    // Always clear the field after reading so subsequent runs
    // (without resumeOnError) start fresh.
    const resumeHistory = deps.consumePendingResumeHistory();
    if (resumeHistory && resumeHistory.length > 0) {
      scope.history = [...resumeHistory];
    } else {
      scope.history = [{ role: 'user', content: args.message }];
    }

    // Default identity uses the runId so multi-run isolation works
    // without consumer changes; explicit identity (multi-tenant)
    // overrides via `agent.run({ identity })`.
    scope.runIdentity = args.identity ?? {
      conversationId: deps.getCurrentRunId() ?? 'default',
    };
    scope.newMessages = [];
    scope.turnNumber = 1;
    // Permissive default — explicit cap will land when PricingTable
    // gets a context-window field. Memory pickByBudget treats anything
    // ≥ minimumTokens as "fits", so this just enables the budget path.
    scope.contextTokensRemaining = 32_000;
    scope.iteration = 1;
    scope.maxIterations = deps.maxIterations;
    scope.finalContent = '';
    scope.totalInputTokens = 0;
    scope.totalOutputTokens = 0;
    scope.turnStartMs = Date.now();
    scope.systemPromptInjections = [];
    scope.messagesInjections = [];
    scope.toolsInjections = [];
    scope.llmLatestContent = '';
    scope.llmLatestToolCalls = [];
    // v2.14 — initialize thinking blocks. Empty array means "no thinking
    // this iteration"; the NormalizeThinking sub-subflow overwrites
    // this AFTER each CallLLM when a ThinkingHandler is configured.
    scope.thinkingBlocks = [];
    scope.pausedToolCallId = '';
    scope.pausedToolName = '';
    scope.pausedToolStartMs = 0;
    scope.cumTokensInput = 0;
    scope.cumTokensOutput = 0;
    scope.cumEstimatedUsd = 0;
    scope.costBudgetHit = false;
    scope.activeInjections = [];
    scope.activatedInjectionIds = [];
    scope.dynamicToolSchemas = deps.toolSchemas;
    // Cache layer state (v2.6) — initialized to inert defaults.
    // CacheDecision subflow populates `cacheMarkers` per iteration;
    // UpdateSkillHistory + CacheGate consume `cachingDisabled`,
    // `recentHitRate`, `skillHistory`. Empty defaults mean the
    // CacheGate falls through to 'apply-markers' on iter 1 (no
    // history yet → no churn detected; recentHitRate undefined →
    // hit-rate floor doesn't fire).
    scope.cacheMarkers = [];
    scope.cachingDisabled = deps.cachingDisabled;
    scope.recentHitRate = undefined;
    scope.skillHistory = [];

    typedEmit(scope, 'agentfootprint.agent.turn_start', {
      turnIndex: 0,
      userPrompt: args.message,
    });
  };
}
